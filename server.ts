import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  deleteBaleWebhook,
  getBaleBotMe,
  setBaleWebhook,
} from './src/server/baleApi.ts';
import { DEFAULT_PERSIAN_FLOW } from './src/server/defaultFlow.ts';
import {
  createBotFlow,
  createUserBot,
  deleteCollectedForm,
  deleteUserBot,
  DirectusApiError,
  DirectusConfigError,
  getCurrentDirectusUser,
  getDirectusConfig,
  getUserBot,
  listBotFlows,
  listBotSessions,
  listCollectedForms,
  listUserBots,
  listWebhookLogs,
  loginWithDirectus,
  logoutDirectus,
  refreshDirectusToken,
  registerUserInDirectus,
  updateBotFlow,
  updateUserBot,
} from './src/server/directus.ts';
import { executeBotFlow } from './src/server/flowEngine.ts';
import { clearSimulatorSession } from './src/server/sessionStore.ts';
import { enqueueWebhookUpdate, startWebhookWorker } from './src/server/webhookQueue.ts';
import type { BaleUpdate, FlowDefinition } from './src/types/bot.ts';

interface AuthedRequest extends Request {
  directusToken?: string;
}

function requireBearerToken(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'لطفاً ابتدا وارد حساب کاربری خود شوید.' });
    return;
  }
  req.directusToken = header.slice('Bearer '.length).trim();
  next();
}

function handleApiError(res: Response, error: unknown) {
  if (error instanceof DirectusConfigError) {
    res.status(500).json({
      code: 'DIRECTUS_NOT_CONFIGURED',
      upstreamStatus: 503,
      error: error.message,
    });
    return;
  }
  if (error instanceof DirectusApiError) {
    const safeStatus =
      error.status === 403 || error.status === 502 || error.status === 503 || error.status === 504
        ? 422
        : error.status;
    res.status(safeStatus).json({
      code: error.code || 'DIRECTUS_API_ERROR',
      upstreamStatus: error.status,
      error: error.message,
    });
    return;
  }
  const message = error instanceof Error ? error.message : 'خطای داخلی سرور رخ داد.';
  console.error('Server API Error:', error);
  res.status(500).json({ error: message });
}

function resolvePublicBaseUrl(req: Request): string {
  const envUrl = (process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (envUrl && !envUrl.includes('MY_APP_URL')) {
    return envUrl;
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  // Start Redis background worker if REDIS_URL is configured
  startWebhookWorker();

  // ---------------- System & Config ----------------
  app.get('/api/health', (_req, res) => {
    const cfg = getDirectusConfig();
    res.json({
      ok: true,
      directusConfigured: cfg.isConfigured,
      hasAdminToken: cfg.hasAdminToken,
      redisConfigured: Boolean((process.env.REDIS_URL || '').trim()),
    });
  });

  app.get('/api/default-flow', (_req, res) => {
    res.json({ flow: DEFAULT_PERSIAN_FLOW });
  });

  // ---------------- Directus Authentication ----------------
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body as { email?: string; password?: string };
      if (!email || !password) {
        res.status(400).json({ error: 'ایمیل و رمز عبور الزامی است.' });
        return;
      }

      const tokens = await loginWithDirectus(email.trim(), password);
      const user = await getCurrentDirectusUser(tokens.access_token);
      res.json({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires: tokens.expires,
        user,
      });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body as {
        email?: string;
        password?: string;
        firstName?: string;
        lastName?: string;
      };
      if (!email || !password || !firstName) {
        res.status(400).json({ error: 'نام، ایمیل و رمز عبور الزامی است.' });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: 'رمز عبور باید حداقل ۸ کاراکتر باشد.' });
        return;
      }

      await registerUserInDirectus({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName?.trim(),
      });

      const tokens = await loginWithDirectus(email.trim(), password);
      const user = await getCurrentDirectusUser(tokens.access_token);
      res.status(201).json({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires: tokens.expires,
        user,
      });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post('/api/auth/refresh', async (req, res) => {
    try {
      const { refresh_token } = req.body as { refresh_token?: string };
      if (!refresh_token) {
        res.status(400).json({ error: 'Refresh token missing' });
        return;
      }
      const tokens = await refreshDirectusToken(refresh_token);
      res.json(tokens);
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const { refresh_token } = req.body as { refresh_token?: string };
      if (refresh_token) {
        await logoutDirectus(refresh_token).catch(() => undefined);
      }
      res.json({ ok: true });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.get('/api/auth/me', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const user = await getCurrentDirectusUser(req.directusToken!);
      res.json({ user });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  // ---------------- Bots CRUD & Bale Webhook Setup ----------------
  app.get('/api/bots', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const bots = await listUserBots(req.directusToken!);
      res.json({ bots });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post('/api/bots', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const { name, bot_token, verifyToken = true } = req.body as {
        name?: string;
        bot_token?: string;
        verifyToken?: boolean;
      };

      if (!name?.trim() || !bot_token?.trim()) {
        res.status(400).json({ error: 'نام بازو و توکن بله الزامی است.' });
        return;
      }

      let baleUsername: string | null = null;
      if (verifyToken) {
        const me = await getBaleBotMe(bot_token.trim());
        if (!me.ok || !me.result) {
          res.status(400).json({
            error: `توکن بازوی بله معتبر نیست یا خطای ارتباط با API بله رخ داد: ${me.description || 'Invalid token'}`,
          });
          return;
        }
        baleUsername = me.result.username ? `@${me.result.username}` : me.result.first_name;
      }

      const webhookSecret = crypto.randomBytes(20).toString('hex');
      const bot = await createUserBot(req.directusToken!, {
        name: name.trim(),
        bale_username: baleUsername,
        bot_token: bot_token.trim(),
        webhook_secret: webhookSecret,
        webhook_status: 'inactive',
        is_active: true,
      });

      // Automatically provision starter Persian flow in Directus bot_flows
      const flow = await createBotFlow(req.directusToken!, {
        bot_id: bot.id,
        name: 'جریان اصلی گفتگو',
        version: 1,
        is_published: true,
        flow_json: DEFAULT_PERSIAN_FLOW,
      });

      res.status(201).json({ bot, flow });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.patch('/api/bots/:id', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const bot = await updateUserBot(req.directusToken!, req.params.id, req.body);
      res.json({ bot });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.delete('/api/bots/:id', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      await deleteUserBot(req.directusToken!, req.params.id);
      res.json({ ok: true });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post('/api/bots/:id/webhook/register', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const bot = await getUserBot(req.directusToken!, req.params.id);
      const baseUrl = resolvePublicBaseUrl(req);
      const webhookUrl = `${baseUrl}/api/webhooks/bale/${bot.webhook_secret}`;

      const baleRes = await setBaleWebhook(bot.bot_token, webhookUrl, bot.webhook_secret);
      const status = baleRes.ok ? 'active' : 'error';
      const updatedBot = await updateUserBot(req.directusToken!, bot.id, {
        webhook_status: status,
      });

      if (!baleRes.ok) {
        res.status(400).json({
          error: baleRes.description || 'ثبت وب‌هوک در پیام‌رسان بله ناموفق بود.',
          bot: updatedBot,
          webhookUrl,
        });
        return;
      }

      res.json({ ok: true, bot: updatedBot, webhookUrl, baleResponse: baleRes });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post('/api/bots/:id/webhook/remove', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const bot = await getUserBot(req.directusToken!, req.params.id);
      await deleteBaleWebhook(bot.bot_token);
      const updatedBot = await updateUserBot(req.directusToken!, bot.id, {
        webhook_status: 'inactive',
      });
      res.json({ ok: true, bot: updatedBot });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  // ---------------- Flows, Forms, Logs, Sessions ----------------
  app.get('/api/bots/:id/flow', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const flows = await listBotFlows(req.directusToken!, req.params.id);
      res.json({ flow: flows[0] || null, flows });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.put('/api/bots/:id/flow', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const { flowId, name, flow_json, is_published = true } = req.body as {
        flowId?: string;
        name?: string;
        flow_json: FlowDefinition;
        is_published?: boolean;
      };

      if (!flow_json || !Array.isArray(flow_json.nodes)) {
        res.status(400).json({ error: 'ساختار JSON جریان گفتگو نامعتبر است.' });
        return;
      }

      if (flowId) {
        const updated = await updateBotFlow(req.directusToken!, flowId, {
          name: name || 'جریان اصلی گفتگو',
          flow_json,
          is_published,
        });
        res.json({ flow: updated });
        return;
      }

      const existing = await listBotFlows(req.directusToken!, req.params.id);
      if (existing[0]) {
        const updated = await updateBotFlow(req.directusToken!, existing[0].id, {
          name: name || existing[0].name,
          version: (existing[0].version || 1) + 1,
          flow_json,
          is_published,
        });
        res.json({ flow: updated });
        return;
      }

      const created = await createBotFlow(req.directusToken!, {
        bot_id: req.params.id,
        name: name || 'جریان اصلی گفتگو',
        version: 1,
        is_published,
        flow_json,
      });
      res.status(201).json({ flow: created });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.get('/api/bots/:id/forms', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const forms = await listCollectedForms(req.directusToken!, req.params.id);
      res.json({ forms });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.delete('/api/bots/:id/forms/:recordId', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      await deleteCollectedForm(req.directusToken!, req.params.recordId);
      res.json({ ok: true });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.get('/api/bots/:id/logs', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const logs = await listWebhookLogs(req.directusToken!, req.params.id);
      res.json({ logs });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.get('/api/bots/:id/sessions', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const sessions = await listBotSessions(req.directusToken!, req.params.id);
      res.json({ sessions });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  // ---------------- Inbound Bale Webhook Receiver (Async Queue) ----------------
  app.post('/api/webhooks/bale/:webhookSecret', async (req, res) => {
    const { webhookSecret } = req.params;
    const update = req.body as BaleUpdate;

    if (!webhookSecret || !update || typeof update.update_id === 'undefined') {
      res.status(400).json({ ok: false, error: 'Invalid Bale update payload' });
      return;
    }

    try {
      // Respond immediately after queuing to prevent Bale webhook timeouts
      await enqueueWebhookUpdate(webhookSecret, update);
      res.status(200).json({ ok: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Queue unavailable';
      console.error('Webhook enqueue error:', message);
      res.status(503).json({ ok: false, error: message });
    }
  });

  // ---------------- Interactive Flow Simulator (Dry-Run Engine) ----------------
  app.post('/api/simulator/dispatch', async (req, res) => {
    try {
      const {
        botId = 'simulator-bot',
        chatId = 'sim-chat-1',
        userName = 'کاربر تست',
        flow,
        text,
        callbackData,
      } = req.body as {
        botId?: string;
        chatId?: string;
        userName?: string;
        flow: FlowDefinition;
        text?: string;
        callbackData?: string;
      };

      if (!flow || !Array.isArray(flow.nodes)) {
        res.status(400).json({ error: 'Flow definition is required.' });
        return;
      }

      const numericChatId = 100001;
      const update: BaleUpdate = callbackData
        ? {
            update_id: Date.now(),
            callback_query: {
              id: `cb_${Date.now()}`,
              from: { id: numericChatId, first_name: userName },
              message: { message_id: 1, chat: { id: numericChatId } },
              data: callbackData,
            },
          }
        : {
            update_id: Date.now(),
            message: {
              message_id: Math.floor(Date.now() / 1000),
              from: { id: numericChatId, first_name: userName },
              chat: { id: numericChatId, type: 'private' },
              date: Math.floor(Date.now() / 1000),
              text: text || '',
            },
          };

      const result = await executeBotFlow({
        botId,
        flow,
        update,
        dryRun: true,
      });

      res.json(result);
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post('/api/simulator/reset', async (req, res) => {
    const { botId = 'simulator-bot', chatId = '100001' } = req.body as {
      botId?: string;
      chatId?: string;
    };
    await clearSimulatorSession(botId, chatId);
    res.json({ ok: true });
  });

  // ---------------- Vite / Static Frontend Serving ----------------
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Balesaz server listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, closing server gracefully...`);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
