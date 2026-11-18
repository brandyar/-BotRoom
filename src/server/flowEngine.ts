import type {
  AppointmentRecord,
  BaleInlineKeyboardButton,
  BaleInlineKeyboardMarkup,
  BaleReplyKeyboardMarkup,
  BaleReplyMarkup,
  BaleSendMessagePayload,
  BaleUpdate,
  BookingScheduleRecord,
  BookingServiceRecord,
  BotContactRecord,
  BotOrderRecord,
  BotSessionRecord,
  FlowDefinition,
  FlowNode,
  OrderCartItem,
  ProductRecord,
  ScheduledFollowUpItem,
  SurveyQuestionItem,
  SurveyRecord,
  SurveyResponseRecord,
} from '../types/bot.ts';
import { formatPriceToman, normalizePersianText, toPersianDigits } from '../utils/jalali.ts';
import { answerBaleCallbackQuery, dispatchBaleOutgoingPayload } from './baleApi.ts';
import { computeAvailableBookingDays } from './bookingUtils.ts';
import {
  createAppointmentAsAdmin,
  createBotOrderAsAdmin,
  createCollectedFormAsAdmin,
  createSurveyResponseAsAdmin,
  getAppointmentAsAdmin,
  getBackendConfig,
  getSurveyAsAdmin,
  hasContactAnsweredSurveyAsAdmin,
  listAppointmentsAsAdmin,
  listBookingSchedulesAsAdmin,
  listBookingServicesAsAdmin,
  listProductsAsAdmin,
  updateAppointmentAsAdmin,
  upsertBotContactAsAdmin,
} from './backend.ts';
import { getOrInitSession, persistSession } from './sessionStore.ts';

export interface FlowExecutionResult {
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

const bookingSlotLocks = new Map<string, Promise<unknown>>();

async function withBookingSlotLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = bookingSlotLocks.get(key) ?? Promise.resolve();
  const current = previous.then(
    () => fn(),
    () => fn()
  );
  bookingSlotLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (bookingSlotLocks.get(key) === current) {
      bookingSlotLocks.delete(key);
    }
  }
}

function parseSessionTags(session: BotSessionRecord): string[] {
  const raw = session.context_data.__contact_tags;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function saveSessionTags(session: BotSessionRecord, tags: string[]): void {
  session.context_data.__contact_tags = JSON.stringify(Array.from(new Set(tags.filter(Boolean))));
}

function parseCart(session: BotSessionRecord): OrderCartItem[] {
  const raw = session.context_data.__catalog_cart;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCart(session: BotSessionRecord, cart: OrderCartItem[]): void {
  session.context_data.__catalog_cart = JSON.stringify(cart);
}

function parseSurveyAnswers(session: BotSessionRecord): Record<string, string> {
  const raw = session.context_data.__survey_answers;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSurveyAnswers(session: BotSessionRecord, answers: Record<string, string>): void {
  session.context_data.__survey_answers = JSON.stringify(answers);
}

function interpolateTemplate(
  template: string,
  session: BotSessionRecord,
  userFirstName: string,
  contact: BotContactRecord | null
): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, rawPath: string) => {
    const path = rawPath.trim();
    if (path === 'user.first_name') {
      return contact?.first_name || userFirstName || 'کاربر گرامی';
    }
    if (path === 'user.id') {
      return session.bale_user_id;
    }
    if (path === 'contact.phone') {
      return contact?.phone || session.context_data.phone || '';
    }
    if (path === 'contact.tags') {
      const tags = contact?.tags?.length ? contact.tags : parseSessionTags(session);
      return tags.join('، ');
    }
    if (path.startsWith('contact.custom.')) {
      const customKey = path.slice('contact.custom.'.length);
      return contact?.custom_fields?.[customKey] ?? session.context_data[customKey] ?? '';
    }
    if (path.startsWith('form.')) {
      const key = path.slice(5);
      return session.context_data[key] ?? '';
    }
    return session.context_data[path] ?? '';
  });
}

function buildInlineMarkup(node: FlowNode): BaleInlineKeyboardMarkup | undefined {
  if (!node.inlineButtons || node.inlineButtons.length === 0) {
    return undefined;
  }

  const rows: BaleInlineKeyboardButton[][] = node.inlineButtons.map((btn) => {
    if (btn.url) {
      return [{ text: btn.text, url: btn.url }];
    }
    return [
      {
        text: btn.text,
        callback_data: `node:${btn.targetNodeId}:${btn.id}`,
      },
    ];
  });

  return { inline_keyboard: rows };
}

function buildQuestionMarkup(node: FlowNode): BaleReplyMarkup | undefined {
  if (node.inputType === 'phone' && node.requestContact) {
    const replyKeyboard: BaleReplyKeyboardMarkup = {
      keyboard: [
        [
          {
            text: node.requestContactButtonText || 'ارسال شماره موبایل من',
            request_contact: true,
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    };
    return replyKeyboard;
  }
  return buildInlineMarkup(node);
}

function normalizeIranPhone(raw: string): string {
  const digits = normalizePersianText(raw).replace(/[\s()-]/g, '');
  if (/^\+989\d{9}$/.test(digits)) {
    return `0${digits.slice(3)}`;
  }
  if (/^989\d{9}$/.test(digits)) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

function validateUserInput(
  node: FlowNode,
  rawInput: string,
  fromContactShare = false
): { valid: boolean; cleaned: string } {
  const normalized = normalizePersianText(rawInput);
  if (!normalized) {
    return { valid: false, cleaned: '' };
  }

  switch (node.inputType) {
    case 'number': {
      const numeric = Number(normalized);
      return { valid: !Number.isNaN(numeric), cleaned: normalized };
    }
    case 'phone': {
      const cleanedPhone = normalizeIranPhone(normalized);
      if (fromContactShare && cleanedPhone.length >= 10) {
        return { valid: true, cleaned: cleanedPhone };
      }
      const valid = /^09\d{9}$/.test(cleanedPhone);
      return { valid, cleaned: cleanedPhone };
    }
    case 'email': {
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
      return { valid, cleaned: normalized };
    }
    case 'text':
    case 'choice':
    default:
      return { valid: normalized.length >= 1, cleaned: rawInput.trim() };
  }
}

function evaluateCondition(
  node: FlowNode,
  session: BotSessionRecord,
  lastInput: string,
  contact: BotContactRecord | null
): string | undefined {
  if (!node.condition) return undefined;
  const { sourceKey, operator, value, trueNodeId, falseNodeId } = node.condition;

  let rawCandidate = '';
  if (sourceKey === 'last_input') {
    rawCandidate = lastInput;
  } else if (sourceKey === 'contact.tags') {
    const tags = contact?.tags?.length ? contact.tags : parseSessionTags(session);
    rawCandidate = tags.join(',');
  } else if (sourceKey === 'contact.phone') {
    rawCandidate = contact?.phone || session.context_data.phone || '';
  } else if (sourceKey.startsWith('contact.custom.')) {
    const customKey = sourceKey.slice('contact.custom.'.length);
    rawCandidate = contact?.custom_fields?.[customKey] ?? session.context_data[customKey] ?? '';
  } else {
    rawCandidate = session.context_data[sourceKey] ?? '';
  }

  const normalizedRaw = normalizePersianText(rawCandidate);
  const candidate = normalizedRaw.toLowerCase();
  const normalizedExpected = normalizePersianText(value);
  const expected = normalizedExpected.toLowerCase();

  let matched = false;
  if (operator === 'equals') matched = candidate === expected;
  else if (operator === 'not_equals') matched = candidate !== expected;
  else if (operator === 'contains') matched = candidate.includes(expected);
  else if (operator === 'not_contains') matched = !candidate.includes(expected);
  else if (operator === 'not_empty') matched = candidate.length > 0;
  else if (operator === 'greater_than') {
    const a = Number(normalizedRaw);
    const b = Number(normalizedExpected);
    matched = !Number.isNaN(a) && !Number.isNaN(b) && a > b;
  } else if (operator === 'less_than') {
    const a = Number(normalizedRaw);
    const b = Number(normalizedExpected);
    matched = !Number.isNaN(a) && !Number.isNaN(b) && a < b;
  }

  return matched ? trueNodeId : falseNodeId;
}

function findMatchingTriggerNode(flow: FlowDefinition, incomingText: string): FlowNode | undefined {
  const normalizedInput = normalizePersianText(incomingText).toLowerCase();
  const triggerNodes = flow.nodes.filter((n) => n.type === 'trigger');

  for (const trigger of triggerNodes) {
    if (!trigger.triggerPattern) continue;
    const patterns = trigger.triggerPattern
      .split(',')
      .map((p) => normalizePersianText(p).toLowerCase())
      .filter(Boolean);

    if (patterns.some((p) => normalizedInput === p || normalizedInput.startsWith(`${p} `))) {
      return trigger;
    }
  }

  return undefined;
}

function buildPublicFormContext(contextData: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(contextData)) {
    if (!k.startsWith('__')) {
      clean[k] = v;
    }
  }
  return clean;
}

// ---------------- Catalog Helpers (Phase 3) ----------------

function getCatalogCategories(products: ProductRecord[]): string[] {
  const set = new Set<string>();
  for (const p of products) {
    if (p.category?.trim()) set.add(p.category.trim());
  }
  return Array.from(set);
}

function filterCatalogProducts(
  allProducts: ProductRecord[],
  node: FlowNode,
  selectedCategory: string
): ProductRecord[] {
  const active = allProducts.filter((p) => p.is_active !== false);
  const fixedCat = node.catalogConfig?.categoryFilter?.trim();
  if (fixedCat && fixedCat !== 'all') {
    return active.filter((p) => (p.category || '').trim() === fixedCat);
  }
  if (selectedCategory && selectedCategory !== 'all') {
    return active.filter((p) => (p.category || '').trim() === selectedCategory);
  }
  return active;
}

function buildCatalogProductPayload(params: {
  chatId: string;
  node: FlowNode;
  allProducts: ProductRecord[];
  session: BotSessionRecord;
  index: number;
  selectedCategory: string;
  isEdit?: boolean;
  editMessageId?: number;
  hasSourcePhoto?: boolean;
}): BaleSendMessagePayload {
  const {
    chatId,
    node,
    allProducts,
    session,
    index,
    selectedCategory,
    isEdit,
    editMessageId,
    hasSourcePhoto,
  } = params;

  const filtered = filterCatalogProducts(allProducts, node, selectedCategory);
  const categories = getCatalogCategories(allProducts.filter((p) => p.is_active !== false));
  const cart = parseCart(session);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  if (filtered.length === 0) {
    return {
      chat_id: chatId,
      text: node.catalogConfig?.emptyText || 'در حال حاضر محصول فعالی در این دسته‌بندی موجود نیست.',
      is_edit: isEdit,
      edit_message_id: editMessageId,
      has_source_photo: hasSourcePhoto,
      reply_markup:
        categories.length > 0 && selectedCategory !== 'all'
          ? {
              inline_keyboard: [
                [{ text: 'نمایش همه دسته‌بندی‌ها', callback_data: `cb:cat:${node.id}:all` }],
              ],
            }
          : undefined,
    };
  }

  const safeIdx = ((index % filtered.length) + filtered.length) % filtered.length;
  const product = filtered[safeIdx];
  const inCartQty = cart.find((item) => item.product_id === product.id)?.quantity || 0;
  const allowCart = node.catalogConfig?.allowCart !== false;

  const lines: string[] = [
    `🛍 ${product.title}`,
    product.category ? `دسته‌بندی: ${product.category}` : '',
    product.description ? `\n${product.description}` : '',
    `\n💰 قیمت: ${formatPriceToman(product.price)}`,
    product.stock > 0
      ? `📦 موجودی: ${toPersianDigits(product.stock)} عدد`
      : '⚠️ ناموجود',
    `\nمحصول ${toPersianDigits(safeIdx + 1)} از ${toPersianDigits(filtered.length)}`,
  ].filter(Boolean);

  const keyboard: BaleInlineKeyboardButton[][] = [];

  if (filtered.length > 1) {
    const prevIdx = (safeIdx - 1 + filtered.length) % filtered.length;
    const nextIdx = (safeIdx + 1) % filtered.length;
    keyboard.push([
      { text: 'قبلی ➡️', callback_data: `cb:pg:${node.id}:${prevIdx}` },
      { text: '⬅️ بعدی', callback_data: `cb:pg:${node.id}:${nextIdx}` },
    ]);
  }

  if (allowCart) {
    const addLabel =
      inCartQty > 0
        ? `➕ افزودن به سبد (در سبد: ${toPersianDigits(inCartQty)})`
        : '➕ افزودن به سبد خرید';
    keyboard.push([{ text: addLabel, callback_data: `cb:add:${node.id}:${safeIdx}` }]);
    if (cartCount > 0) {
      const total = cart.reduce((s, item) => s + item.price * item.quantity, 0);
      keyboard.push([
        {
          text: `🛒 مشاهده سبد خرید (${toPersianDigits(cartCount)}) · ${formatPriceToman(total)}`,
          callback_data: `cb:cart:${node.id}`,
        },
      ]);
    }
  }

  if (!node.catalogConfig?.categoryFilter || node.catalogConfig.categoryFilter === 'all') {
    if (categories.length > 1) {
      const catRow: BaleInlineKeyboardButton[] = [
        {
          text: selectedCategory === 'all' ? '✓ همه' : 'همه',
          callback_data: `cb:cat:${node.id}:all`,
        },
        ...categories.slice(0, 3).map((cat, cIdx) => ({
          text: selectedCategory === cat ? `✓ ${cat}` : cat,
          callback_data: `cb:cat:${node.id}:${cIdx}`,
        })),
      ];
      keyboard.push(catRow);
    }
  }

  return {
    chat_id: chatId,
    text: lines.join('\n'),
    photo_url: product.image_url || undefined,
    is_edit: isEdit,
    edit_message_id: editMessageId,
    has_source_photo: hasSourcePhoto,
    reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined,
  };
}

function buildCartViewPayload(params: {
  chatId: string;
  node: FlowNode;
  session: BotSessionRecord;
  isEdit?: boolean;
  editMessageId?: number;
  hasSourcePhoto?: boolean;
}): BaleSendMessagePayload {
  const { chatId, node, session, isEdit, editMessageId, hasSourcePhoto } = params;
  const cart = parseCart(session);

  if (cart.length === 0) {
    return {
      chat_id: chatId,
      text: 'سبد خرید شما در حال حاضر خالی است.',
      is_edit: isEdit,
      edit_message_id: editMessageId,
      has_source_photo: hasSourcePhoto,
      reply_markup: {
        inline_keyboard: [[{ text: 'بازگشت به کاتالوگ', callback_data: `cb:pg:${node.id}:0` }]],
      },
    };
  }

  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const lines = [
    '🛒 سبد خرید شما:',
    '',
    ...cart.map(
      (item, idx) =>
        `${toPersianDigits(idx + 1)}. ${item.title} × ${toPersianDigits(item.quantity)} = ${formatPriceToman(item.price * item.quantity)}`
    ),
    '',
    `جمع کل قابل پرداخت: ${formatPriceToman(total)}`,
  ];

  const keyboard: BaleInlineKeyboardButton[][] = cart.slice(0, 5).map((item, idx) => [
    { text: `➖ ${item.title.slice(0, 14)}`, callback_data: `cb:qty:${node.id}:${idx}:-1` },
    { text: `➕ (${toPersianDigits(item.quantity)})`, callback_data: `cb:qty:${node.id}:${idx}:1` },
  ]);

  keyboard.push([{ text: '✅ ثبت نهایی سفارش', callback_data: `cb:chk:${node.id}` }]);
  keyboard.push([
    { text: 'پاک کردن سبد', callback_data: `cb:clr:${node.id}` },
    { text: 'بازگشت به کاتالوگ', callback_data: `cb:pg:${node.id}:0` },
  ]);

  return {
    chat_id: chatId,
    text: lines.join('\n'),
    is_edit: isEdit,
    edit_message_id: editMessageId,
    has_source_photo: hasSourcePhoto,
    reply_markup: { inline_keyboard: keyboard },
  };
}

// ---------------- Survey Helpers (Phase 3) ----------------

function resolveSurveyDefinition(
  node: FlowNode,
  linkedSurvey: SurveyRecord | null
): {
  surveyId: string | null;
  type: 'rating' | 'multi_choice';
  allowMultiple: boolean;
  questions: SurveyQuestionItem[];
  title: string;
} {
  if (linkedSurvey) {
    return {
      surveyId: linkedSurvey.id,
      type: linkedSurvey.type,
      allowMultiple: linkedSurvey.allow_multiple !== false,
      title: linkedSurvey.title,
      questions:
        linkedSurvey.questions_json.length > 0
          ? linkedSurvey.questions_json
          : [
              {
                id: 'q_rating',
                text: node.surveyConfig?.questionText || linkedSurvey.title,
                type: 'rating',
              },
            ],
    };
  }

  const cfg = node.surveyConfig;
  const type = cfg?.surveyType || 'rating';
  const questions =
    cfg?.questions && cfg.questions.length > 0
      ? cfg.questions
      : [
          {
            id: 'q1',
            text: cfg?.questionText || node.messageText || 'از کیفیت خدمات ما چه امتیازی می‌دهید؟',
            type: 'rating' as const,
          },
        ];

  return {
    surveyId: cfg?.surveyId || null,
    type,
    allowMultiple: true,
    title: node.title,
    questions,
  };
}

function buildSurveyQuestionPayload(params: {
  chatId: string;
  node: FlowNode;
  surveyTitle: string;
  question: SurveyQuestionItem;
  stepIdx: number;
  totalSteps: number;
  isSimpleRating: boolean;
  session: BotSessionRecord;
  userFirstName: string;
  contact: BotContactRecord | null;
}): BaleSendMessagePayload {
  const {
    chatId,
    node,
    question,
    stepIdx,
    totalSteps,
    isSimpleRating,
    session,
    userFirstName,
    contact,
  } = params;

  const textBody = interpolateTemplate(question.text, session, userFirstName, contact);
  const header =
    totalSteps > 1
      ? `سوال ${toPersianDigits(stepIdx + 1)} از ${toPersianDigits(totalSteps)}:\n${textBody}`
      : textBody;

  if (question.type === 'rating' || isSimpleRating) {
    const prefix = isSimpleRating ? `sv:r:${node.id}` : `sv:m:${node.id}:${stepIdx}`;
    return {
      chat_id: chatId,
      text: header,
      reply_markup: {
        inline_keyboard: [
          [1, 2, 3, 4, 5].map((n) => ({
            text: `${toPersianDigits(n)} ⭐`,
            callback_data: `${prefix}:${n}`,
          })),
        ],
      },
    };
  }

  if (question.type === 'choice' && question.options && question.options.length > 0) {
    return {
      chat_id: chatId,
      text: header,
      reply_markup: {
        inline_keyboard: question.options.map((opt, optIdx) => [
          {
            text: opt,
            callback_data: `sv:m:${node.id}:${stepIdx}:${optIdx}`,
          },
        ]),
      },
    };
  }

  // Open text survey question
  session.awaiting_field_key = `__survey_text:${node.id}:${stepIdx}`;
  return {
    chat_id: chatId,
    text: `${header}\n\n(لطفاً پاسخ خود را به صورت متن ارسال کنید)`,
  };
}

function buildBookingServicesPayload(params: {
  chatId: string;
  node: FlowNode;
  services: BookingServiceRecord[];
  session: BotSessionRecord;
  userFirstName: string;
  contact: BotContactRecord | null;
  isEdit?: boolean;
  editMessageId?: number;
}): BaleSendMessagePayload {
  const { chatId, node, services, session, userFirstName, contact, isEdit, editMessageId } = params;
  const intro = interpolateTemplate(
    node.bookingConfig?.introText ||
      node.messageText ||
      'لطفاً خدمت مورد نظر خود را برای دریافت نوبت انتخاب کنید:',
    session,
    userFirstName,
    contact
  );

  if (services.length === 0) {
    return {
      chat_id: chatId,
      text:
        node.bookingConfig?.emptySlotsText ||
        'در حال حاضر هیچ سرویس فعالی برای نوبت‌دهی تعریف نشده است.',
      is_edit: isEdit,
      edit_message_id: editMessageId,
    };
  }

  return {
    chat_id: chatId,
    text: intro,
    is_edit: isEdit,
    edit_message_id: editMessageId,
    reply_markup: {
      inline_keyboard: services.map((svc, idx) => {
        const priceSuffix = svc.price > 0 ? ` (${formatPriceToman(svc.price)})` : '';
        return [
          {
            text: `${svc.title} · ${toPersianDigits(svc.duration_minutes)} دقیقه${priceSuffix}`,
            callback_data: `bk:s:${node.id}:${idx}`,
          },
        ];
      }),
    },
  };
}

function buildBookingDaysPayload(params: {
  chatId: string;
  node: FlowNode;
  service: BookingServiceRecord;
  serviceIdx: number;
  totalServices: number;
  schedules: BookingScheduleRecord[];
  appointments: AppointmentRecord[];
  isEdit?: boolean;
  editMessageId?: number;
}): BaleSendMessagePayload {
  const {
    chatId,
    node,
    service,
    serviceIdx,
    totalServices,
    schedules,
    appointments,
    isEdit,
    editMessageId,
  } = params;

  const days = computeAvailableBookingDays({
    service,
    schedules,
    appointments,
    daysAhead: node.bookingConfig?.daysAhead || 7,
  });

  if (days.length === 0) {
    const keyboard: BaleInlineKeyboardButton[][] = [];
    if (totalServices > 1 && !node.bookingConfig?.serviceId) {
      keyboard.push([{ text: '🔙 بازگشت به لیست خدمات', callback_data: `bk:sv:${node.id}` }]);
    }
    return {
      chat_id: chatId,
      text:
        node.bookingConfig?.emptySlotsText ||
        `برای سرویس «${service.title}» در روزهای پیش رو نوبت خالی یافت نشد.`,
      is_edit: isEdit,
      edit_message_id: editMessageId,
      ...(keyboard.length > 0 ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    };
  }

  const keyboard: BaleInlineKeyboardButton[][] = [];
  for (let i = 0; i < days.length; i += 2) {
    const row: BaleInlineKeyboardButton[] = [];
    for (const day of days.slice(i, i + 2)) {
      row.push({
        text: `📅 ${day.shortLabel} (${toPersianDigits(day.slots.length)} نوبت)`,
        callback_data: `bk:d:${node.id}:${serviceIdx}:${day.dayOffset}`,
      });
    }
    keyboard.push(row);
  }
  if (totalServices > 1 && !node.bookingConfig?.serviceId) {
    keyboard.push([{ text: '🔙 تغییر سرویس', callback_data: `bk:sv:${node.id}` }]);
  }

  const priceLine = service.price > 0 ? `هزینه: ${formatPriceToman(service.price)}` : 'رایگان';
  return {
    chat_id: chatId,
    text: `🗓 سرویس: ${service.title}\nمدت زمان: ${toPersianDigits(service.duration_minutes)} دقیقه · ${priceLine}\n\nروز مورد نظر خود را انتخاب کنید:`,
    is_edit: isEdit,
    edit_message_id: editMessageId,
    reply_markup: { inline_keyboard: keyboard },
  };
}

function buildBookingSlotsPayload(params: {
  chatId: string;
  node: FlowNode;
  service: BookingServiceRecord;
  serviceIdx: number;
  dayOffset: number;
  schedules: BookingScheduleRecord[];
  appointments: AppointmentRecord[];
  noticePrefix?: string;
  isEdit?: boolean;
  editMessageId?: number;
}): BaleSendMessagePayload {
  const {
    chatId,
    node,
    service,
    serviceIdx,
    dayOffset,
    schedules,
    appointments,
    noticePrefix,
    isEdit,
    editMessageId,
  } = params;

  const days = computeAvailableBookingDays({
    service,
    schedules,
    appointments,
    daysAhead: Math.max(node.bookingConfig?.daysAhead || 7, dayOffset + 1),
  });
  const selectedDay = days.find((d) => d.dayOffset === dayOffset);

  if (!selectedDay || selectedDay.slots.length === 0) {
    return {
      chat_id: chatId,
      text: `${noticePrefix ? `${noticePrefix}\n\n` : ''}ظرفیت نوبت‌های این روز تکمیل شده است. لطفاً روز دیگری را انتخاب کنید:`,
      is_edit: isEdit,
      edit_message_id: editMessageId,
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 بازگشت به تقویم روزها', callback_data: `bk:s:${node.id}:${serviceIdx}` }]],
      },
    };
  }

  const keyboard: BaleInlineKeyboardButton[][] = [];
  for (let i = 0; i < selectedDay.slots.length; i += 2) {
    const row: BaleInlineKeyboardButton[] = [];
    selectedDay.slots.slice(i, i + 2).forEach((slot) => {
      const capText =
        slot.totalCapacity > 1 ? ` (${toPersianDigits(slot.remainingCapacity)} جا)` : '';
      row.push({
        text: `⏰ ${slot.timeLabel}${capText}`,
        callback_data: `bk:t:${node.id}:${serviceIdx}:${dayOffset}:${slot.timeCode}`,
      });
    });
    keyboard.push(row);
  }
  keyboard.push([{ text: '🔙 بازگشت به انتخاب روز', callback_data: `bk:s:${node.id}:${serviceIdx}` }]);

  return {
    chat_id: chatId,
    text: `${noticePrefix ? `${noticePrefix}\n\n` : ''}📅 ${selectedDay.shortLabel} (${selectedDay.jalaliDateSlash})\nساعت‌های آزاد برای «${service.title}»:`,
    is_edit: isEdit,
    edit_message_id: editMessageId,
    reply_markup: { inline_keyboard: keyboard },
  };
}

export async function executeBotFlow(params: {
  botId: string;
  flowId?: string | null;
  botToken?: string;
  flow: FlowDefinition;
  update: BaleUpdate;
  dryRun?: boolean;
  simulatedTags?: string[];
  startAtNodeId?: string;
  previewProducts?: ProductRecord[];
  previewSurveys?: SurveyRecord[];
  previewBookingServices?: BookingServiceRecord[];
  previewBookingSchedules?: BookingScheduleRecord[];
  previewAppointments?: AppointmentRecord[];
}): Promise<FlowExecutionResult> {
  const {
    botId,
    flowId,
    botToken,
    flow,
    update,
    dryRun = false,
    simulatedTags,
    startAtNodeId,
    previewProducts,
    previewSurveys,
    previewBookingServices,
    previewBookingSchedules,
    previewAppointments,
  } = params;

  const isCallback = Boolean(update.callback_query);
  const message = update.message || update.callback_query?.message;
  const from = update.callback_query?.from || update.message?.from;
  const chatId = String(message?.chat.id || from?.id || '0');
  const userId = String(from?.id || chatId);
  const userFirstName = from?.first_name || 'کاربر';
  const userLastName = from?.last_name || null;
  const userUsername = from?.username ? `@${from.username}` : null;
  const userFullName =
    [from?.first_name, from?.last_name].filter(Boolean).join(' ') || userFirstName;

  const callbackMessageId = update.callback_query?.message?.message_id;
  const callbackHasPhoto = Boolean(
    update.callback_query?.message?.photo && update.callback_query.message.photo.length > 0
  );

  const sharedPhone = update.message?.contact?.phone_number || '';
  const incomingText = isCallback ? '' : sharedPhone || update.message?.text || '';

  let session = await getOrInitSession({
    botId,
    chatId,
    userId,
    userName: userFullName,
    persistToBackend: !dryRun,
  });

  if (dryRun && simulatedTags) {
    saveSessionTags(session, simulatedTags);
  }

  const { isConfigured, hasAdminToken } = getBackendConfig();
  const canPersistBackend = !dryRun && isConfigured && hasAdminToken;
  let contact: BotContactRecord | null = null;

  if (canPersistBackend) {
    try {
      contact = await upsertBotContactAsAdmin({
        bot_id: botId,
        bale_user_id: userId,
        bale_chat_id: chatId,
        first_name: from?.first_name || null,
        last_name: userLastName,
        bale_username: userUsername,
        phone: sharedPhone ? normalizeIranPhone(sharedPhone) : null,
        is_blocked: false,
      });
      if (contact.tags.length > 0) {
        saveSessionTags(session, contact.tags);
      }
    } catch (err) {
      console.warn('bot_contacts upsert skipped:', err instanceof Error ? err.message : err);
    }
  } else if (sharedPhone) {
    session.context_data.phone = normalizeIranPhone(sharedPhone);
  }

  const nodeMap = new Map<string, FlowNode>(flow.nodes.map((n) => [n.id, n]));
  const outgoingPayloads: BaleSendMessagePayload[] = [];
  const scheduledFollowUps: ScheduledFollowUpItem[] = [];
  let savedFormPayload: Record<string, string> | null = null;
  let createdOrder: BotOrderRecord | null = null;
  let createdSurveyResponse: SurveyResponseRecord | null = null;
  let createdAppointment: AppointmentRecord | null = null;
  let callbackAnswerText: string | undefined;
  let targetNode: FlowNode | undefined = startAtNodeId ? nodeMap.get(startAtNodeId) : undefined;
  let shouldRemoveReplyKeyboard = Boolean(sharedPhone);

  let cachedProducts: ProductRecord[] | null = previewProducts ?? null;
  async function loadProductsForBot(): Promise<ProductRecord[]> {
    if (cachedProducts) return cachedProducts;
    if (canPersistBackend) {
      try {
        cachedProducts = await listProductsAsAdmin(botId);
        return cachedProducts;
      } catch (err) {
        console.warn('products fetch skipped:', err instanceof Error ? err.message : err);
      }
    }
    cachedProducts = [];
    return cachedProducts;
  }

  async function loadSurveyById(surveyId?: string): Promise<SurveyRecord | null> {
    if (!surveyId) return null;
    if (previewSurveys) {
      const found = previewSurveys.find((s) => s.id === surveyId);
      if (found) return found;
    }
    if (canPersistBackend) {
      return getSurveyAsAdmin(surveyId);
    }
    return null;
  }

  let cachedBookingServices: BookingServiceRecord[] | null = previewBookingServices ?? null;
  async function loadBookingServicesForBot(): Promise<BookingServiceRecord[]> {
    if (cachedBookingServices) return cachedBookingServices.filter((s) => s.is_active !== false);
    if (canPersistBackend) {
      try {
        cachedBookingServices = await listBookingServicesAsAdmin(botId);
        return cachedBookingServices;
      } catch (err) {
        console.warn('booking_services fetch skipped:', err instanceof Error ? err.message : err);
      }
    }
    cachedBookingServices = [];
    return [];
  }

  async function loadBookingSchedulesForService(
    serviceId?: string
  ): Promise<BookingScheduleRecord[]> {
    if (previewBookingSchedules) {
      return serviceId
        ? previewBookingSchedules.filter((s) => s.service_id === serviceId && s.is_active !== false)
        : previewBookingSchedules.filter((s) => s.is_active !== false);
    }
    if (canPersistBackend) {
      try {
        return await listBookingSchedulesAsAdmin(botId, serviceId);
      } catch (err) {
        console.warn('booking_schedules fetch skipped:', err instanceof Error ? err.message : err);
      }
    }
    return [];
  }

  async function loadAppointmentsForService(serviceId?: string): Promise<AppointmentRecord[]> {
    if (previewAppointments) {
      return serviceId
        ? previewAppointments.filter((a) => a.service_id === serviceId && a.status !== 'cancelled')
        : previewAppointments.filter((a) => a.status !== 'cancelled');
    }
    if (canPersistBackend) {
      try {
        return await listAppointmentsAsAdmin(botId, serviceId);
      } catch (err) {
        console.warn('appointments fetch skipped:', err instanceof Error ? err.message : err);
      }
    }
    return [];
  }

  async function finalizeSurveyAndAdvance(params: {
    surveyNode: FlowNode;
    surveyId: string | null;
    answers: Record<string, string>;
    numericScore: number | null;
  }) {
    const { surveyNode, surveyId, answers, numericScore } = params;
    if (numericScore !== null) {
      session.context_data.survey_score = String(numericScore);
    }
    session.context_data.survey_answers_summary = Object.values(answers).join(' | ');
    delete session.context_data.__survey_step;
    delete session.context_data.__survey_answers;
    session.awaiting_field_key = null;

    if (canPersistBackend) {
      try {
        createdSurveyResponse = await createSurveyResponseAsAdmin({
          survey_id: surveyId,
          bot_id: botId,
          contact_id: contact?.id || null,
          bale_user_id: userId,
          bale_chat_id: chatId,
          bale_user_name: userFullName,
          answers_json: answers,
          score: numericScore,
        });
      } catch (err) {
        console.warn('survey_responses save skipped:', err instanceof Error ? err.message : err);
      }
    } else {
      createdSurveyResponse = {
        id: `sim_sr_${Date.now()}`,
        survey_id: surveyId,
        bot_id: botId,
        bale_user_id: userId,
        bale_user_name: userFullName,
        answers_json: answers,
        score: numericScore,
        date_created: new Date().toISOString(),
      };
    }

    const threshold = surveyNode.surveyConfig?.lowScoreThreshold ?? 3;
    const lowNodeId = surveyNode.surveyConfig?.lowScoreNodeId;
    const shouldTakeLowBranch =
      numericScore !== null && Boolean(lowNodeId) && numericScore <= threshold;

    const nextTargetId = shouldTakeLowBranch ? lowNodeId : surveyNode.nextNodeId;
    if (nextTargetId && nodeMap.has(nextTargetId)) {
      targetNode = nodeMap.get(nextTargetId);
    } else {
      const thankYou = interpolateTemplate(
        surveyNode.surveyConfig?.thankYouText || 'با تشکر از ثبت نظر ارزشمند شما!',
        session,
        userFirstName,
        contact
      );
      outgoingPayloads.push({ chat_id: chatId, text: thankYou });
    }
  }

  // 1. Global command / trigger check
  if (!targetNode && !isCallback && incomingText && !sharedPhone) {
    const matchedTrigger = findMatchingTriggerNode(flow, incomingText);
    if (matchedTrigger) {
      if (normalizePersianText(incomingText).toLowerCase() === '/start') {
        const preservedTags = dryRun && simulatedTags ? simulatedTags : parseSessionTags(session);
        session.context_data = {};
        if (preservedTags.length > 0) {
          saveSessionTags(session, preservedTags);
        }
        session.awaiting_field_key = null;
      }
      targetNode = matchedTrigger;
    }
  }

  // 2. Callback query dispatch (flow buttons + catalog callbacks + survey callbacks)
  if (!targetNode && isCallback && update.callback_query?.data) {
    const data = update.callback_query.data;

    // 2A. Flow button ("node:<targetNodeId>:<buttonId>")
    if (data.startsWith('node:')) {
      const [, nextId, buttonId] = data.split(':');
      if (session.current_node_id && session.awaiting_field_key) {
        const currentNode = nodeMap.get(session.current_node_id);
        const clickedButton = currentNode?.inlineButtons?.find((b) => b.id === buttonId);
        if (clickedButton) {
          session.context_data[session.awaiting_field_key] = clickedButton.text;
          session.awaiting_field_key = null;
        }
      }
      targetNode = nodeMap.get(nextId);
      callbackAnswerText = 'انتخاب ثبت شد';
    }
    // 2B. Catalog Browser callbacks ("cb:<action>:<nodeId>:...")
    else if (data.startsWith('cb:')) {
      const parts = data.split(':');
      const action = parts[1];
      const catNodeId = parts[2];
      const catNode = nodeMap.get(catNodeId);

      if (catNode && catNode.type === 'catalog_browser') {
        const products = await loadProductsForBot();
        const categories = getCatalogCategories(products.filter((p) => p.is_active !== false));
        const selectedCategory = session.context_data.__catalog_cat || 'all';
        session.current_node_id = catNode.id;

        if (action === 'pg') {
          const nextIdx = Number(parts[3] || 0);
          session.context_data.__catalog_idx = String(nextIdx);
          outgoingPayloads.push(
            buildCatalogProductPayload({
              chatId,
              node: catNode,
              allProducts: products,
              session,
              index: nextIdx,
              selectedCategory,
              isEdit: true,
              editMessageId: callbackMessageId,
              hasSourcePhoto: callbackHasPhoto,
            })
          );
          callbackAnswerText = 'بروزرسانی محصول';
        } else if (action === 'cat') {
          const rawCat = parts[3] || 'all';
          const nextCat =
            rawCat === 'all' ? 'all' : categories[Number(rawCat)] || 'all';
          session.context_data.__catalog_cat = nextCat;
          session.context_data.__catalog_idx = '0';
          outgoingPayloads.push(
            buildCatalogProductPayload({
              chatId,
              node: catNode,
              allProducts: products,
              session,
              index: 0,
              selectedCategory: nextCat,
              isEdit: true,
              editMessageId: callbackMessageId,
              hasSourcePhoto: callbackHasPhoto,
            })
          );
          callbackAnswerText = nextCat === 'all' ? 'نمایش همه محصولات' : `دسته: ${nextCat}`;
        } else if (action === 'add') {
          const prodIdx = Number(parts[3] || 0);
          const filtered = filterCatalogProducts(products, catNode, selectedCategory);
          const product = filtered[prodIdx];
          if (product) {
            const cart = parseCart(session);
            const existing = cart.find((i) => i.product_id === product.id);
            if (existing) {
              existing.quantity += 1;
            } else {
              cart.push({
                product_id: product.id,
                title: product.title,
                price: product.price,
                quantity: 1,
              });
            }
            saveCart(session, cart);
            callbackAnswerText = `${product.title} به سبد اضافه شد`;
          }
          outgoingPayloads.push(
            buildCatalogProductPayload({
              chatId,
              node: catNode,
              allProducts: products,
              session,
              index: prodIdx,
              selectedCategory,
              isEdit: true,
              editMessageId: callbackMessageId,
              hasSourcePhoto: callbackHasPhoto,
            })
          );
        } else if (action === 'cart') {
          outgoingPayloads.push(
            buildCartViewPayload({
              chatId,
              node: catNode,
              session,
              isEdit: true,
              editMessageId: callbackMessageId,
              hasSourcePhoto: callbackHasPhoto,
            })
          );
          callbackAnswerText = 'سبد خرید';
        } else if (action === 'qty') {
          const cartIdx = Number(parts[3] || 0);
          const delta = Number(parts[4] || 0);
          const cart = parseCart(session);
          if (cart[cartIdx]) {
            cart[cartIdx].quantity += delta;
            if (cart[cartIdx].quantity <= 0) {
              cart.splice(cartIdx, 1);
            }
            saveCart(session, cart);
          }
          outgoingPayloads.push(
            buildCartViewPayload({
              chatId,
              node: catNode,
              session,
              isEdit: true,
              editMessageId: callbackMessageId,
              hasSourcePhoto: callbackHasPhoto,
            })
          );
          callbackAnswerText = 'سبد خرید بروزرسانی شد';
        } else if (action === 'clr') {
          saveCart(session, []);
          outgoingPayloads.push(
            buildCatalogProductPayload({
              chatId,
              node: catNode,
              allProducts: products,
              session,
              index: 0,
              selectedCategory,
              isEdit: true,
              editMessageId: callbackMessageId,
              hasSourcePhoto: callbackHasPhoto,
            })
          );
          callbackAnswerText = 'سبد خرید خالی شد';
        } else if (action === 'chk') {
          const cart = parseCart(session);
          if (cart.length === 0) {
            callbackAnswerText = 'سبد خرید خالی است';
          } else {
            const totalAmount = cart.reduce((s, item) => s + item.price * item.quantity, 0);
            const customerPhone = contact?.phone || session.context_data.phone || null;

            if (canPersistBackend) {
              try {
                createdOrder = await createBotOrderAsAdmin({
                  bot_id: botId,
                  contact_id: contact?.id || null,
                  bale_user_id: userId,
                  bale_chat_id: chatId,
                  customer_name: userFullName,
                  customer_phone: customerPhone,
                  items: cart,
                  total_amount: totalAmount,
                  status: 'pending',
                });
              } catch (err) {
                console.warn('bot_orders save skipped:', err instanceof Error ? err.message : err);
              }
            } else {
              createdOrder = {
                id: `sim_ord_${Date.now().toString(36)}`,
                bot_id: botId,
                bale_user_id: userId,
                bale_chat_id: chatId,
                customer_name: userFullName,
                customer_phone: customerPhone,
                items: cart,
                total_amount: totalAmount,
                status: 'pending',
                date_created: new Date().toISOString(),
              };
            }

            const orderId = createdOrder?.id || `ORD-${Date.now().toString(36)}`;
            session.context_data.order_id = orderId;
            session.context_data.order_total = String(totalAmount);
            session.context_data.order_summary = cart
              .map((i) => `${i.title} (${i.quantity})`)
              .join('، ');
            saveCart(session, []);

            const receiptLines = [
              catNode.catalogConfig?.checkoutConfirmText || '✅ سفارش شما با موفقیت ثبت شد!',
              `کد پیگیری: ${orderId.slice(0, 8)}`,
              `اقلام: ${session.context_data.order_summary}`,
              `جمع کل: ${formatPriceToman(totalAmount)}`,
            ];
            outgoingPayloads.push({
              chat_id: chatId,
              text: receiptLines.join('\n'),
            });
            callbackAnswerText = 'سفارش ثبت شد';

            if (catNode.nextNodeId && nodeMap.has(catNode.nextNodeId)) {
              targetNode = nodeMap.get(catNode.nextNodeId);
            }
          }
        }

        // Return early for catalog navigation unless checkout triggered nextNodeId
        if (!targetNode) {
          session = await persistSession(session, { persistToBackend: !dryRun });
          if (!dryRun && botToken) {
            if (update.callback_query?.id) {
              await answerBaleCallbackQuery(botToken, update.callback_query.id, callbackAnswerText);
            }
            for (const payload of outgoingPayloads) {
              await dispatchBaleOutgoingPayload(botToken, payload);
            }
          }
          return {
            matchedNodeId: catNode.id,
            outgoingPayloads,
            callbackAnswerText,
            createdOrder,
            contactTags: parseSessionTags(session),
            session,
          };
        }
      }
    }
    // 2C. Survey callbacks ("sv:r:<nodeId>:<score>" OR "sv:m:<nodeId>:<qIdx>:<valOrOptIdx>")
    else if (data.startsWith('sv:')) {
      const parts = data.split(':');
      const mode = parts[1];
      const srvNodeId = parts[2];
      const srvNode = nodeMap.get(srvNodeId);

      if (srvNode && srvNode.type === 'survey_node') {
        const linked = await loadSurveyById(srvNode.surveyConfig?.surveyId);
        const def = resolveSurveyDefinition(srvNode, linked);
        session.current_node_id = srvNode.id;

        if (mode === 'r') {
          const score = Number(parts[3] || 0);
          callbackAnswerText = `امتیاز ${toPersianDigits(score)} ثبت شد`;
          await finalizeSurveyAndAdvance({
            surveyNode: srvNode,
            surveyId: def.surveyId,
            answers: { [def.questions[0]?.text || 'امتیاز رضایت']: String(score) },
            numericScore: score,
          });
        } else if (mode === 'm') {
          const qIdx = Number(parts[3] || 0);
          const rawChoice = parts[4] || '';
          const q = def.questions[qIdx];
          const answers = parseSurveyAnswers(session);
          if (q) {
            const answerVal =
              q.type === 'choice' && q.options
                ? q.options[Number(rawChoice)] || rawChoice
                : rawChoice;
            answers[q.text] = answerVal;
            saveSurveyAnswers(session, answers);
          }
          callbackAnswerText = 'پاسخ ثبت شد';

          const nextStep = qIdx + 1;
          if (nextStep < def.questions.length) {
            session.context_data.__survey_step = String(nextStep);
            outgoingPayloads.push(
              buildSurveyQuestionPayload({
                chatId,
                node: srvNode,
                surveyTitle: def.title,
                question: def.questions[nextStep],
                stepIdx: nextStep,
                totalSteps: def.questions.length,
                isSimpleRating: false,
                session,
                userFirstName,
                contact,
              })
            );
          } else {
            const numericScores = def.questions
              .filter((item) => item.type === 'rating')
              .map((item) => Number(answers[item.text]))
              .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 5);
            const avgScore =
              numericScores.length > 0
                ? Math.round(numericScores.reduce((a, b) => a + b, 0) / numericScores.length)
                : null;
            await finalizeSurveyAndAdvance({
              surveyNode: srvNode,
              surveyId: def.surveyId,
              answers,
              numericScore: avgScore,
            });
          }
        }

        if (!targetNode) {
          session = await persistSession(session, { persistToBackend: !dryRun });
          if (!dryRun && botToken) {
            if (update.callback_query?.id) {
              await answerBaleCallbackQuery(botToken, update.callback_query.id, callbackAnswerText);
            }
            for (const payload of outgoingPayloads) {
              await dispatchBaleOutgoingPayload(botToken, payload);
            }
          }
          return {
            matchedNodeId: srvNode.id,
            outgoingPayloads,
            callbackAnswerText,
            createdSurveyResponse,
            contactTags: parseSessionTags(session),
            session,
          };
        }
      }
    }
    // 2D. Booking callbacks ("bk:sv:<nodeId>" | "bk:s:<nodeId>:<svcIdx>" | "bk:d:<nodeId>:<svcIdx>:<dayOffset>" | "bk:t:<nodeId>:<svcIdx>:<dayOffset>:<slotIdx>")
    else if (data.startsWith('bk:')) {
      const parts = data.split(':');
      const action = parts[1];
      const bkNodeId = parts[2];
      const bkNode = nodeMap.get(bkNodeId);

      if (bkNode && bkNode.type === 'booking_node') {
        const services = await loadBookingServicesForBot();
        session.current_node_id = bkNode.id;

        if (action === 'sv') {
          outgoingPayloads.push(
            buildBookingServicesPayload({
              chatId,
              node: bkNode,
              services,
              session,
              userFirstName,
              contact,
              isEdit: true,
              editMessageId: callbackMessageId,
            })
          );
          callbackAnswerText = 'لیست خدمات';
        } else if (action === 's') {
          const svcIdx = Number(parts[3] || 0);
          const service = services[svcIdx];
          if (service) {
            const [schedules, appointments] = await Promise.all([
              loadBookingSchedulesForService(service.id),
              loadAppointmentsForService(service.id),
            ]);
            outgoingPayloads.push(
              buildBookingDaysPayload({
                chatId,
                node: bkNode,
                service,
                serviceIdx: svcIdx,
                totalServices: services.length,
                schedules,
                appointments,
                isEdit: true,
                editMessageId: callbackMessageId,
              })
            );
            callbackAnswerText = service.title;
          }
        } else if (action === 'd') {
          const svcIdx = Number(parts[3] || 0);
          const dayOffset = Number(parts[4] || 0);
          const service = services[svcIdx];
          if (service) {
            const [schedules, appointments] = await Promise.all([
              loadBookingSchedulesForService(service.id),
              loadAppointmentsForService(service.id),
            ]);
            outgoingPayloads.push(
              buildBookingSlotsPayload({
                chatId,
                node: bkNode,
                service,
                serviceIdx: svcIdx,
                dayOffset,
                schedules,
                appointments,
                isEdit: true,
                editMessageId: callbackMessageId,
              })
            );
            callbackAnswerText = 'انتخاب ساعت';
          }
        } else if (action === 't') {
          const svcIdx = Number(parts[3] || 0);
          const dayOffset = Number(parts[4] || 0);
          const timeCode = parts[5] || '';
          const service = services[svcIdx];

          if (service) {
            const lockKey = `${botId}:${service.id}`;
            const outcome = await withBookingSlotLock(lockKey, async () => {
              const [schedules, latestAppointments] = await Promise.all([
                loadBookingSchedulesForService(service.id),
                loadAppointmentsForService(service.id),
              ]);
              const days = computeAvailableBookingDays({
                service,
                schedules,
                appointments: latestAppointments,
                daysAhead: Math.max(bkNode.bookingConfig?.daysAhead || 7, dayOffset + 1),
              });
              const day = days.find((d) => d.dayOffset === dayOffset);
              const chosenSlot = day?.slots.find((s) => s.timeCode === timeCode);

              if (!chosenSlot) {
                return {
                  booked: false as const,
                  schedules,
                  latestAppointments,
                };
              }

              // Double-check live capacity right before insert
              const slotMs = new Date(chosenSlot.isoAt).getTime();
              const currentCount = latestAppointments.filter((a) => {
                const ms = new Date(a.appointment_at).getTime();
                return !Number.isNaN(ms) && Math.abs(ms - slotMs) < 60 * 1000;
              }).length;

              if (currentCount >= Math.max(1, service.capacity_per_slot)) {
                return {
                  booked: false as const,
                  schedules,
                  latestAppointments,
                };
              }

              const apptStatus = bkNode.bookingConfig?.defaultStatus || 'confirmed';
              const customerPhone = contact?.phone || session.context_data.phone || null;
              let record: AppointmentRecord;

              if (canPersistBackend) {
                record = await createAppointmentAsAdmin({
                  bot_id: botId,
                  service_id: service.id,
                  contact_id: contact?.id || null,
                  bale_chat_id: chatId,
                  bale_user_name: userFullName,
                  customer_phone: customerPhone,
                  appointment_at: chosenSlot.isoAt,
                  jalali_date: chosenSlot.jalaliDateTime,
                  status: apptStatus,
                  reminder_sent: false,
                });
              } else {
                record = {
                  id: `sim_appt_${Date.now().toString(36)}`,
                  bot_id: botId,
                  service_id: service.id,
                  bale_chat_id: chatId,
                  bale_user_name: userFullName,
                  customer_phone: customerPhone,
                  appointment_at: chosenSlot.isoAt,
                  jalali_date: chosenSlot.jalaliDateTime,
                  status: apptStatus,
                  reminder_sent: false,
                  date_created: new Date().toISOString(),
                };
              }

              return {
                booked: true as const,
                record,
                chosenSlot,
              };
            });

            if (!outcome.booked) {
              outgoingPayloads.push(
                buildBookingSlotsPayload({
                  chatId,
                  node: bkNode,
                  service,
                  serviceIdx: svcIdx,
                  dayOffset,
                  schedules: outcome.schedules,
                  appointments: outcome.latestAppointments,
                  noticePrefix: '⚠️ ظرفیت این ساعت هم‌اکنون تکمیل شد. لطفاً ساعت دیگری انتخاب کنید.',
                  isEdit: true,
                  editMessageId: callbackMessageId,
                })
              );
              callbackAnswerText = 'ظرفیت این ساعت پر شد';
            } else {
              createdAppointment = outcome.record;
              session.context_data.appointment_id = outcome.record.id;
              session.context_data.appointment_date = outcome.chosenSlot.jalaliDateTime;
              session.context_data.appointment_service = service.title;
              session.context_data.appointment_status = outcome.record.status;

              const confirmHeader = interpolateTemplate(
                bkNode.bookingConfig?.confirmText || '✅ نوبت شما با موفقیت ثبت شد!',
                session,
                userFirstName,
                contact
              );
              const receiptText = [
                confirmHeader,
                `کد پیگیری: ${outcome.record.id.slice(0, 8)}`,
                `خدمت: ${service.title}`,
                `زمان: ${outcome.chosenSlot.jalaliDateTime}`,
              ].join('\n');

              outgoingPayloads.push({
                chat_id: chatId,
                text: receiptText,
              });
              callbackAnswerText = 'نوبت ثبت شد';

              if (bkNode.nextNodeId && nodeMap.has(bkNode.nextNodeId)) {
                targetNode = nodeMap.get(bkNode.nextNodeId);
              }
            }
          }
        }

        if (!targetNode) {
          session = await persistSession(session, { persistToBackend: !dryRun });
          if (!dryRun && botToken) {
            if (update.callback_query?.id) {
              await answerBaleCallbackQuery(botToken, update.callback_query.id, callbackAnswerText);
            }
            for (const payload of outgoingPayloads) {
              await dispatchBaleOutgoingPayload(botToken, payload);
            }
          }
          return {
            matchedNodeId: bkNode.id,
            outgoingPayloads,
            callbackAnswerText,
            createdAppointment,
            contactTags: parseSessionTags(session),
            session,
          };
        }
      }
    }
    // 2E. Appointment reminder confirmation/cancellation ("appt:ok:<id>" | "appt:no:<id>")
    else if (data.startsWith('appt:')) {
      const [, action, apptId] = data.split(':');
      if (apptId) {
        const nextStatus = action === 'no' ? 'cancelled' : 'confirmed';
        if (canPersistBackend) {
          const existing = await getAppointmentAsAdmin(apptId);
          if (existing && existing.bot_id === botId) {
            await updateAppointmentAsAdmin(apptId, { status: nextStatus });
          }
        }
        const replyText =
          nextStatus === 'confirmed'
            ? '✅ حضور شما با موفقیت تایید شد. منتظر دیدار شما هستیم.'
            : '❌ نوبت شما لغو شد و ساعت آن برای سایر مراجعین آزاد گردید.';
        outgoingPayloads.push({
          chat_id: chatId,
          text: replyText,
          is_edit: true,
          edit_message_id: callbackMessageId,
        });
        callbackAnswerText = nextStatus === 'confirmed' ? 'حضور تایید شد' : 'نوبت لغو شد';

        session = await persistSession(session, { persistToBackend: !dryRun });
        if (!dryRun && botToken) {
          if (update.callback_query?.id) {
            await answerBaleCallbackQuery(botToken, update.callback_query.id, callbackAnswerText);
          }
          for (const payload of outgoingPayloads) {
            await dispatchBaleOutgoingPayload(botToken, payload);
          }
        }
        return {
          matchedNodeId: null,
          outgoingPayloads,
          callbackAnswerText,
          contactTags: parseSessionTags(session),
          session,
        };
      }
    }
  }

  // 3. Handle awaiting open-text survey question OR standard form question
  if (!targetNode && !isCallback && session.awaiting_field_key && session.current_node_id) {
    if (session.awaiting_field_key.startsWith('__survey_text:')) {
      const [, srvNodeId, qIdxStr] = session.awaiting_field_key.split(':');
      const srvNode = nodeMap.get(srvNodeId);
      const qIdx = Number(qIdxStr || 0);
      if (srvNode && srvNode.type === 'survey_node' && incomingText.trim()) {
        const linked = await loadSurveyById(srvNode.surveyConfig?.surveyId);
        const def = resolveSurveyDefinition(srvNode, linked);
        const answers = parseSurveyAnswers(session);
        const q = def.questions[qIdx];
        if (q) {
          answers[q.text] = incomingText.trim();
          saveSurveyAnswers(session, answers);
        }
        session.awaiting_field_key = null;

        const nextStep = qIdx + 1;
        if (nextStep < def.questions.length) {
          session.context_data.__survey_step = String(nextStep);
          outgoingPayloads.push(
            buildSurveyQuestionPayload({
              chatId,
              node: srvNode,
              surveyTitle: def.title,
              question: def.questions[nextStep],
              stepIdx: nextStep,
              totalSteps: def.questions.length,
              isSimpleRating: false,
              session,
              userFirstName,
              contact,
            })
          );
          session = await persistSession(session, { persistToBackend: !dryRun });
          if (!dryRun && botToken) {
            for (const payload of outgoingPayloads) {
              await dispatchBaleOutgoingPayload(botToken, payload);
            }
          }
          return {
            matchedNodeId: srvNode.id,
            outgoingPayloads,
            contactTags: parseSessionTags(session),
            session,
          };
        }

        const numericScores = def.questions
          .filter((item) => item.type === 'rating')
          .map((item) => Number(answers[item.text]))
          .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 5);
        const avgScore =
          numericScores.length > 0
            ? Math.round(numericScores.reduce((a, b) => a + b, 0) / numericScores.length)
            : null;
        await finalizeSurveyAndAdvance({
          surveyNode: srvNode,
          surveyId: def.surveyId,
          answers,
          numericScore: avgScore,
        });
      }
    } else {
      const currentNode = nodeMap.get(session.current_node_id);
      if (currentNode && currentNode.type === 'question') {
        const check = validateUserInput(currentNode, incomingText, Boolean(sharedPhone));
        if (!check.valid) {
          const errorMsg =
            currentNode.validationErrorText || 'ورودی نامعتبر است. لطفاً مجدداً تلاش کنید.';
          outgoingPayloads.push({
            chat_id: chatId,
            text: errorMsg,
            reply_markup: buildQuestionMarkup(currentNode),
          });
          session = await persistSession(session, { persistToBackend: !dryRun });
          if (!dryRun && botToken) {
            for (const payload of outgoingPayloads) {
              await dispatchBaleOutgoingPayload(botToken, payload);
            }
          }
          return {
            matchedNodeId: currentNode.id,
            outgoingPayloads,
            contactTags: parseSessionTags(session),
            session,
          };
        }

        session.context_data[session.awaiting_field_key] = check.cleaned;
        if (currentNode.inputType === 'phone' && canPersistBackend) {
          try {
            contact = await upsertBotContactAsAdmin({
              bot_id: botId,
              bale_user_id: userId,
              bale_chat_id: chatId,
              phone: check.cleaned,
            });
          } catch (err) {
            console.warn('bot_contacts phone sync skipped:', err instanceof Error ? err.message : err);
          }
        }
        if (currentNode.inputType === 'phone' && currentNode.requestContact) {
          shouldRemoveReplyKeyboard = true;
        }

        session.awaiting_field_key = null;
        if (currentNode.nextNodeId) {
          targetNode = nodeMap.get(currentNode.nextNodeId);
        }
      }
    }
  }

  // 4. Fallback if nothing matched
  if (!targetNode) {
    outgoingPayloads.push({
      chat_id: chatId,
      text: flow.fallbackText || 'برای شروع دستور /start را ارسال کنید.',
    });
    session = await persistSession(session, { persistToBackend: !dryRun });
    if (!dryRun && botToken) {
      if (isCallback && update.callback_query?.id) {
        await answerBaleCallbackQuery(botToken, update.callback_query.id);
      }
      for (const payload of outgoingPayloads) {
        await dispatchBaleOutgoingPayload(botToken, payload);
      }
    }
    return {
      matchedNodeId: null,
      outgoingPayloads,
      createdOrder,
      createdSurveyResponse,
      contactTags: parseSessionTags(session),
      session,
    };
  }

  // 5. Traverse deterministic nodes (guard against cycles with max 14 hops)
  let current: FlowNode | undefined = targetNode;
  let lastMatchedId: string | null = targetNode.id;
  let hops = 0;

  while (current && hops < 14) {
    hops += 1;
    lastMatchedId = current.id;
    session.current_node_id = current.id;

    if (current.type === 'trigger') {
      current = current.nextNodeId ? nodeMap.get(current.nextNodeId) : undefined;
      continue;
    }

    if (current.type === 'condition') {
      const branchId = evaluateCondition(current, session, incomingText, contact);
      current = branchId ? nodeMap.get(branchId) : undefined;
      continue;
    }

    if (current.type === 'tag_contact') {
      const action = current.tagConfig?.action || 'add';
      const targetTags = (current.tagConfig?.tags || []).map((t) => t.trim()).filter(Boolean);
      const currentTags = new Set(contact?.tags || parseSessionTags(session));

      for (const tag of targetTags) {
        if (action === 'add') currentTags.add(tag);
        else currentTags.delete(tag);
      }
      const nextTags = Array.from(currentTags);
      saveSessionTags(session, nextTags);

      if (canPersistBackend) {
        try {
          contact = await upsertBotContactAsAdmin({
            bot_id: botId,
            bale_user_id: userId,
            bale_chat_id: chatId,
            tags: nextTags,
          });
        } catch (err) {
          console.warn('bot_contacts tag sync skipped:', err instanceof Error ? err.message : err);
        }
      } else if (contact) {
        contact.tags = nextTags;
      }

      current = current.nextNodeId ? nodeMap.get(current.nextNodeId) : undefined;
      continue;
    }

    if (current.type === 'update_contact') {
      const mappings = current.contactFieldMappings || [];
      const customUpdates: Record<string, string> = {};
      let nextFirstName: string | undefined;
      let nextLastName: string | undefined;
      let nextPhone: string | undefined;

      for (const mapItem of mappings) {
        const val = session.context_data[mapItem.sessionKey];
        if (!val) continue;
        if (mapItem.targetField === 'first_name') nextFirstName = val;
        else if (mapItem.targetField === 'last_name') nextLastName = val;
        else if (mapItem.targetField === 'phone') nextPhone = normalizeIranPhone(val);
        else if (mapItem.targetField === 'custom') {
          customUpdates[mapItem.customKey || mapItem.sessionKey] = val;
        }
      }

      if (canPersistBackend) {
        try {
          contact = await upsertBotContactAsAdmin({
            bot_id: botId,
            bale_user_id: userId,
            bale_chat_id: chatId,
            first_name: nextFirstName,
            last_name: nextLastName,
            phone: nextPhone,
            custom_fields: Object.keys(customUpdates).length > 0 ? customUpdates : undefined,
          });
        } catch (err) {
          console.warn('bot_contacts update skipped:', err instanceof Error ? err.message : err);
        }
      }

      current = current.nextNodeId ? nodeMap.get(current.nextNodeId) : undefined;
      continue;
    }

    if (current.type === 'catalog_browser') {
      const products = await loadProductsForBot();
      const initialCategory = current.catalogConfig?.categoryFilter || 'all';
      session.context_data.__catalog_cat = initialCategory;
      session.context_data.__catalog_idx = '0';

      if (current.messageText?.trim()) {
        outgoingPayloads.push({
          chat_id: chatId,
          text: interpolateTemplate(current.messageText, session, userFirstName, contact),
          reply_markup: shouldRemoveReplyKeyboard ? { remove_keyboard: true } : undefined,
        });
        shouldRemoveReplyKeyboard = false;
      }

      outgoingPayloads.push(
        buildCatalogProductPayload({
          chatId,
          node: current,
          allProducts: products,
          session,
          index: 0,
          selectedCategory: initialCategory,
        })
      );

      current = undefined;
      continue;
    }

    if (current.type === 'survey_node') {
      const linked = await loadSurveyById(current.surveyConfig?.surveyId);
      const def = resolveSurveyDefinition(current, linked);

      if (def.surveyId && !def.allowMultiple && canPersistBackend) {
        const alreadyAnswered = await hasContactAnsweredSurveyAsAdmin(botId, def.surveyId, chatId);
        if (alreadyAnswered) {
          outgoingPayloads.push({
            chat_id: chatId,
            text: 'شما قبلاً در این نظرسنجی شرکت کرده‌اید. سپاسگزاریم!',
          });
          current = current.nextNodeId ? nodeMap.get(current.nextNodeId) : undefined;
          continue;
        }
      }

      session.context_data.__survey_step = '0';
      saveSurveyAnswers(session, {});
      const isSimpleRating = def.type === 'rating' && def.questions.length <= 1;

      outgoingPayloads.push(
        buildSurveyQuestionPayload({
          chatId,
          node: current,
          surveyTitle: def.title,
          question: def.questions[0],
          stepIdx: 0,
          totalSteps: def.questions.length,
          isSimpleRating,
          session,
          userFirstName,
          contact,
        })
      );

      current = undefined;
      continue;
    }

    if (current.type === 'booking_node') {
      const services = await loadBookingServicesForBot();
      const pinnedServiceId = current.bookingConfig?.serviceId;

      if (pinnedServiceId) {
        const pinnedIdx = services.findIndex((s) => s.id === pinnedServiceId);
        const pinnedService = pinnedIdx >= 0 ? services[pinnedIdx] : undefined;
        if (pinnedService) {
          const [schedules, appointments] = await Promise.all([
            loadBookingSchedulesForService(pinnedService.id),
            loadAppointmentsForService(pinnedService.id),
          ]);
          outgoingPayloads.push(
            buildBookingDaysPayload({
              chatId,
              node: current,
              service: pinnedService,
              serviceIdx: pinnedIdx,
              totalServices: services.length,
              schedules,
              appointments,
            })
          );
          current = undefined;
          continue;
        }
      }

      if (services.length === 1) {
        const onlySvc = services[0];
        const [schedules, appointments] = await Promise.all([
          loadBookingSchedulesForService(onlySvc.id),
          loadAppointmentsForService(onlySvc.id),
        ]);
        outgoingPayloads.push(
          buildBookingDaysPayload({
            chatId,
            node: current,
            service: onlySvc,
            serviceIdx: 0,
            totalServices: 1,
            schedules,
            appointments,
          })
        );
      } else {
        outgoingPayloads.push(
          buildBookingServicesPayload({
            chatId,
            node: current,
            services,
            session,
            userFirstName,
            contact,
          })
        );
      }

      current = undefined;
      continue;
    }

    if (current.type === 'message') {
      const text = interpolateTemplate(current.messageText || '', session, userFirstName, contact);
      if (text) {
        const inline = buildInlineMarkup(current);
        outgoingPayloads.push({
          chat_id: chatId,
          text,
          reply_markup: inline || (shouldRemoveReplyKeyboard ? { remove_keyboard: true } : undefined),
        });
        shouldRemoveReplyKeyboard = false;
      }
      if (current.inlineButtons && current.inlineButtons.length > 0) {
        current = undefined;
      } else {
        current = current.nextNodeId ? nodeMap.get(current.nextNodeId) : undefined;
      }
      continue;
    }

    if (current.type === 'question') {
      const promptText = interpolateTemplate(
        current.messageText || '',
        session,
        userFirstName,
        contact
      );
      session.awaiting_field_key = current.fieldKey || current.id;
      const markup = buildQuestionMarkup(current);
      outgoingPayloads.push({
        chat_id: chatId,
        text: promptText,
        reply_markup: markup || (shouldRemoveReplyKeyboard ? { remove_keyboard: true } : undefined),
      });
      shouldRemoveReplyKeyboard = false;
      current = undefined;
      continue;
    }

    if (current.type === 'save_form') {
      savedFormPayload = buildPublicFormContext(session.context_data);
      if (canPersistBackend) {
        await createCollectedFormAsAdmin({
          bot_id: botId,
          flow_id: flowId || null,
          bale_chat_id: chatId,
          bale_user_id: userId,
          bale_user_name: userFullName,
          form_title: current.formTitle || current.title,
          payload: savedFormPayload,
        });

        try {
          const phoneCandidate = savedFormPayload.phone || savedFormPayload.mobile || undefined;
          contact = await upsertBotContactAsAdmin({
            bot_id: botId,
            bale_user_id: userId,
            bale_chat_id: chatId,
            phone: phoneCandidate ? normalizeIranPhone(phoneCandidate) : undefined,
            custom_fields: savedFormPayload,
          });
        } catch (err) {
          console.warn('bot_contacts save_form sync skipped:', err instanceof Error ? err.message : err);
        }
      }

      const confirmText = interpolateTemplate(
        current.messageText || 'اطلاعات شما با موفقیت ثبت شد.',
        session,
        userFirstName,
        contact
      );
      const inline = buildInlineMarkup(current);
      outgoingPayloads.push({
        chat_id: chatId,
        text: confirmText,
        reply_markup: inline || (shouldRemoveReplyKeyboard ? { remove_keyboard: true } : undefined),
      });
      shouldRemoveReplyKeyboard = false;
      session.awaiting_field_key = null;
      current = current.nextNodeId ? nodeMap.get(current.nextNodeId) : undefined;
      continue;
    }

    if (current.type === 'delay') {
      if (current.messageText) {
        const immediateText = interpolateTemplate(
          current.messageText,
          session,
          userFirstName,
          contact
        );
        if (immediateText) {
          outgoingPayloads.push({
            chat_id: chatId,
            text: immediateText,
            reply_markup: shouldRemoveReplyKeyboard ? { remove_keyboard: true } : undefined,
          });
          shouldRemoveReplyKeyboard = false;
        }
      }

      const delaySeconds = Math.max(1, Math.min(current.delayConfig?.delaySeconds || 10, 86400));
      const cancelIfReplied = Boolean(current.delayConfig?.cancelIfReplied);
      const followUpRaw = current.delayConfig?.followUpText || '';
      const followUpText = followUpRaw
        ? interpolateTemplate(followUpRaw, session, userFirstName, contact)
        : '';

      if (dryRun) {
        scheduledFollowUps.push({
          nodeId: current.id,
          delaySeconds,
          followUpText,
          nextNodeId: current.nextNodeId,
          cancelIfReplied,
        });
      } else if (botToken) {
        const scheduledAtMs = Date.now();
        const nextAfterDelay = current.nextNodeId;
        const timer = setTimeout(() => {
          void (async () => {
            try {
              if (cancelIfReplied) {
                const latestSession = await getOrInitSession({
                  botId,
                  chatId,
                  userId,
                  userName: userFullName,
                  persistToBackend: true,
                });
                const lastInteractionMs = Date.parse(latestSession.last_interaction_at || '');
                if (!Number.isNaN(lastInteractionMs) && lastInteractionMs > scheduledAtMs) {
                  return;
                }
              }
              if (followUpText) {
                await dispatchBaleOutgoingPayload(botToken, {
                  chat_id: chatId,
                  text: followUpText,
                });
              }
              if (nextAfterDelay) {
                await executeBotFlow({
                  botId,
                  flowId,
                  botToken,
                  flow,
                  update,
                  dryRun: false,
                  startAtNodeId: nextAfterDelay,
                });
              }
            } catch (err) {
              console.error('Delayed follow-up execution failed:', err);
            }
          })();
        }, delaySeconds * 1000);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      }

      current = undefined;
      continue;
    }

    current = undefined;
  }

  session = await persistSession(session, { persistToBackend: !dryRun });

  if (!dryRun && botToken) {
    if (!startAtNodeId && isCallback && update.callback_query?.id) {
      await answerBaleCallbackQuery(botToken, update.callback_query.id, callbackAnswerText);
    }
    for (const payload of outgoingPayloads) {
      await dispatchBaleOutgoingPayload(botToken, payload);
    }
  }

  return {
    matchedNodeId: lastMatchedId,
    outgoingPayloads,
    callbackAnswerText,
    savedFormPayload,
    createdOrder,
    createdSurveyResponse,
    createdAppointment,
    contactTags: parseSessionTags(session),
    scheduledFollowUps,
    session,
  };
}
