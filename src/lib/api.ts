import type {
  BaleSendMessagePayload,
  BotFlowRecord,
  BotRecord,
  BotSessionRecord,
  CollectedFormRecord,
  DirectusUser,
  FlowDefinition,
  WebhookLogRecord,
} from '../types/bot.ts';

export interface HealthResponse {
  ok: boolean;
  directusConfigured: boolean;
  hasAdminToken: boolean;
  redisConfigured: boolean;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires: number;
  user: DirectusUser;
}

export interface SimulatorResponse {
  matchedNodeId: string | null;
  outgoingPayloads: BaleSendMessagePayload[];
  callbackAnswerText?: string;
  savedFormPayload?: Record<string, string> | null;
  session: BotSessionRecord;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    token?: string | null;
    body?: unknown;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      data.error || `خطای ارتباط با سرور (${res.status})`,
      res.status,
      data.code
    );
  }
  return data as T;
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  getDefaultFlow: () => request<{ flow: FlowDefinition }>('/api/default-flow'),

  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  register: (payload: { email: string; password: string; firstName: string; lastName?: string }) =>
    request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: payload,
    }),

  refresh: (refresh_token: string) =>
    request<{ access_token: string; refresh_token: string; expires: number }>('/api/auth/refresh', {
      method: 'POST',
      body: { refresh_token },
    }),

  logout: (refresh_token?: string | null) =>
    request<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
      body: { refresh_token },
    }),

  me: (token: string) => request<{ user: DirectusUser }>('/api/auth/me', { token }),

  listBots: (token: string) => request<{ bots: BotRecord[] }>('/api/bots', { token }),

  createBot: (token: string, payload: { name: string; bot_token: string; verifyToken?: boolean }) =>
    request<{ bot: BotRecord; flow: BotFlowRecord }>('/api/bots', {
      method: 'POST',
      token,
      body: payload,
    }),

  updateBot: (token: string, botId: string, patch: Partial<BotRecord>) =>
    request<{ bot: BotRecord }>(`/api/bots/${encodeURIComponent(botId)}`, {
      method: 'PATCH',
      token,
      body: patch,
    }),

  deleteBot: (token: string, botId: string) =>
    request<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}`, {
      method: 'DELETE',
      token,
    }),

  registerWebhook: (token: string, botId: string) =>
    request<{ ok: boolean; bot: BotRecord; webhookUrl: string }>(
      `/api/bots/${encodeURIComponent(botId)}/webhook/register`,
      { method: 'POST', token }
    ),

  removeWebhook: (token: string, botId: string) =>
    request<{ ok: boolean; bot: BotRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/webhook/remove`,
      { method: 'POST', token }
    ),

  getBotFlow: (token: string, botId: string) =>
    request<{ flow: BotFlowRecord | null; flows: BotFlowRecord[] }>(
      `/api/bots/${encodeURIComponent(botId)}/flow`,
      { token }
    ),

  saveBotFlow: (
    token: string,
    botId: string,
    payload: { flowId?: string; name?: string; flow_json: FlowDefinition; is_published?: boolean }
  ) =>
    request<{ flow: BotFlowRecord }>(`/api/bots/${encodeURIComponent(botId)}/flow`, {
      method: 'PUT',
      token,
      body: payload,
    }),

  listForms: (token: string, botId: string) =>
    request<{ forms: CollectedFormRecord[] }>(`/api/bots/${encodeURIComponent(botId)}/forms`, {
      token,
    }),

  deleteForm: (token: string, botId: string, recordId: string) =>
    request<{ ok: boolean }>(
      `/api/bots/${encodeURIComponent(botId)}/forms/${encodeURIComponent(recordId)}`,
      { method: 'DELETE', token }
    ),

  listLogs: (token: string, botId: string) =>
    request<{ logs: WebhookLogRecord[] }>(`/api/bots/${encodeURIComponent(botId)}/logs`, {
      token,
    }),

  listSessions: (token: string, botId: string) =>
    request<{ sessions: BotSessionRecord[] }>(`/api/bots/${encodeURIComponent(botId)}/sessions`, {
      token,
    }),

  simulateDispatch: (payload: {
    botId?: string;
    userName?: string;
    flow: FlowDefinition;
    text?: string;
    callbackData?: string;
  }) =>
    request<SimulatorResponse>('/api/simulator/dispatch', {
      method: 'POST',
      body: payload,
    }),

  simulateReset: (botId = 'simulator-bot') =>
    request<{ ok: boolean }>('/api/simulator/reset', {
      method: 'POST',
      body: { botId },
    }),
};
