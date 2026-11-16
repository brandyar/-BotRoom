import Redis from 'ioredis';
import type { BotSessionRecord } from '../types/bot.ts';
import { findSessionInDirectus, getDirectusConfig, saveSessionInDirectus } from './directus.ts';

const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours

let redisClient: Redis | null = null;
const memorySessionCache = new Map<string, { session: BotSessionRecord; expiresAt: number }>();

export function getRedisClient(): Redis | null {
  const redisUrl = (process.env.REDIS_URL || '').trim();
  if (!redisUrl) return null;

  if (!redisClient) {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
    redisClient.on('error', (err) => {
      console.error('Redis connection error (sessionStore):', err.message);
    });
  }
  return redisClient;
}

function cacheKey(botId: string, chatId: string): string {
  return `balesaz:session:${botId}:${chatId}`;
}

export async function getOrInitSession(params: {
  botId: string;
  chatId: string;
  userId: string;
  userName?: string | null;
  persistToDirectus?: boolean;
}): Promise<BotSessionRecord> {
  const key = cacheKey(params.botId, params.chatId);
  const redis = getRedisClient();

  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        const parsed = JSON.parse(cached) as BotSessionRecord;
        if (params.userName && parsed.bale_user_name !== params.userName) {
          parsed.bale_user_name = params.userName;
        }
        return parsed;
      }
    } catch (err) {
      console.warn('Redis get session fallback:', err);
    }
  } else {
    const mem = memorySessionCache.get(key);
    if (mem && mem.expiresAt > Date.now()) {
      return { ...mem.session, context_data: { ...mem.session.context_data } };
    }
  }

  // Fallback to Directus persistent store if configured
  const { isConfigured, hasAdminToken } = getDirectusConfig();
  if (params.persistToDirectus !== false && isConfigured && hasAdminToken) {
    try {
      const existing = await findSessionInDirectus(params.botId, params.chatId);
      if (existing) {
        const normalized: BotSessionRecord = {
          ...existing,
          context_data: existing.context_data || {},
        };
        await cacheSessionLocally(key, normalized);
        return normalized;
      }
    } catch (err) {
      console.warn('Directus findSession fallback:', err);
    }
  }

  const fresh: BotSessionRecord = {
    bot_id: params.botId,
    bale_chat_id: params.chatId,
    bale_user_id: params.userId,
    bale_user_name: params.userName || null,
    current_node_id: null,
    awaiting_field_key: null,
    context_data: {},
    last_interaction_at: new Date().toISOString(),
  };

  await cacheSessionLocally(key, fresh);
  return fresh;
}

async function cacheSessionLocally(key: string, session: BotSessionRecord): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.setex(key, SESSION_TTL_SECONDS, JSON.stringify(session));
      return;
    } catch (err) {
      console.warn('Redis setex session fallback:', err);
    }
  }
  memorySessionCache.set(key, {
    session: { ...session, context_data: { ...session.context_data } },
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  });
}

export async function persistSession(
  session: BotSessionRecord,
  options: { persistToDirectus?: boolean } = {}
): Promise<BotSessionRecord> {
  const updated: BotSessionRecord = {
    ...session,
    last_interaction_at: new Date().toISOString(),
  };
  const key = cacheKey(updated.bot_id, updated.bale_chat_id);

  const { isConfigured, hasAdminToken } = getDirectusConfig();
  if (options.persistToDirectus !== false && isConfigured && hasAdminToken) {
    try {
      const saved = await saveSessionInDirectus(updated);
      updated.id = saved.id;
    } catch (err) {
      console.error('Failed to persist session to Directus:', err);
    }
  }

  await cacheSessionLocally(key, updated);
  return updated;
}

export async function clearSimulatorSession(botId: string, chatId: string): Promise<void> {
  const key = cacheKey(botId, chatId);
  memorySessionCache.delete(key);
  const redis = getRedisClient();
  if (redis) {
    await redis.del(key).catch(() => undefined);
  }
}
