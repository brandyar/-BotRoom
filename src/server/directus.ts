import type {
  BotFlowRecord,
  BotRecord,
  BotSessionRecord,
  CollectedFormRecord,
  DirectusUser,
  FlowDefinition,
  WebhookLogRecord,
} from '../types/bot.ts';

export class DirectusConfigError extends Error {
  constructor(message = 'متغیر محیطی DIRECTUS_URL روی سرور تنظیم نشده است.') {
    super(message);
    this.name = 'DirectusConfigError';
  }
}

export class DirectusApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = 'DirectusApiError';
    this.status = status;
    this.code = code;
  }
}

export function getDirectusConfig() {
  const url = (process.env.DIRECTUS_URL || '').trim().replace(/\/$/, '');
  const adminToken = (process.env.DIRECTUS_ADMIN_TOKEN || '').trim();
  const defaultRoleId = (process.env.DIRECTUS_DEFAULT_ROLE_ID || '').trim();

  return {
    url,
    adminToken,
    defaultRoleId,
    isConfigured: Boolean(url && !url.includes('your-directus-instance')),
    hasAdminToken: Boolean(adminToken && !adminToken.includes('YOUR_DIRECTUS_ADMIN_TOKEN')),
  };
}

interface DirectusResponse<T> {
  data: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

async function directusFetch<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    token?: string;
    body?: unknown;
  } = {}
): Promise<T> {
  const { url, isConfigured } = getDirectusConfig();
  if (!isConfigured) {
    throw new DirectusConfigError();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const res = await fetch(`${url}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const json = (await res.json().catch(() => ({}))) as Partial<DirectusResponse<T>>;
  if (!res.ok) {
    const firstError = json.errors?.[0];
    const code = firstError?.extensions?.code;
    let message = firstError?.message || `Directus request failed (${res.status})`;
    if (res.status === 403 || code === 'FORBIDDEN') {
      message = `دسترسی توسط دایرکتوس رد شد (403) در مسیر ${path}. لطفاً دسترسی‌های نقش کاربر یا توکن ادمین را در دایرکتوس بررسی کنید.`;
    }
    throw new DirectusApiError(message, res.status, code);
  }

  return json.data as T;
}

function requireAdminToken(): string {
  const { adminToken, hasAdminToken } = getDirectusConfig();
  if (!hasAdminToken) {
    throw new DirectusConfigError('متغیر DIRECTUS_ADMIN_TOKEN برای عملیات سرور تنظیم نشده است.');
  }
  return adminToken;
}

// ---------------- Auth Operations ----------------

export interface DirectusAuthTokens {
  access_token: string;
  refresh_token: string;
  expires: number;
}

export async function loginWithDirectus(email: string, password: string) {
  return directusFetch<DirectusAuthTokens>('/auth/login', {
    method: 'POST',
    body: { email, password, mode: 'json' },
  });
}

export async function refreshDirectusToken(refreshToken: string) {
  return directusFetch<DirectusAuthTokens>('/auth/refresh', {
    method: 'POST',
    body: { refresh_token: refreshToken, mode: 'json' },
  });
}

export async function logoutDirectus(refreshToken: string) {
  return directusFetch<void>('/auth/logout', {
    method: 'POST',
    body: { refresh_token: refreshToken, mode: 'json' },
  });
}

export async function getCurrentDirectusUser(accessToken: string) {
  return directusFetch<DirectusUser>(
    '/users/me?fields=id,email,first_name,last_name,role',
    { token: accessToken }
  );
}

export async function registerUserInDirectus(params: {
  email: string;
  password: string;
  firstName: string;
  lastName?: string;
}) {
  const adminToken = requireAdminToken();
  const { defaultRoleId } = getDirectusConfig();

  const payload: Record<string, unknown> = {
    email: params.email,
    password: params.password,
    first_name: params.firstName,
    last_name: params.lastName || '',
    status: 'active',
  };

  if (defaultRoleId && !defaultRoleId.includes('YOUR_DIRECTUS_ROLE_UUID')) {
    payload.role = defaultRoleId;
  }

  return directusFetch<DirectusUser>('/users', {
    method: 'POST',
    token: adminToken,
    body: payload,
  });
}

// ---------------- Tenant-Scoped CRUD (User JWT) ----------------

export async function listUserBots(accessToken: string): Promise<BotRecord[]> {
  return directusFetch<BotRecord[]>(
    '/items/bots?sort=-date_created&fields=id,name,bale_username,bot_token,webhook_secret,webhook_status,is_active,date_created,date_updated',
    { token: accessToken }
  );
}

export async function getUserBot(accessToken: string, botId: string): Promise<BotRecord> {
  return directusFetch<BotRecord>(
    `/items/bots/${encodeURIComponent(botId)}?fields=id,name,bale_username,bot_token,webhook_secret,webhook_status,is_active,date_created,date_updated`,
    { token: accessToken }
  );
}

export async function createUserBot(
  accessToken: string,
  data: {
    name: string;
    bale_username?: string | null;
    bot_token: string;
    webhook_secret: string;
    webhook_status?: 'active' | 'inactive' | 'error';
    is_active?: boolean;
  }
): Promise<BotRecord> {
  return directusFetch<BotRecord>('/items/bots', {
    method: 'POST',
    token: accessToken,
    body: data,
  });
}

export async function updateUserBot(
  accessToken: string,
  botId: string,
  patch: Partial<BotRecord>
): Promise<BotRecord> {
  return directusFetch<BotRecord>(`/items/bots/${encodeURIComponent(botId)}`, {
    method: 'PATCH',
    token: accessToken,
    body: patch,
  });
}

export async function deleteUserBot(accessToken: string, botId: string): Promise<void> {
  return directusFetch<void>(`/items/bots/${encodeURIComponent(botId)}`, {
    method: 'DELETE',
    token: accessToken,
  });
}

export async function listBotFlows(accessToken: string, botId: string): Promise<BotFlowRecord[]> {
  return directusFetch<BotFlowRecord[]>(
    `/items/bot_flows?filter[bot_id][_eq]=${encodeURIComponent(botId)}&sort=-version,-date_updated`,
    { token: accessToken }
  );
}

export async function createBotFlow(
  accessToken: string,
  data: {
    bot_id: string;
    name: string;
    version: number;
    is_published: boolean;
    flow_json: FlowDefinition;
  }
): Promise<BotFlowRecord> {
  return directusFetch<BotFlowRecord>('/items/bot_flows', {
    method: 'POST',
    token: accessToken,
    body: data,
  });
}

export async function updateBotFlow(
  accessToken: string,
  flowId: string,
  patch: Partial<BotFlowRecord>
): Promise<BotFlowRecord> {
  return directusFetch<BotFlowRecord>(`/items/bot_flows/${encodeURIComponent(flowId)}`, {
    method: 'PATCH',
    token: accessToken,
    body: patch,
  });
}

export async function listCollectedForms(
  accessToken: string,
  botId: string
): Promise<CollectedFormRecord[]> {
  return directusFetch<CollectedFormRecord[]>(
    `/items/collected_form_data?filter[bot_id][_eq]=${encodeURIComponent(botId)}&sort=-date_created&limit=200`,
    { token: accessToken }
  );
}

export async function deleteCollectedForm(accessToken: string, recordId: string): Promise<void> {
  return directusFetch<void>(`/items/collected_form_data/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
    token: accessToken,
  });
}

export async function listWebhookLogs(
  accessToken: string,
  botId: string
): Promise<WebhookLogRecord[]> {
  return directusFetch<WebhookLogRecord[]>(
    `/items/webhook_logs?filter[bot_id][_eq]=${encodeURIComponent(botId)}&sort=-date_created&limit=100`,
    { token: accessToken }
  );
}

export async function listBotSessions(
  accessToken: string,
  botId: string
): Promise<BotSessionRecord[]> {
  return directusFetch<BotSessionRecord[]>(
    `/items/bot_sessions?filter[bot_id][_eq]=${encodeURIComponent(botId)}&sort=-last_interaction_at&limit=100`,
    { token: accessToken }
  );
}

// ---------------- Worker / Admin Operations (Inbound Webhooks) ----------------

export async function findBotByWebhookSecret(webhookSecret: string): Promise<BotRecord | null> {
  const adminToken = requireAdminToken();
  const bots = await directusFetch<BotRecord[]>(
    `/items/bots?filter[webhook_secret][_eq]=${encodeURIComponent(webhookSecret)}&limit=1`,
    { token: adminToken }
  );
  return bots[0] ?? null;
}

export async function findPublishedFlowForBot(botId: string): Promise<BotFlowRecord | null> {
  const adminToken = requireAdminToken();
  const flows = await directusFetch<BotFlowRecord[]>(
    `/items/bot_flows?filter[bot_id][_eq]=${encodeURIComponent(botId)}&filter[is_published][_eq]=true&sort=-version,-date_updated&limit=1`,
    { token: adminToken }
  );
  return flows[0] ?? null;
}

export async function findSessionInDirectus(
  botId: string,
  baleChatId: string
): Promise<BotSessionRecord | null> {
  const adminToken = requireAdminToken();
  const rows = await directusFetch<BotSessionRecord[]>(
    `/items/bot_sessions?filter[bot_id][_eq]=${encodeURIComponent(botId)}&filter[bale_chat_id][_eq]=${encodeURIComponent(baleChatId)}&limit=1`,
    { token: adminToken }
  );
  return rows[0] ?? null;
}

export async function saveSessionInDirectus(session: BotSessionRecord): Promise<BotSessionRecord> {
  const adminToken = requireAdminToken();
  if (session.id) {
    return directusFetch<BotSessionRecord>(`/items/bot_sessions/${encodeURIComponent(session.id)}`, {
      method: 'PATCH',
      token: adminToken,
      body: {
        bale_user_name: session.bale_user_name,
        current_node_id: session.current_node_id ?? null,
        awaiting_field_key: session.awaiting_field_key ?? null,
        context_data: session.context_data,
        last_interaction_at: session.last_interaction_at,
      },
    });
  }
  return directusFetch<BotSessionRecord>('/items/bot_sessions', {
    method: 'POST',
    token: adminToken,
    body: session,
  });
}

export async function createCollectedFormAsAdmin(data: {
  bot_id: string;
  flow_id?: string | null;
  bale_chat_id: string;
  bale_user_id: string;
  bale_user_name?: string | null;
  form_title?: string | null;
  payload: Record<string, string>;
}): Promise<CollectedFormRecord> {
  const adminToken = requireAdminToken();
  return directusFetch<CollectedFormRecord>('/items/collected_form_data', {
    method: 'POST',
    token: adminToken,
    body: data,
  });
}

export async function createWebhookLogAsAdmin(data: {
  bot_id: string;
  update_id?: string | null;
  event_type: 'message' | 'callback_query' | 'error' | 'system';
  bale_chat_id?: string | null;
  incoming_text?: string | null;
  matched_node_id?: string | null;
  status: 'queued' | 'processed' | 'failed';
  latency_ms?: number | null;
  error_message?: string | null;
}): Promise<WebhookLogRecord> {
  const adminToken = requireAdminToken();
  return directusFetch<WebhookLogRecord>('/items/webhook_logs', {
    method: 'POST',
    token: adminToken,
    body: data,
  });
}
