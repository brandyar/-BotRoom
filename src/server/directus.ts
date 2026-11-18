import type {
  AppointmentRecord,
  AppointmentStatus,
  BookingScheduleRecord,
  BookingServiceRecord,
  BotContactRecord,
  BotFlowRecord,
  BotOrderRecord,
  BotRecord,
  BotSessionRecord,
  BroadcastCampaignRecord,
  BroadcastCampaignStatus,
  CollectedFormRecord,
  DirectusUser,
  FlowDefinition,
  OrderCartItem,
  OrderStatus,
  ProductRecord,
  SurveyQuestionItem,
  SurveyRecord,
  SurveyResponseRecord,
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
    const rawDetail = firstError?.message ? String(firstError.message) : '';
    let message = rawDetail || `Directus request failed (${res.status})`;
    if (res.status === 403 || code === 'FORBIDDEN') {
      console.warn(
        `[Directus 403] ${options.method || 'GET'} ${path}:`,
        rawDetail || code || res.statusText
      );
      const detailSuffix = rawDetail ? ` (جزئیات دایرکتوس: ${rawDetail})` : '';
      message = `دسترسی توسط دایرکتوس رد شد (403) در مسیر ${path}.${detailSuffix} لطفاً دسترسی‌های نقش/سیاست کاربر (Access Policy) را در دایرکتوس بررسی کنید.`;
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

export async function listBotContacts(
  accessToken: string,
  botId: string
): Promise<BotContactRecord[]> {
  const rows = await directusFetch<BotContactRecord[]>(
    `/items/bot_contacts?filter[bot_id][_eq]=${encodeURIComponent(botId)}&sort=-last_interaction_at,-date_created&limit=250`,
    { token: accessToken }
  );
  return rows.map((row) => ({
    ...row,
    tags: Array.isArray(row.tags) ? row.tags : [],
    custom_fields:
      row.custom_fields && typeof row.custom_fields === 'object' ? row.custom_fields : {},
    is_blocked: Boolean(row.is_blocked),
  }));
}

export async function updateBotContact(
  accessToken: string,
  contactId: string,
  patch: Partial<
    Pick<
      BotContactRecord,
      'first_name' | 'last_name' | 'phone' | 'tags' | 'custom_fields' | 'is_blocked'
    >
  >
): Promise<BotContactRecord> {
  return directusFetch<BotContactRecord>(`/items/bot_contacts/${encodeURIComponent(contactId)}`, {
    method: 'PATCH',
    token: accessToken,
    body: patch,
  });
}

export async function deleteBotContact(accessToken: string, contactId: string): Promise<void> {
  return directusFetch<void>(`/items/bot_contacts/${encodeURIComponent(contactId)}`, {
    method: 'DELETE',
    token: accessToken,
  });
}

// ---------------- Products & Orders CRUD (Phase 3 - User JWT) ----------------

function normalizeProduct(row: ProductRecord): ProductRecord {
  return {
    ...row,
    price: Number(row.price || 0),
    stock: Number(row.stock ?? 0),
    is_active: row.is_active !== false,
  };
}

export async function listUserProducts(
  accessToken: string,
  botId: string
): Promise<ProductRecord[]> {
  const rows = await directusFetch<ProductRecord[]>(
    `/items/products?filter[bot_id][_eq]=${encodeURIComponent(botId)}&sort=-date_created&limit=250`,
    { token: accessToken }
  );
  return rows.map(normalizeProduct);
}

export async function createUserProduct(
  accessToken: string,
  data: {
    bot_id: string;
    title: string;
    description?: string | null;
    category?: string | null;
    price: number;
    stock?: number;
    image_url?: string | null;
    is_active?: boolean;
  }
): Promise<ProductRecord> {
  const created = await directusFetch<ProductRecord>('/items/products', {
    method: 'POST',
    token: accessToken,
    body: {
      ...data,
      price: Math.max(0, Math.round(Number(data.price) || 0)),
      stock: Math.max(0, Math.round(Number(data.stock) || 0)),
      is_active: data.is_active !== false,
    },
  });
  return normalizeProduct(created);
}

export async function updateUserProduct(
  accessToken: string,
  productId: string,
  patch: Partial<
    Pick<
      ProductRecord,
      'title' | 'description' | 'category' | 'price' | 'stock' | 'image_url' | 'is_active'
    >
  >
): Promise<ProductRecord> {
  const cleanPatch: Record<string, unknown> = { ...patch };
  if (patch.price !== undefined) cleanPatch.price = Math.max(0, Math.round(Number(patch.price) || 0));
  if (patch.stock !== undefined) cleanPatch.stock = Math.max(0, Math.round(Number(patch.stock) || 0));
  const updated = await directusFetch<ProductRecord>(
    `/items/products/${encodeURIComponent(productId)}`,
    {
      method: 'PATCH',
      token: accessToken,
      body: cleanPatch,
    }
  );
  return normalizeProduct(updated);
}

export async function deleteUserProduct(accessToken: string, productId: string): Promise<void> {
  return directusFetch<void>(`/items/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
    token: accessToken,
  });
}

function normalizeOrder(row: BotOrderRecord): BotOrderRecord {
  return {
    ...row,
    items: Array.isArray(row.items) ? row.items : [],
    total_amount: Number(row.total_amount || 0),
    status: (row.status || 'pending') as OrderStatus,
  };
}

export async function listBotOrders(accessToken: string, botId: string): Promise<BotOrderRecord[]> {
  const rows = await directusFetch<BotOrderRecord[]>(
    `/items/bot_orders?filter[bot_id][_eq]=${encodeURIComponent(botId)}&sort=-date_created&limit=250`,
    { token: accessToken }
  );
  return rows.map(normalizeOrder);
}

export async function updateBotOrder(
  accessToken: string,
  orderId: string,
  patch: Partial<Pick<BotOrderRecord, 'status' | 'note'>>
): Promise<BotOrderRecord> {
  const updated = await directusFetch<BotOrderRecord>(
    `/items/bot_orders/${encodeURIComponent(orderId)}`,
    {
      method: 'PATCH',
      token: accessToken,
      body: patch,
    }
  );
  return normalizeOrder(updated);
}

export async function deleteBotOrder(accessToken: string, orderId: string): Promise<void> {
  return directusFetch<void>(`/items/bot_orders/${encodeURIComponent(orderId)}`, {
    method: 'DELETE',
    token: accessToken,
  });
}

// ---------------- Surveys & Responses CRUD (Phase 3 - User JWT) ----------------

function normalizeSurvey(row: SurveyRecord): SurveyRecord {
  return {
    ...row,
    type: row.type === 'multi_choice' ? 'multi_choice' : 'rating',
    questions_json: Array.isArray(row.questions_json) ? row.questions_json : [],
    allow_multiple: row.allow_multiple !== false,
  };
}

export async function listBotSurveys(accessToken: string, botId: string): Promise<SurveyRecord[]> {
  const rows = await directusFetch<SurveyRecord[]>(
    `/items/surveys?filter[bot_id][_eq]=${encodeURIComponent(botId)}&sort=-date_created&limit=100`,
    { token: accessToken }
  );
  return rows.map(normalizeSurvey);
}

export async function createUserSurvey(
  accessToken: string,
  data: {
    bot_id: string;
    title: string;
    type: 'rating' | 'multi_choice';
    questions_json: SurveyQuestionItem[];
    allow_multiple?: boolean;
  }
): Promise<SurveyRecord> {
  const created = await directusFetch<SurveyRecord>('/items/surveys', {
    method: 'POST',
    token: accessToken,
    body: {
      ...data,
      allow_multiple: data.allow_multiple !== false,
    },
  });
  return normalizeSurvey(created);
}

export async function updateUserSurvey(
  accessToken: string,
  surveyId: string,
  patch: Partial<Pick<SurveyRecord, 'title' | 'type' | 'questions_json' | 'allow_multiple'>>
): Promise<SurveyRecord> {
  const updated = await directusFetch<SurveyRecord>(
    `/items/surveys/${encodeURIComponent(surveyId)}`,
    {
      method: 'PATCH',
      token: accessToken,
      body: patch,
    }
  );
  return normalizeSurvey(updated);
}

export async function deleteUserSurvey(accessToken: string, surveyId: string): Promise<void> {
  return directusFetch<void>(`/items/surveys/${encodeURIComponent(surveyId)}`, {
    method: 'DELETE',
    token: accessToken,
  });
}

export async function listSurveyResponses(
  accessToken: string,
  botId: string
): Promise<SurveyResponseRecord[]> {
  const rows = await directusFetch<SurveyResponseRecord[]>(
    `/items/survey_responses?filter[bot_id][_eq]=${encodeURIComponent(botId)}&sort=-date_created&limit=500`,
    { token: accessToken }
  );
  return rows.map((r) => ({
    ...r,
    answers_json:
      r.answers_json && typeof r.answers_json === 'object' ? r.answers_json : {},
    score: r.score !== null && r.score !== undefined ? Number(r.score) : null,
  }));
}

export async function deleteSurveyResponse(accessToken: string, responseId: string): Promise<void> {
  return directusFetch<void>(`/items/survey_responses/${encodeURIComponent(responseId)}`, {
    method: 'DELETE',
    token: accessToken,
  });
}

// ---------------- Booking Services, Schedules & Appointments (Phase 4 - User JWT) ----------------

function normalizeBookingService(row: BookingServiceRecord): BookingServiceRecord {
  return {
    ...row,
    duration_minutes: Math.max(5, Number(row.duration_minutes || 30)),
    capacity_per_slot: Math.max(1, Number(row.capacity_per_slot || 1)),
    price: Number(row.price || 0),
    is_active: row.is_active !== false,
  };
}

function normalizeBookingSchedule(row: BookingScheduleRecord): BookingScheduleRecord {
  return {
    ...row,
    weekday: Number(row.weekday || 0),
    start_time: row.start_time || '09:00',
    end_time: row.end_time || '17:00',
    blocked_dates: Array.isArray(row.blocked_dates) ? row.blocked_dates.map(String) : [],
    is_active: row.is_active !== false,
  };
}

function normalizeAppointment(row: AppointmentRecord): AppointmentRecord {
  return {
    ...row,
    status: (row.status || 'confirmed') as AppointmentStatus,
    reminder_sent: Boolean(row.reminder_sent),
  };
}

function normalizeCampaign(row: BroadcastCampaignRecord): BroadcastCampaignRecord {
  return {
    ...row,
    target_tags: Array.isArray(row.target_tags) ? row.target_tags.map(String) : [],
    status: (row.status || 'draft') as BroadcastCampaignStatus,
    total_count: Number(row.total_count || 0),
    sent_count: Number(row.sent_count || 0),
    failed_count: Number(row.failed_count || 0),
  };
}

function sortByDateCreatedDesc<T extends { date_created?: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = a.date_created ? Date.parse(a.date_created) : 0;
    const tb = b.date_created ? Date.parse(b.date_created) : 0;
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
}

export async function listBookingServices(
  accessToken: string,
  botId: string
): Promise<BookingServiceRecord[]> {
  const rows = await directusFetch<BookingServiceRecord[]>(
    `/items/booking_services?filter[bot_id][_eq]=${encodeURIComponent(botId)}&limit=100`,
    { token: accessToken }
  );
  return sortByDateCreatedDesc(rows.map(normalizeBookingService));
}

export async function createBookingService(
  accessToken: string,
  data: {
    bot_id: string;
    title: string;
    description?: string | null;
    duration_minutes: number;
    capacity_per_slot: number;
    price: number;
    is_active?: boolean;
  }
): Promise<BookingServiceRecord> {
  const created = await directusFetch<BookingServiceRecord>('/items/booking_services', {
    method: 'POST',
    token: accessToken,
    body: {
      ...data,
      duration_minutes: Math.max(5, Math.round(Number(data.duration_minutes) || 30)),
      capacity_per_slot: Math.max(1, Math.round(Number(data.capacity_per_slot) || 1)),
      price: Math.max(0, Math.round(Number(data.price) || 0)),
      is_active: data.is_active !== false,
    },
  });
  return normalizeBookingService(created);
}

export async function updateBookingService(
  accessToken: string,
  serviceId: string,
  patch: Partial<
    Pick<
      BookingServiceRecord,
      'title' | 'description' | 'duration_minutes' | 'capacity_per_slot' | 'price' | 'is_active'
    >
  >
): Promise<BookingServiceRecord> {
  const updated = await directusFetch<BookingServiceRecord>(
    `/items/booking_services/${encodeURIComponent(serviceId)}`,
    {
      method: 'PATCH',
      token: accessToken,
      body: patch,
    }
  );
  return normalizeBookingService(updated);
}

export async function deleteBookingService(accessToken: string, serviceId: string): Promise<void> {
  return directusFetch<void>(`/items/booking_services/${encodeURIComponent(serviceId)}`, {
    method: 'DELETE',
    token: accessToken,
  });
}

export async function listBookingSchedules(
  accessToken: string,
  botId: string
): Promise<BookingScheduleRecord[]> {
  const rows = await directusFetch<BookingScheduleRecord[]>(
    `/items/booking_schedules?filter[bot_id][_eq]=${encodeURIComponent(botId)}&sort=weekday,start_time&limit=250`,
    { token: accessToken }
  );
  return rows.map(normalizeBookingSchedule);
}

export async function createBookingSchedule(
  accessToken: string,
  data: {
    bot_id: string;
    service_id: string;
    weekday: number;
    start_time: string;
    end_time: string;
    blocked_dates?: string[];
    is_active?: boolean;
  }
): Promise<BookingScheduleRecord> {
  const created = await directusFetch<BookingScheduleRecord>('/items/booking_schedules', {
    method: 'POST',
    token: accessToken,
    body: {
      ...data,
      weekday: Math.min(6, Math.max(0, Math.round(Number(data.weekday) || 0))),
      blocked_dates: data.blocked_dates || [],
      is_active: data.is_active !== false,
    },
  });
  return normalizeBookingSchedule(created);
}

export async function updateBookingSchedule(
  accessToken: string,
  scheduleId: string,
  patch: Partial<
    Pick<BookingScheduleRecord, 'weekday' | 'start_time' | 'end_time' | 'blocked_dates' | 'is_active'>
  >
): Promise<BookingScheduleRecord> {
  const updated = await directusFetch<BookingScheduleRecord>(
    `/items/booking_schedules/${encodeURIComponent(scheduleId)}`,
    {
      method: 'PATCH',
      token: accessToken,
      body: patch,
    }
  );
  return normalizeBookingSchedule(updated);
}

export async function deleteBookingSchedule(
  accessToken: string,
  scheduleId: string
): Promise<void> {
  return directusFetch<void>(`/items/booking_schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'DELETE',
    token: accessToken,
  });
}

export async function listAppointments(
  accessToken: string,
  botId: string
): Promise<AppointmentRecord[]> {
  const rows = await directusFetch<AppointmentRecord[]>(
    `/items/appointments?filter[bot_id][_eq]=${encodeURIComponent(botId)}&sort=-appointment_at&limit=300`,
    { token: accessToken }
  );
  return rows.map(normalizeAppointment);
}

export async function updateAppointment(
  accessToken: string,
  appointmentId: string,
  patch: Partial<Pick<AppointmentRecord, 'status' | 'note' | 'reminder_sent'>>
): Promise<AppointmentRecord> {
  const updated = await directusFetch<AppointmentRecord>(
    `/items/appointments/${encodeURIComponent(appointmentId)}`,
    {
      method: 'PATCH',
      token: accessToken,
      body: patch,
    }
  );
  return normalizeAppointment(updated);
}

export async function deleteAppointment(
  accessToken: string,
  appointmentId: string
): Promise<void> {
  return directusFetch<void>(`/items/appointments/${encodeURIComponent(appointmentId)}`, {
    method: 'DELETE',
    token: accessToken,
  });
}

// ---------------- Broadcast Campaigns (Phase 4 - User JWT) ----------------

export async function listBroadcastCampaigns(
  accessToken: string,
  botId: string
): Promise<BroadcastCampaignRecord[]> {
  const rows = await directusFetch<BroadcastCampaignRecord[]>(
    `/items/broadcast_campaigns?filter[bot_id][_eq]=${encodeURIComponent(botId)}&limit=100`,
    { token: accessToken }
  );
  return sortByDateCreatedDesc(rows.map(normalizeCampaign));
}

export async function createBroadcastCampaign(
  accessToken: string,
  data: {
    bot_id: string;
    title: string;
    message_text: string;
    media_url?: string | null;
    target_tags?: string[];
    scheduled_at?: string | null;
    status?: BroadcastCampaignStatus;
  }
): Promise<BroadcastCampaignRecord> {
  const created = await directusFetch<BroadcastCampaignRecord>('/items/broadcast_campaigns', {
    method: 'POST',
    token: accessToken,
    body: {
      bot_id: data.bot_id,
      title: data.title,
      message_text: data.message_text,
      media_url: data.media_url || null,
      target_tags: data.target_tags || [],
      scheduled_at: data.scheduled_at || null,
      status: data.status || (data.scheduled_at ? 'queued' : 'draft'),
      total_count: 0,
      sent_count: 0,
      failed_count: 0,
    },
  });
  return normalizeCampaign(created);
}

export async function updateBroadcastCampaign(
  accessToken: string,
  campaignId: string,
  patch: Partial<
    Pick<
      BroadcastCampaignRecord,
      'title' | 'message_text' | 'media_url' | 'target_tags' | 'status' | 'scheduled_at'
    >
  >
): Promise<BroadcastCampaignRecord> {
  const updated = await directusFetch<BroadcastCampaignRecord>(
    `/items/broadcast_campaigns/${encodeURIComponent(campaignId)}`,
    {
      method: 'PATCH',
      token: accessToken,
      body: patch,
    }
  );
  return normalizeCampaign(updated);
}

export async function deleteBroadcastCampaign(
  accessToken: string,
  campaignId: string
): Promise<void> {
  return directusFetch<void>(`/items/broadcast_campaigns/${encodeURIComponent(campaignId)}`, {
    method: 'DELETE',
    token: accessToken,
  });
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

export async function findBotContactAsAdmin(
  botId: string,
  baleUserId: string
): Promise<BotContactRecord | null> {
  const adminToken = requireAdminToken();
  const rows = await directusFetch<BotContactRecord[]>(
    `/items/bot_contacts?filter[bot_id][_eq]=${encodeURIComponent(botId)}&filter[bale_user_id][_eq]=${encodeURIComponent(baleUserId)}&limit=1`,
    { token: adminToken }
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    tags: Array.isArray(row.tags) ? row.tags : [],
    custom_fields:
      row.custom_fields && typeof row.custom_fields === 'object' ? row.custom_fields : {},
    is_blocked: Boolean(row.is_blocked),
  };
}

export async function upsertBotContactAsAdmin(data: {
  bot_id: string;
  bale_user_id: string;
  bale_chat_id: string;
  first_name?: string | null;
  last_name?: string | null;
  bale_username?: string | null;
  phone?: string | null;
  tags?: string[];
  custom_fields?: Record<string, string>;
  is_blocked?: boolean;
}): Promise<BotContactRecord> {
  const adminToken = requireAdminToken();
  const existing = await findBotContactAsAdmin(data.bot_id, data.bale_user_id);
  const now = new Date().toISOString();

  if (existing) {
    const patch: Record<string, unknown> = {
      bale_chat_id: data.bale_chat_id,
      last_interaction_at: now,
    };
    if (data.first_name !== undefined && data.first_name !== null && data.first_name !== '') {
      patch.first_name = data.first_name;
    }
    if (data.last_name !== undefined && data.last_name !== null && data.last_name !== '') {
      patch.last_name = data.last_name;
    }
    if (data.bale_username !== undefined && data.bale_username !== null) {
      patch.bale_username = data.bale_username;
    }
    if (data.phone) {
      patch.phone = data.phone;
    }
    if (data.tags !== undefined) {
      patch.tags = data.tags;
    }
    if (data.custom_fields !== undefined) {
      patch.custom_fields = {
        ...existing.custom_fields,
        ...data.custom_fields,
      };
    }
    if (data.is_blocked !== undefined) {
      patch.is_blocked = data.is_blocked;
    }

    return directusFetch<BotContactRecord>(
      `/items/bot_contacts/${encodeURIComponent(existing.id)}`,
      {
        method: 'PATCH',
        token: adminToken,
        body: patch,
      }
    );
  }

  return directusFetch<BotContactRecord>('/items/bot_contacts', {
    method: 'POST',
    token: adminToken,
    body: {
      bot_id: data.bot_id,
      bale_user_id: data.bale_user_id,
      bale_chat_id: data.bale_chat_id,
      first_name: data.first_name || null,
      last_name: data.last_name || null,
      bale_username: data.bale_username || null,
      phone: data.phone || null,
      tags: data.tags || [],
      custom_fields: data.custom_fields || {},
      is_blocked: data.is_blocked ?? false,
      last_interaction_at: now,
    },
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

export async function listProductsAsAdmin(botId: string): Promise<ProductRecord[]> {
  const adminToken = requireAdminToken();
  const rows = await directusFetch<ProductRecord[]>(
    `/items/products?filter[bot_id][_eq]=${encodeURIComponent(botId)}&filter[is_active][_eq]=true&sort=-date_created&limit=200`,
    { token: adminToken }
  );
  return rows.map(normalizeProduct);
}

export async function createBotOrderAsAdmin(data: {
  bot_id: string;
  contact_id?: string | number | null;
  bale_user_id?: string | null;
  bale_chat_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  items: OrderCartItem[];
  total_amount: number;
  status?: OrderStatus;
  note?: string | null;
}): Promise<BotOrderRecord> {
  const adminToken = requireAdminToken();
  const created = await directusFetch<BotOrderRecord>('/items/bot_orders', {
    method: 'POST',
    token: adminToken,
    body: {
      bot_id: data.bot_id,
      ...(data.contact_id !== undefined && data.contact_id !== null
        ? { contact_id: data.contact_id }
        : {}),
      bale_chat_id: data.bale_chat_id || data.bale_user_id || null,
      bale_user_name: data.customer_name || null,
      items: data.items,
      total_amount: data.total_amount,
      status: data.status || 'pending',
      note: data.note || null,
    },
  });
  return normalizeOrder(created);
}

export async function getSurveyAsAdmin(surveyId: string): Promise<SurveyRecord | null> {
  const adminToken = requireAdminToken();
  try {
    const row = await directusFetch<SurveyRecord>(
      `/items/surveys/${encodeURIComponent(surveyId)}`,
      { token: adminToken }
    );
    return row ? normalizeSurvey(row) : null;
  } catch {
    return null;
  }
}

export async function hasContactAnsweredSurveyAsAdmin(
  botId: string,
  surveyId: string,
  baleChatOrUserId: string
): Promise<boolean> {
  const adminToken = requireAdminToken();
  try {
    const rows = await directusFetch<Array<{ id: string }>>(
      `/items/survey_responses?filter[bot_id][_eq]=${encodeURIComponent(botId)}&filter[survey_id][_eq]=${encodeURIComponent(surveyId)}&filter[bale_chat_id][_eq]=${encodeURIComponent(baleChatOrUserId)}&limit=1&fields=id`,
      { token: adminToken }
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function createSurveyResponseAsAdmin(data: {
  survey_id?: string | null;
  bot_id: string;
  contact_id?: string | number | null;
  bale_user_id?: string | null;
  bale_chat_id?: string | null;
  bale_user_name?: string | null;
  answers_json: Record<string, string>;
  score?: number | null;
}): Promise<SurveyResponseRecord> {
  const adminToken = requireAdminToken();
  return directusFetch<SurveyResponseRecord>('/items/survey_responses', {
    method: 'POST',
    token: adminToken,
    body: {
      ...(data.survey_id ? { survey_id: data.survey_id } : {}),
      bot_id: data.bot_id,
      ...(data.contact_id !== undefined && data.contact_id !== null
        ? { contact_id: data.contact_id }
        : {}),
      bale_chat_id: data.bale_chat_id || data.bale_user_id || null,
      bale_user_name: data.bale_user_name || null,
      answers_json: data.answers_json,
      score: data.score ?? null,
    },
  });
}

// ---------------- Phase 4: Admin / Worker Booking & Broadcast Helpers ----------------

export async function getBotAsAdmin(botId: string): Promise<BotRecord | null> {
  const adminToken = requireAdminToken();
  try {
    return await directusFetch<BotRecord>(`/items/bots/${encodeURIComponent(botId)}`, {
      token: adminToken,
    });
  } catch {
    return null;
  }
}

export async function listBookingServicesAsAdmin(botId: string): Promise<BookingServiceRecord[]> {
  const adminToken = requireAdminToken();
  const rows = await directusFetch<BookingServiceRecord[]>(
    `/items/booking_services?filter[bot_id][_eq]=${encodeURIComponent(botId)}&filter[is_active][_eq]=true&limit=100`,
    { token: adminToken }
  );
  return sortByDateCreatedDesc(rows.map(normalizeBookingService));
}

export async function listBookingSchedulesAsAdmin(
  botId: string,
  serviceId?: string
): Promise<BookingScheduleRecord[]> {
  const adminToken = requireAdminToken();
  const serviceFilter = serviceId
    ? `&filter[service_id][_eq]=${encodeURIComponent(serviceId)}`
    : '';
  const rows = await directusFetch<BookingScheduleRecord[]>(
    `/items/booking_schedules?filter[bot_id][_eq]=${encodeURIComponent(botId)}${serviceFilter}&filter[is_active][_eq]=true&limit=250`,
    { token: adminToken }
  );
  return rows.map(normalizeBookingSchedule);
}

export async function listAppointmentsAsAdmin(
  botId: string,
  serviceId?: string
): Promise<AppointmentRecord[]> {
  const adminToken = requireAdminToken();
  const serviceFilter = serviceId
    ? `&filter[service_id][_eq]=${encodeURIComponent(serviceId)}`
    : '';
  const rows = await directusFetch<AppointmentRecord[]>(
    `/items/appointments?filter[bot_id][_eq]=${encodeURIComponent(botId)}${serviceFilter}&filter[status][_neq]=cancelled&limit=500`,
    { token: adminToken }
  );
  return rows.map(normalizeAppointment);
}

export async function createAppointmentAsAdmin(data: {
  bot_id: string;
  service_id: string;
  contact_id?: string | number | null;
  bale_chat_id: string;
  bale_user_name?: string | null;
  customer_phone?: string | null;
  appointment_at: string;
  jalali_date: string;
  status?: AppointmentStatus;
  reminder_sent?: boolean;
  note?: string | null;
}): Promise<AppointmentRecord> {
  const adminToken = requireAdminToken();
  const created = await directusFetch<AppointmentRecord>('/items/appointments', {
    method: 'POST',
    token: adminToken,
    body: {
      bot_id: data.bot_id,
      service_id: data.service_id,
      ...(data.contact_id !== undefined && data.contact_id !== null
        ? { contact_id: data.contact_id }
        : {}),
      bale_chat_id: data.bale_chat_id,
      bale_user_name: data.bale_user_name || null,
      customer_phone: data.customer_phone || null,
      appointment_at: data.appointment_at,
      jalali_date: data.jalali_date,
      status: data.status || 'confirmed',
      reminder_sent: Boolean(data.reminder_sent),
      note: data.note || null,
    },
  });
  return normalizeAppointment(created);
}

export async function getAppointmentAsAdmin(
  appointmentId: string
): Promise<AppointmentRecord | null> {
  const adminToken = requireAdminToken();
  try {
    const row = await directusFetch<AppointmentRecord>(
      `/items/appointments/${encodeURIComponent(appointmentId)}`,
      { token: adminToken }
    );
    return row ? normalizeAppointment(row) : null;
  } catch {
    return null;
  }
}

export async function updateAppointmentAsAdmin(
  appointmentId: string,
  patch: Partial<Pick<AppointmentRecord, 'status' | 'reminder_sent' | 'note'>>
): Promise<AppointmentRecord> {
  const adminToken = requireAdminToken();
  const updated = await directusFetch<AppointmentRecord>(
    `/items/appointments/${encodeURIComponent(appointmentId)}`,
    {
      method: 'PATCH',
      token: adminToken,
      body: patch,
    }
  );
  return normalizeAppointment(updated);
}

export async function listDueReminderAppointmentsAsAdmin(
  fromIso: string,
  toIso: string,
  botId?: string
): Promise<AppointmentRecord[]> {
  const adminToken = requireAdminToken();
  const botFilter = botId ? `&filter[bot_id][_eq]=${encodeURIComponent(botId)}` : '';
  const rows = await directusFetch<AppointmentRecord[]>(
    `/items/appointments?filter[reminder_sent][_eq]=false&filter[status][_neq]=cancelled&filter[appointment_at][_gte]=${encodeURIComponent(fromIso)}&filter[appointment_at][_lte]=${encodeURIComponent(toIso)}${botFilter}&limit=200`,
    { token: adminToken }
  );
  return rows.map(normalizeAppointment);
}

export async function listBotContactsAsAdmin(botId: string): Promise<BotContactRecord[]> {
  const adminToken = requireAdminToken();
  const rows = await directusFetch<BotContactRecord[]>(
    `/items/bot_contacts?filter[bot_id][_eq]=${encodeURIComponent(botId)}&limit=5000`,
    { token: adminToken }
  );
  return rows.map((c) => ({
    ...c,
    tags: Array.isArray(c.tags) ? c.tags : [],
    custom_fields: c.custom_fields && typeof c.custom_fields === 'object' ? c.custom_fields : {},
    is_blocked: Boolean(c.is_blocked),
  }));
}

export async function markContactBlockedAsAdmin(contactId: string | number): Promise<void> {
  const adminToken = requireAdminToken();
  await directusFetch<unknown>(`/items/bot_contacts/${encodeURIComponent(String(contactId))}`, {
    method: 'PATCH',
    token: adminToken,
    body: { is_blocked: true },
  });
}

export async function getCampaignAsAdmin(
  campaignId: string
): Promise<BroadcastCampaignRecord | null> {
  const adminToken = requireAdminToken();
  try {
    const row = await directusFetch<BroadcastCampaignRecord>(
      `/items/broadcast_campaigns/${encodeURIComponent(campaignId)}`,
      { token: adminToken }
    );
    return row ? normalizeCampaign(row) : null;
  } catch {
    return null;
  }
}

export async function updateCampaignAsAdmin(
  campaignId: string,
  patch: Partial<
    Pick<
      BroadcastCampaignRecord,
      'status' | 'total_count' | 'sent_count' | 'failed_count' | 'scheduled_at'
    >
  >
): Promise<BroadcastCampaignRecord> {
  const adminToken = requireAdminToken();
  const updated = await directusFetch<BroadcastCampaignRecord>(
    `/items/broadcast_campaigns/${encodeURIComponent(campaignId)}`,
    {
      method: 'PATCH',
      token: adminToken,
      body: patch,
    }
  );
  return normalizeCampaign(updated);
}

export async function listDueScheduledCampaignsAsAdmin(
  nowIso: string
): Promise<BroadcastCampaignRecord[]> {
  const adminToken = requireAdminToken();
  const rows = await directusFetch<BroadcastCampaignRecord[]>(
    `/items/broadcast_campaigns?filter[status][_eq]=queued&filter[scheduled_at][_lte]=${encodeURIComponent(nowIso)}&limit=25`,
    { token: adminToken }
  );
  return rows.map(normalizeCampaign);
}
