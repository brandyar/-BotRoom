import type {
  AppointmentRecord,
  BaleSendMessagePayload,
  BookingScheduleRecord,
  BookingServiceRecord,
  BotContactRecord,
  BotFlowRecord,
  BotOrderRecord,
  BotRecord,
  BotSessionRecord,
  BroadcastCampaignRecord,
  CollectedFormRecord,
  DirectusUser,
  FlowDefinition,
  ProductRecord,
  ScheduledFollowUpItem,
  SurveyRecord,
  SurveyResponseRecord,
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
  createdOrder?: BotOrderRecord | null;
  createdSurveyResponse?: SurveyResponseRecord | null;
  createdAppointment?: AppointmentRecord | null;
  contactTags?: string[];
  scheduledFollowUps?: ScheduledFollowUpItem[];
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
    payload: {
      flowId?: string;
      name?: string;
      flow_json: FlowDefinition;
      is_published?: boolean;
      saveAsNewVersion?: boolean;
    }
  ) =>
    request<{ flow: BotFlowRecord; flows: BotFlowRecord[] }>(
      `/api/bots/${encodeURIComponent(botId)}/flow`,
      {
        method: 'PUT',
        token,
        body: payload,
      }
    ),

  publishBotFlowVersion: (token: string, botId: string, flowId: string) =>
    request<{ flow: BotFlowRecord; flows: BotFlowRecord[] }>(
      `/api/bots/${encodeURIComponent(botId)}/flow/${encodeURIComponent(flowId)}/publish`,
      {
        method: 'POST',
        token,
      }
    ),

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

  listContacts: (token: string, botId: string) =>
    request<{ contacts: BotContactRecord[] }>(`/api/bots/${encodeURIComponent(botId)}/contacts`, {
      token,
    }),

  updateContact: (
    token: string,
    botId: string,
    contactId: string,
    patch: Partial<
      Pick<
        BotContactRecord,
        'first_name' | 'last_name' | 'phone' | 'tags' | 'custom_fields' | 'is_blocked'
      >
    >
  ) =>
    request<{ contact: BotContactRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/contacts/${encodeURIComponent(contactId)}`,
      {
        method: 'PATCH',
        token,
        body: patch,
      }
    ),

  deleteContact: (token: string, botId: string, contactId: string) =>
    request<{ ok: boolean }>(
      `/api/bots/${encodeURIComponent(botId)}/contacts/${encodeURIComponent(contactId)}`,
      { method: 'DELETE', token }
    ),

  // Products & Orders (Phase 3)
  listProducts: (token: string, botId: string) =>
    request<{ products: ProductRecord[] }>(`/api/bots/${encodeURIComponent(botId)}/products`, {
      token,
    }),

  createProduct: (
    token: string,
    botId: string,
    payload: {
      title: string;
      description?: string | null;
      category?: string | null;
      price: number;
      stock?: number;
      image_url?: string | null;
      is_active?: boolean;
    }
  ) =>
    request<{ product: ProductRecord }>(`/api/bots/${encodeURIComponent(botId)}/products`, {
      method: 'POST',
      token,
      body: payload,
    }),

  updateProduct: (
    token: string,
    botId: string,
    productId: string,
    patch: Partial<
      Pick<
        ProductRecord,
        'title' | 'description' | 'category' | 'price' | 'stock' | 'image_url' | 'is_active'
      >
    >
  ) =>
    request<{ product: ProductRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/products/${encodeURIComponent(productId)}`,
      { method: 'PATCH', token, body: patch }
    ),

  deleteProduct: (token: string, botId: string, productId: string) =>
    request<{ ok: boolean }>(
      `/api/bots/${encodeURIComponent(botId)}/products/${encodeURIComponent(productId)}`,
      { method: 'DELETE', token }
    ),

  listOrders: (token: string, botId: string) =>
    request<{ orders: BotOrderRecord[] }>(`/api/bots/${encodeURIComponent(botId)}/orders`, {
      token,
    }),

  updateOrder: (
    token: string,
    botId: string,
    orderId: string,
    patch: Partial<Pick<BotOrderRecord, 'status' | 'note'>>
  ) =>
    request<{ order: BotOrderRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/orders/${encodeURIComponent(orderId)}`,
      { method: 'PATCH', token, body: patch }
    ),

  deleteOrder: (token: string, botId: string, orderId: string) =>
    request<{ ok: boolean }>(
      `/api/bots/${encodeURIComponent(botId)}/orders/${encodeURIComponent(orderId)}`,
      { method: 'DELETE', token }
    ),

  // Surveys & Responses (Phase 3)
  listSurveys: (token: string, botId: string) =>
    request<{ surveys: SurveyRecord[] }>(`/api/bots/${encodeURIComponent(botId)}/surveys`, {
      token,
    }),

  createSurvey: (
    token: string,
    botId: string,
    payload: {
      title: string;
      type: 'rating' | 'multi_choice';
      questions_json: SurveyRecord['questions_json'];
      allow_multiple?: boolean;
    }
  ) =>
    request<{ survey: SurveyRecord }>(`/api/bots/${encodeURIComponent(botId)}/surveys`, {
      method: 'POST',
      token,
      body: payload,
    }),

  updateSurvey: (
    token: string,
    botId: string,
    surveyId: string,
    patch: Partial<Pick<SurveyRecord, 'title' | 'type' | 'questions_json' | 'allow_multiple'>>
  ) =>
    request<{ survey: SurveyRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/surveys/${encodeURIComponent(surveyId)}`,
      { method: 'PATCH', token, body: patch }
    ),

  deleteSurvey: (token: string, botId: string, surveyId: string) =>
    request<{ ok: boolean }>(
      `/api/bots/${encodeURIComponent(botId)}/surveys/${encodeURIComponent(surveyId)}`,
      { method: 'DELETE', token }
    ),

  listSurveyResponses: (token: string, botId: string) =>
    request<{ responses: SurveyResponseRecord[] }>(
      `/api/bots/${encodeURIComponent(botId)}/survey-responses`,
      { token }
    ),

  deleteSurveyResponse: (token: string, botId: string, responseId: string) =>
    request<{ ok: boolean }>(
      `/api/bots/${encodeURIComponent(botId)}/survey-responses/${encodeURIComponent(responseId)}`,
      { method: 'DELETE', token }
    ),

  // Booking Services, Schedules & Appointments (Phase 4)
  listBookingServices: (token: string, botId: string) =>
    request<{ services: BookingServiceRecord[] }>(
      `/api/bots/${encodeURIComponent(botId)}/booking-services`,
      { token }
    ),

  createBookingService: (
    token: string,
    botId: string,
    payload: {
      title: string;
      description?: string | null;
      duration_minutes: number;
      capacity_per_slot: number;
      price: number;
      is_active?: boolean;
    }
  ) =>
    request<{ service: BookingServiceRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/booking-services`,
      { method: 'POST', token, body: payload }
    ),

  updateBookingService: (
    token: string,
    botId: string,
    serviceId: string,
    patch: Partial<
      Pick<
        BookingServiceRecord,
        'title' | 'description' | 'duration_minutes' | 'capacity_per_slot' | 'price' | 'is_active'
      >
    >
  ) =>
    request<{ service: BookingServiceRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/booking-services/${encodeURIComponent(serviceId)}`,
      { method: 'PATCH', token, body: patch }
    ),

  deleteBookingService: (token: string, botId: string, serviceId: string) =>
    request<{ ok: boolean }>(
      `/api/bots/${encodeURIComponent(botId)}/booking-services/${encodeURIComponent(serviceId)}`,
      { method: 'DELETE', token }
    ),

  listBookingSchedules: (token: string, botId: string) =>
    request<{ schedules: BookingScheduleRecord[] }>(
      `/api/bots/${encodeURIComponent(botId)}/booking-schedules`,
      { token }
    ),

  createBookingSchedule: (
    token: string,
    botId: string,
    payload: {
      service_id: string;
      weekday: number;
      start_time: string;
      end_time: string;
      blocked_dates?: string[];
      is_active?: boolean;
    }
  ) =>
    request<{ schedule: BookingScheduleRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/booking-schedules`,
      { method: 'POST', token, body: payload }
    ),

  updateBookingSchedule: (
    token: string,
    botId: string,
    scheduleId: string,
    patch: Partial<
      Pick<BookingScheduleRecord, 'weekday' | 'start_time' | 'end_time' | 'blocked_dates' | 'is_active'>
    >
  ) =>
    request<{ schedule: BookingScheduleRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/booking-schedules/${encodeURIComponent(scheduleId)}`,
      { method: 'PATCH', token, body: patch }
    ),

  deleteBookingSchedule: (token: string, botId: string, scheduleId: string) =>
    request<{ ok: boolean }>(
      `/api/bots/${encodeURIComponent(botId)}/booking-schedules/${encodeURIComponent(scheduleId)}`,
      { method: 'DELETE', token }
    ),

  listAppointments: (token: string, botId: string) =>
    request<{ appointments: AppointmentRecord[] }>(
      `/api/bots/${encodeURIComponent(botId)}/appointments`,
      { token }
    ),

  updateAppointment: (
    token: string,
    botId: string,
    appointmentId: string,
    patch: Partial<Pick<AppointmentRecord, 'status' | 'note' | 'reminder_sent'>>
  ) =>
    request<{ appointment: AppointmentRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/appointments/${encodeURIComponent(appointmentId)}`,
      { method: 'PATCH', token, body: patch }
    ),

  deleteAppointment: (token: string, botId: string, appointmentId: string) =>
    request<{ ok: boolean }>(
      `/api/bots/${encodeURIComponent(botId)}/appointments/${encodeURIComponent(appointmentId)}`,
      { method: 'DELETE', token }
    ),

  sendAppointmentReminders: (token: string, botId: string) =>
    request<{ checked: number; sent: number; failed: number }>(
      `/api/bots/${encodeURIComponent(botId)}/appointments/send-reminders`,
      { method: 'POST', token }
    ),

  // Broadcast Campaigns (Phase 4)
  listCampaigns: (token: string, botId: string) =>
    request<{ campaigns: BroadcastCampaignRecord[] }>(
      `/api/bots/${encodeURIComponent(botId)}/campaigns`,
      { token }
    ),

  createCampaign: (
    token: string,
    botId: string,
    payload: {
      title: string;
      message_text: string;
      media_url?: string | null;
      target_tags?: string[];
      scheduled_at?: string | null;
    }
  ) =>
    request<{ campaign: BroadcastCampaignRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/campaigns`,
      { method: 'POST', token, body: payload }
    ),

  updateCampaign: (
    token: string,
    botId: string,
    campaignId: string,
    patch: Partial<
      Pick<
        BroadcastCampaignRecord,
        'title' | 'message_text' | 'media_url' | 'target_tags' | 'status' | 'scheduled_at'
      >
    >
  ) =>
    request<{ campaign: BroadcastCampaignRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/campaigns/${encodeURIComponent(campaignId)}`,
      { method: 'PATCH', token, body: patch }
    ),

  deleteCampaign: (token: string, botId: string, campaignId: string) =>
    request<{ ok: boolean }>(
      `/api/bots/${encodeURIComponent(botId)}/campaigns/${encodeURIComponent(campaignId)}`,
      { method: 'DELETE', token }
    ),

  sendCampaign: (token: string, botId: string, campaignId: string) =>
    request<{ ok: boolean; campaign: BroadcastCampaignRecord }>(
      `/api/bots/${encodeURIComponent(botId)}/campaigns/${encodeURIComponent(campaignId)}/send`,
      { method: 'POST', token }
    ),

  simulateDispatch: (payload: {
    botId?: string;
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
