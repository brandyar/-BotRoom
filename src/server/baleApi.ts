import type { BaleSendMessagePayload } from '../types/bot.ts';

const BALE_API_BASE = (process.env.BALE_API_BASE_URL || 'https://tapi.bale.ai').replace(/\/$/, '');

export interface BaleApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function callBaleMethod<T = unknown>(
  botToken: string,
  method: string,
  body?: Record<string, unknown>
): Promise<BaleApiResponse<T>> {
  const url = `${BALE_API_BASE}/bot${encodeURIComponent(botToken)}/${method}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const data = (await response.json()) as BaleApiResponse<T>;
    return data;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Bale API request failed';
    return {
      ok: false,
      description: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getBaleBotMe(botToken: string) {
  return callBaleMethod<{
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  }>(botToken, 'getMe');
}

export async function setBaleWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken?: string
) {
  return callBaleMethod<boolean>(botToken, 'setWebhook', {
    url: webhookUrl,
    ...(secretToken ? { secret_token: secretToken } : {}),
  });
}

export async function deleteBaleWebhook(botToken: string) {
  return callBaleMethod<boolean>(botToken, 'deleteWebhook');
}

export async function getBaleWebhookInfo(botToken: string) {
  return callBaleMethod<{
    url?: string;
    has_custom_certificate?: boolean;
    pending_update_count?: number;
    last_error_message?: string;
  }>(botToken, 'getWebhookInfo');
}

export async function sendBaleMessage(
  botToken: string,
  payload: BaleSendMessagePayload
) {
  return callBaleMethod<{ message_id: number }>(botToken, 'sendMessage', payload as unknown as Record<string, unknown>);
}

export async function answerBaleCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string
) {
  return callBaleMethod<boolean>(botToken, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}
