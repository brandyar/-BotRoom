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
  createBookingSchedule,
  createBookingService,
  createBotFlow,
  createBroadcastCampaign,
  createUserBot,
  createUserProduct,
  createUserSurvey,
  deleteAppointment,
  deleteBookingSchedule,
  deleteBookingService,
  deleteBotContact,
  deleteBotOrder,
  deleteBroadcastCampaign,
  deleteCollectedForm,
  deleteSurveyResponse,
  deleteUserBot,
  deleteUserProduct,
  deleteUserSurvey,
  DirectusApiError,
  DirectusConfigError,
  getCampaignAsAdmin,
  getCurrentDirectusUser,
  getDirectusConfig,
  getUserBot,
  listAppointments,
  listAppointmentsAsAdmin,
  listBookingSchedules,
  listBookingSchedulesAsAdmin,
  listBookingServices,
  listBookingServicesAsAdmin,
  listBotContacts,
  listBotFlows,
  listBotOrders,
  listBotSessions,
  listBotSurveys,
  listBroadcastCampaigns,
  listCollectedForms,
  listProductsAsAdmin,
  listSurveyResponses,
  listUserBots,
  listUserProducts,
  listWebhookLogs,
  loginWithDirectus,
  logoutDirectus,
  refreshDirectusToken,
  registerUserInDirectus,
  updateAppointment,
  updateBookingSchedule,
  updateBookingService,
  updateBotContact,
  updateBotFlow,
  updateBotOrder,
  updateBroadcastCampaign,
  updateCampaignAsAdmin,
  updateUserBot,
  updateUserProduct,
  updateUserSurvey,
} from './src/server/directus.ts';
import { executeBotFlow } from './src/server/flowEngine.ts';
import {
  executeBroadcastCampaign,
  runAppointmentReminderSweep,
  startPhase4Schedulers,
} from './src/server/scheduler.ts';
import { clearSimulatorSession } from './src/server/sessionStore.ts';
import { enqueueWebhookUpdate, startWebhookWorker } from './src/server/webhookQueue.ts';
import type {
  AppointmentRecord,
  BaleUpdate,
  BookingScheduleRecord,
  BookingServiceRecord,
  FlowDefinition,
  ProductRecord,
  SurveyRecord,
} from './src/types/bot.ts';

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

  // Start Redis background worker & Phase 4 schedulers (reminders + scheduled broadcasts)
  startWebhookWorker();
  startPhase4Schedulers();

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
      const {
        flowId,
        name,
        flow_json,
        is_published = true,
        saveAsNewVersion = false,
      } = req.body as {
        flowId?: string;
        name?: string;
        flow_json: FlowDefinition;
        is_published?: boolean;
        saveAsNewVersion?: boolean;
      };

      if (!flow_json || !Array.isArray(flow_json.nodes)) {
        res.status(400).json({ error: 'ساختار JSON جریان گفتگو نامعتبر است.' });
        return;
      }

      const existing = await listBotFlows(req.directusToken!, req.params.id);

      if (saveAsNewVersion || existing.length === 0) {
        const maxVersion = existing.reduce((max, item) => Math.max(max, item.version || 1), 0);
        if (is_published) {
          await Promise.all(
            existing
              .filter((f) => f.is_published)
              .map((f) => updateBotFlow(req.directusToken!, f.id, { is_published: false }))
          );
        }
        const created = await createBotFlow(req.directusToken!, {
          bot_id: req.params.id,
          name: name || existing[0]?.name || 'جریان اصلی گفتگو',
          version: maxVersion + 1,
          is_published,
          flow_json,
        });
        const flows = await listBotFlows(req.directusToken!, req.params.id);
        res.status(201).json({ flow: created, flows });
        return;
      }

      const targetId = flowId || existing[0].id;
      if (is_published) {
        await Promise.all(
          existing
            .filter((f) => f.id !== targetId && f.is_published)
            .map((f) => updateBotFlow(req.directusToken!, f.id, { is_published: false }))
        );
      }

      const updated = await updateBotFlow(req.directusToken!, targetId, {
        name: name || existing.find((f) => f.id === targetId)?.name || 'جریان اصلی گفتگو',
        flow_json,
        is_published,
      });
      const flows = await listBotFlows(req.directusToken!, req.params.id);
      res.json({ flow: updated, flows });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post(
    '/api/bots/:id/flow/:flowId/publish',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        const existing = await listBotFlows(req.directusToken!, req.params.id);
        const target = existing.find((f) => f.id === req.params.flowId);
        if (!target) {
          res.status(404).json({ error: 'نسخه جریان مورد نظر یافت نشد.' });
          return;
        }

        await Promise.all(
          existing
            .filter((f) => f.id !== target.id && f.is_published)
            .map((f) => updateBotFlow(req.directusToken!, f.id, { is_published: false }))
        );

        const published = await updateBotFlow(req.directusToken!, target.id, {
          is_published: true,
        });
        const flows = await listBotFlows(req.directusToken!, req.params.id);
        res.json({ flow: published, flows });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

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

  app.get('/api/bots/:id/contacts', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const contacts = await listBotContacts(req.directusToken!, req.params.id);
      res.json({ contacts });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.patch(
    '/api/bots/:id/contacts/:contactId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        const contact = await updateBotContact(req.directusToken!, req.params.contactId, req.body);
        res.json({ contact });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.delete(
    '/api/bots/:id/contacts/:contactId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        await deleteBotContact(req.directusToken!, req.params.contactId);
        res.json({ ok: true });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  // ---------------- Products & Orders (Phase 3) ----------------
  app.get('/api/bots/:id/products', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const products = await listUserProducts(req.directusToken!, req.params.id);
      res.json({ products });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post('/api/bots/:id/products', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const { title, description, category, price, stock, image_url, is_active } = req.body as {
        title?: string;
        description?: string | null;
        category?: string | null;
        price?: number;
        stock?: number;
        image_url?: string | null;
        is_active?: boolean;
      };
      if (!title?.trim()) {
        res.status(400).json({ error: 'عنوان محصول یا خدمت الزامی است.' });
        return;
      }
      const product = await createUserProduct(req.directusToken!, {
        bot_id: req.params.id,
        title: title.trim(),
        description: description?.trim() || null,
        category: category?.trim() || null,
        price: Number(price || 0),
        stock: Number(stock ?? 0),
        image_url: image_url?.trim() || null,
        is_active: is_active !== false,
      });
      res.status(201).json({ product });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.patch(
    '/api/bots/:id/products/:productId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        const product = await updateUserProduct(
          req.directusToken!,
          req.params.productId,
          req.body
        );
        res.json({ product });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.delete(
    '/api/bots/:id/products/:productId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        await deleteUserProduct(req.directusToken!, req.params.productId);
        res.json({ ok: true });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.get('/api/bots/:id/orders', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const orders = await listBotOrders(req.directusToken!, req.params.id);
      res.json({ orders });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.patch(
    '/api/bots/:id/orders/:orderId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        const order = await updateBotOrder(req.directusToken!, req.params.orderId, req.body);
        res.json({ order });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.delete(
    '/api/bots/:id/orders/:orderId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        await deleteBotOrder(req.directusToken!, req.params.orderId);
        res.json({ ok: true });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  // ---------------- Surveys & Responses (Phase 3) ----------------
  app.get('/api/bots/:id/surveys', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const surveys = await listBotSurveys(req.directusToken!, req.params.id);
      res.json({ surveys });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post('/api/bots/:id/surveys', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const { title, type = 'rating', questions_json = [], allow_multiple = true } = req.body as {
        title?: string;
        type?: 'rating' | 'multi_choice';
        questions_json?: SurveyRecord['questions_json'];
        allow_multiple?: boolean;
      };
      if (!title?.trim()) {
        res.status(400).json({ error: 'عنوان نظرسنجی الزامی است.' });
        return;
      }
      const survey = await createUserSurvey(req.directusToken!, {
        bot_id: req.params.id,
        title: title.trim(),
        type,
        questions_json,
        allow_multiple,
      });
      res.status(201).json({ survey });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.patch(
    '/api/bots/:id/surveys/:surveyId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        const survey = await updateUserSurvey(req.directusToken!, req.params.surveyId, req.body);
        res.json({ survey });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.delete(
    '/api/bots/:id/surveys/:surveyId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        await deleteUserSurvey(req.directusToken!, req.params.surveyId);
        res.json({ ok: true });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.get(
    '/api/bots/:id/survey-responses',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        const responses = await listSurveyResponses(req.directusToken!, req.params.id);
        res.json({ responses });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.delete(
    '/api/bots/:id/survey-responses/:responseId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        await deleteSurveyResponse(req.directusToken!, req.params.responseId);
        res.json({ ok: true });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  // ---------------- Booking Services, Schedules & Appointments (Phase 4) ----------------
  app.get('/api/bots/:id/booking-services', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const services = await listBookingServices(req.directusToken!, req.params.id);
      res.json({ services });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post('/api/bots/:id/booking-services', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const { title, description, duration_minutes, capacity_per_slot, price, is_active } =
        req.body as {
          title?: string;
          description?: string | null;
          duration_minutes?: number;
          capacity_per_slot?: number;
          price?: number;
          is_active?: boolean;
        };
      if (!title?.trim()) {
        res.status(400).json({ error: 'عنوان سرویس نوبت‌دهی الزامی است.' });
        return;
      }
      const service = await createBookingService(req.directusToken!, {
        bot_id: req.params.id,
        title: title.trim(),
        description: description?.trim() || null,
        duration_minutes: Number(duration_minutes || 30),
        capacity_per_slot: Number(capacity_per_slot || 1),
        price: Number(price || 0),
        is_active: is_active !== false,
      });
      res.status(201).json({ service });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.patch(
    '/api/bots/:id/booking-services/:serviceId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        const service = await updateBookingService(
          req.directusToken!,
          req.params.serviceId,
          req.body
        );
        res.json({ service });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.delete(
    '/api/bots/:id/booking-services/:serviceId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        await deleteBookingService(req.directusToken!, req.params.serviceId);
        res.json({ ok: true });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.get('/api/bots/:id/booking-schedules', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const schedules = await listBookingSchedules(req.directusToken!, req.params.id);
      res.json({ schedules });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post(
    '/api/bots/:id/booking-schedules',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        const { service_id, weekday, start_time, end_time, blocked_dates, is_active } =
          req.body as {
            service_id?: string;
            weekday?: number;
            start_time?: string;
            end_time?: string;
            blocked_dates?: string[];
            is_active?: boolean;
          };
        if (!service_id || !start_time || !end_time) {
          res.status(400).json({ error: 'انتخاب سرویس، ساعت شروع و ساعت پایان الزامی است.' });
          return;
        }
        const schedule = await createBookingSchedule(req.directusToken!, {
          bot_id: req.params.id,
          service_id,
          weekday: Number(weekday ?? 0),
          start_time,
          end_time,
          blocked_dates: Array.isArray(blocked_dates) ? blocked_dates : [],
          is_active: is_active !== false,
        });
        res.status(201).json({ schedule });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.patch(
    '/api/bots/:id/booking-schedules/:scheduleId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        const schedule = await updateBookingSchedule(
          req.directusToken!,
          req.params.scheduleId,
          req.body
        );
        res.json({ schedule });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.delete(
    '/api/bots/:id/booking-schedules/:scheduleId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        await deleteBookingSchedule(req.directusToken!, req.params.scheduleId);
        res.json({ ok: true });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.get('/api/bots/:id/appointments', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const appointments = await listAppointments(req.directusToken!, req.params.id);
      res.json({ appointments });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.patch(
    '/api/bots/:id/appointments/:appointmentId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        const appointment = await updateAppointment(
          req.directusToken!,
          req.params.appointmentId,
          req.body
        );
        res.json({ appointment });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.delete(
    '/api/bots/:id/appointments/:appointmentId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        await deleteAppointment(req.directusToken!, req.params.appointmentId);
        res.json({ ok: true });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.post(
    '/api/bots/:id/appointments/send-reminders',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        await getUserBot(req.directusToken!, req.params.id);
        const summary = await runAppointmentReminderSweep(req.params.id);
        res.json(summary);
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  // ---------------- Broadcast Campaigns (Phase 4) ----------------
  app.get('/api/bots/:id/campaigns', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const campaigns = await listBroadcastCampaigns(req.directusToken!, req.params.id);
      res.json({ campaigns });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.post('/api/bots/:id/campaigns', requireBearerToken, async (req: AuthedRequest, res) => {
    try {
      const { title, message_text, media_url, target_tags, scheduled_at } = req.body as {
        title?: string;
        message_text?: string;
        media_url?: string | null;
        target_tags?: string[];
        scheduled_at?: string | null;
      };
      if (!title?.trim() || !message_text?.trim()) {
        res.status(400).json({ error: 'عنوان کمپین و متن پیام ارسالی الزامی است.' });
        return;
      }
      const campaign = await createBroadcastCampaign(req.directusToken!, {
        bot_id: req.params.id,
        title: title.trim(),
        message_text: message_text.trim(),
        media_url: media_url?.trim() || null,
        target_tags: Array.isArray(target_tags) ? target_tags : [],
        scheduled_at: scheduled_at || null,
        status: scheduled_at ? 'queued' : 'draft',
      });
      res.status(201).json({ campaign });
    } catch (error) {
      handleApiError(res, error);
    }
  });

  app.patch(
    '/api/bots/:id/campaigns/:campaignId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        const campaign = await updateBroadcastCampaign(
          req.directusToken!,
          req.params.campaignId,
          req.body
        );
        res.json({ campaign });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.delete(
    '/api/bots/:id/campaigns/:campaignId',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        await deleteBroadcastCampaign(req.directusToken!, req.params.campaignId);
        res.json({ ok: true });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

  app.post(
    '/api/bots/:id/campaigns/:campaignId/send',
    requireBearerToken,
    async (req: AuthedRequest, res) => {
      try {
        await getUserBot(req.directusToken!, req.params.id);
        const existingCampaign = await getCampaignAsAdmin(req.params.campaignId);
        if (!existingCampaign || existingCampaign.bot_id !== req.params.id) {
          res.status(404).json({ error: 'کمپین مورد نظر برای این بازو یافت نشد.' });
          return;
        }
        const queued = await updateCampaignAsAdmin(req.params.campaignId, {
          status: 'queued',
        });
        void executeBroadcastCampaign(req.params.campaignId);
        res.json({ ok: true, campaign: queued });
      } catch (error) {
        handleApiError(res, error);
      }
    }
  );

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
        userName = 'کاربر تست',
        flow,
        text,
        callbackData,
        contactPhone,
        simulatedTags,
        resumeNodeId,
        previewProducts,
        previewSurveys,
        previewBookingServices,
        previewBookingSchedules,
        previewAppointments,
      } = req.body as {
        botId?: string;
        chatId?: string;
        userName?: string;
        flow: FlowDefinition;
        text?: string;
        callbackData?: string;
        contactPhone?: string;
        simulatedTags?: string[];
        resumeNodeId?: string;
        previewProducts?: ProductRecord[];
        previewSurveys?: SurveyRecord[];
        previewBookingServices?: BookingServiceRecord[];
        previewBookingSchedules?: BookingScheduleRecord[];
        previewAppointments?: AppointmentRecord[];
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
        : contactPhone
        ? {
            update_id: Date.now(),
            message: {
              message_id: Math.floor(Date.now() / 1000),
              from: { id: numericChatId, first_name: userName },
              chat: { id: numericChatId, type: 'private' },
              date: Math.floor(Date.now() / 1000),
              contact: {
                phone_number: contactPhone,
                first_name: userName,
                user_id: numericChatId,
              },
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

      let effectiveProducts = previewProducts;
      if ((!effectiveProducts || effectiveProducts.length === 0) && botId !== 'simulator-bot') {
        effectiveProducts = await listProductsAsAdmin(botId).catch(() => []);
      }

      let effectiveBookingServices = previewBookingServices;
      let effectiveBookingSchedules = previewBookingSchedules;
      let effectiveAppointments = previewAppointments;
      if (botId !== 'simulator-bot') {
        if (!effectiveBookingServices || effectiveBookingServices.length === 0) {
          effectiveBookingServices = await listBookingServicesAsAdmin(botId).catch(() => []);
        }
        if (!effectiveBookingSchedules || effectiveBookingSchedules.length === 0) {
          effectiveBookingSchedules = await listBookingSchedulesAsAdmin(botId).catch(() => []);
        }
        if (!effectiveAppointments) {
          effectiveAppointments = await listAppointmentsAsAdmin(botId).catch(() => []);
        }
      }

      const result = await executeBotFlow({
        botId,
        flow,
        update,
        dryRun: true,
        simulatedTags,
        startAtNodeId: resumeNodeId,
        previewProducts: effectiveProducts,
        previewSurveys,
        previewBookingServices: effectiveBookingServices,
        previewBookingSchedules: effectiveBookingSchedules,
        previewAppointments: effectiveAppointments,
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
