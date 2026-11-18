import type { BaleReplyMarkup, BaleSendMessagePayload } from '../types/bot.ts';

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
  return callBaleMethod<{ message_id: number }>(botToken, 'sendMessage', {
    chat_id: payload.chat_id,
    text: payload.text,
    ...(payload.reply_markup ? { reply_markup: payload.reply_markup } : {}),
    ...(payload.reply_to_message_id ? { reply_to_message_id: payload.reply_to_message_id } : {}),
  });
}

export async function sendBalePhoto(
  botToken: string,
  payload: {
    chat_id: number | string;
    photo: string;
    caption?: string;
    reply_markup?: BaleReplyMarkup;
  }
) {
  return callBaleMethod<{ message_id: number }>(botToken, 'sendPhoto', {
    chat_id: payload.chat_id,
    photo: payload.photo,
    ...(payload.caption ? { caption: payload.caption } : {}),
    ...(payload.reply_markup ? { reply_markup: payload.reply_markup } : {}),
  });
}

export async function editBaleMessageText(
  botToken: string,
  payload: {
    chat_id: number | string;
    message_id: number;
    text: string;
    reply_markup?: BaleReplyMarkup;
  }
) {
  return callBaleMethod<{ message_id: number } | boolean>(botToken, 'editMessageText', {
    chat_id: payload.chat_id,
    message_id: payload.message_id,
    text: payload.text,
    ...(payload.reply_markup ? { reply_markup: payload.reply_markup } : {}),
  });
}

export async function editBaleMessageCaption(
  botToken: string,
  payload: {
    chat_id: number | string;
    message_id: number;
    caption: string;
    reply_markup?: BaleReplyMarkup;
  }
) {
  return callBaleMethod<{ message_id: number } | boolean>(botToken, 'editMessageCaption', {
    chat_id: payload.chat_id,
    message_id: payload.message_id,
    caption: payload.caption,
    ...(payload.reply_markup ? { reply_markup: payload.reply_markup } : {}),
  });
}

export async function editBaleMessageReplyMarkup(
  botToken: string,
  payload: {
    chat_id: number | string;
    message_id: number;
    reply_markup?: BaleReplyMarkup;
  }
) {
  return callBaleMethod<{ message_id: number } | boolean>(botToken, 'editMessageReplyMarkup', {
    chat_id: payload.chat_id,
    message_id: payload.message_id,
    ...(payload.reply_markup ? { reply_markup: payload.reply_markup } : {}),
  });
}

export async function dispatchBaleOutgoingPayload(
  botToken: string,
  payload: BaleSendMessagePayload
) {
  if (payload.is_edit && payload.edit_message_id) {
    if (payload.photo_url && payload.has_source_photo) {
      const res = await editBaleMessageCaption(botToken, {
        chat_id: payload.chat_id,
        message_id: payload.edit_message_id,
        caption: payload.text,
        reply_markup: payload.reply_markup,
      });
      if (res.ok) return res;
    } else if (!payload.photo_url && !payload.has_source_photo) {
      const res = await editBaleMessageText(botToken, {
        chat_id: payload.chat_id,
        message_id: payload.edit_message_id,
        text: payload.text,
        reply_markup: payload.reply_markup,
      });
      if (res.ok) return res;
    }
  }

  if (payload.photo_url) {
    const photoRes = await sendBalePhoto(botToken, {
      chat_id: payload.chat_id,
      photo: payload.photo_url,
      caption: payload.text,
      reply_markup: payload.reply_markup,
    });
    if (photoRes.ok) return photoRes;
    // Fallback to sendMessage if Bale could not fetch external photo_url
    return sendBaleMessage(botToken, {
      chat_id: payload.chat_id,
      text: payload.text,
      reply_markup: payload.reply_markup,
    });
  }

  return sendBaleMessage(botToken, payload);
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
