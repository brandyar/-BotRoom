import type { BaleUpdate } from '../types/bot.ts';
import {
  createWebhookLogAsAdmin,
  findBotByWebhookSecret,
  findPublishedFlowForBot,
  getBackendConfig,
} from './backend.ts';
import { executeBotFlow } from './flowEngine.ts';
import { getRedisClient } from './sessionStore.ts';

export interface WebhookJob {
  jobId: string;
  webhookSecret: string;
  update: BaleUpdate;
  enqueuedAt: number;
  attempts: number;
}

const REDIS_QUEUE_KEY = 'balesaz:webhook_jobs';
const MAX_RETRIES = 2;

// In-process async queue fallback when REDIS_URL is not configured
const localQueue: WebhookJob[] = [];
let localWorkerActive = false;
let redisWorkerStarted = false;

async function processWebhookJob(job: WebhookJob): Promise<void> {
  const startedAt = Date.now();
  const { webhookSecret, update } = job;

  const bot = await findBotByWebhookSecret(webhookSecret);
  if (!bot || !bot.is_active) {
    return;
  }

  const chatId = String(
    update.message?.chat.id || update.callback_query?.message?.chat.id || update.callback_query?.from.id || ''
  );
  const eventType = update.callback_query ? 'callback_query' : 'message';
  const incomingText = update.callback_query?.data || update.message?.text || '';

  try {
    const flowRecord = await findPublishedFlowForBot(bot.id);
    if (!flowRecord || !flowRecord.flow_json) {
      await createWebhookLogAsAdmin({
        bot_id: bot.id,
        update_id: String(update.update_id),
        event_type: 'system',
        bale_chat_id: chatId,
        incoming_text: incomingText,
        status: 'failed',
        latency_ms: Date.now() - startedAt,
        error_message: 'هیچ جریان گفتگوی منتشرشده‌ای برای این بازو یافت نشد.',
      });
      return;
    }

    const result = await executeBotFlow({
      botId: bot.id,
      flowId: flowRecord.id,
      botToken: bot.bot_token,
      flow: flowRecord.flow_json,
      update,
      dryRun: false,
    });

    await createWebhookLogAsAdmin({
      bot_id: bot.id,
      update_id: String(update.update_id),
      event_type: eventType,
      bale_chat_id: chatId,
      incoming_text: incomingText,
      matched_node_id: result.matchedNodeId,
      status: 'processed',
      latency_ms: Date.now() - startedAt,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown worker error';
    console.error(`Webhook job ${job.jobId} failed:`, errorMessage);

    if (job.attempts < MAX_RETRIES) {
      const retryJob: WebhookJob = { ...job, attempts: job.attempts + 1 };
      setTimeout(() => {
        void enqueueWebhookUpdate(retryJob.webhookSecret, retryJob.update, retryJob.attempts);
      }, 600 * (job.attempts + 1));
      return;
    }

    await createWebhookLogAsAdmin({
      bot_id: bot.id,
      update_id: String(update.update_id),
      event_type: 'error',
      bale_chat_id: chatId,
      incoming_text: incomingText,
      status: 'failed',
      latency_ms: Date.now() - startedAt,
      error_message: errorMessage,
    }).catch((logErr) => console.error('Failed to write webhook_logs error entry:', logErr));
  }
}

async function drainLocalQueue(): Promise<void> {
  if (localWorkerActive) return;
  localWorkerActive = true;

  try {
    while (localQueue.length > 0) {
      const job = localQueue.shift();
      if (!job) break;
      await processWebhookJob(job);
    }
  } finally {
    localWorkerActive = false;
  }
}

export function startWebhookWorker(): void {
  const redis = getRedisClient();
  if (!redis || redisWorkerStarted) return;

  redisWorkerStarted = true;
  const workerLoop = async () => {
    while (redisWorkerStarted) {
      try {
        const res = await redis.brpop(REDIS_QUEUE_KEY, 5);
        if (res && res[1]) {
          const job = JSON.parse(res[1]) as WebhookJob;
          await processWebhookJob(job);
        }
      } catch (err) {
        console.error('Redis webhook worker loop error:', err);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  };
  void workerLoop();
}

export async function enqueueWebhookUpdate(
  webhookSecret: string,
  update: BaleUpdate,
  attempts = 0
): Promise<{ queued: boolean; driver: 'redis' | 'memory' }> {
  const { isConfigured, hasAdminToken } = getBackendConfig();
  if (!isConfigured || !hasAdminToken) {
    throw new Error('Backend server credentials are not configured.');
  }

  const job: WebhookJob = {
    jobId: `${update.update_id}-${Date.now()}`,
    webhookSecret,
    update,
    enqueuedAt: Date.now(),
    attempts,
  };

  const redis = getRedisClient();
  if (redis) {
    try {
      startWebhookWorker();
      await redis.lpush(REDIS_QUEUE_KEY, JSON.stringify(job));
      return { queued: true, driver: 'redis' };
    } catch (err) {
      console.warn('Redis lpush failed, falling back to async local queue:', err);
    }
  }

  localQueue.push(job);
  setImmediate(() => {
    void drainLocalQueue();
  });
  return { queued: true, driver: 'memory' };
}
