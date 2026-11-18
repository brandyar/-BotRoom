export type NodeType =
  | 'trigger'
  | 'message'
  | 'question'
  | 'condition'
  | 'delay'
  | 'save_form'
  | 'tag_contact'
  | 'update_contact'
  | 'catalog_browser'
  | 'survey_node'
  | 'booking_node';

export type QuestionInputType = 'text' | 'number' | 'phone' | 'email' | 'choice';

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'not_empty'
  | 'greater_than'
  | 'less_than';

export interface InlineButtonConfig {
  id: string;
  text: string;
  targetNodeId: string;
  url?: string;
}

export interface ContactFieldMapping {
  sessionKey: string;
  targetField: 'first_name' | 'last_name' | 'phone' | 'custom';
  customKey?: string;
}

export interface DelayNodeConfig {
  delaySeconds: number;
  followUpText?: string;
  cancelIfReplied?: boolean;
}

export interface CatalogNodeConfig {
  categoryFilter?: string;
  allowCart?: boolean;
  emptyText?: string;
  checkoutConfirmText?: string;
}

export interface SurveyQuestionItem {
  id: string;
  text: string;
  type: 'rating' | 'choice' | 'text';
  options?: string[];
}

export interface SurveyNodeConfig {
  surveyId?: string;
  surveyType: 'rating' | 'multi_choice';
  questionText?: string;
  questions?: SurveyQuestionItem[];
  lowScoreThreshold?: number;
  lowScoreNodeId?: string;
  thankYouText?: string;
}

export interface BookingNodeConfig {
  serviceId?: string;
  daysAhead?: number;
  introText?: string;
  confirmText?: string;
  emptySlotsText?: string;
  defaultStatus?: 'confirmed' | 'pending';
}

export interface FlowNode {
  id: string;
  type: NodeType;
  title: string;
  /** Command or text trigger for 'trigger' nodes (e.g., "/start", "شروع", "سفارش") */
  triggerPattern?: string;
  /** Message text sent to user (supports {{user.first_name}}, {{form.field}}, {{contact.phone}}) */
  messageText?: string;
  /** Inline keyboard rows for 'message' or 'question' (choice) nodes */
  inlineButtons?: InlineButtonConfig[];
  /** Field key stored in session.context_data for 'question' nodes */
  fieldKey?: string;
  /** Persian human-readable field label for form exports */
  fieldLabel?: string;
  /** Expected input type & validation for 'question' nodes */
  inputType?: QuestionInputType;
  /** Show Bale native ReplyKeyboard request_contact button for phone questions */
  requestContact?: boolean;
  /** Label for the request_contact button in Bale */
  requestContactButtonText?: string;
  /** Error message shown if validation fails */
  validationErrorText?: string;
  /** Next node ID for linear transitions */
  nextNodeId?: string;
  /** Condition configuration for 'condition' nodes */
  condition?: {
    sourceKey: string; // e.g., 'last_input', 'contact.tags', 'contact.custom.key', 'survey_score', or a form fieldKey
    operator: ConditionOperator;
    value: string;
    trueNodeId: string;
    falseNodeId: string;
  };
  /** Delay / scheduled follow-up configuration for 'delay' nodes */
  delayConfig?: DelayNodeConfig;
  /** Tag operation for 'tag_contact' nodes */
  tagConfig?: {
    action: 'add' | 'remove';
    tags: string[];
  };
  /** Field mappings for 'update_contact' nodes */
  contactFieldMappings?: ContactFieldMapping[];
  /** Catalog browser configuration for 'catalog_browser' nodes */
  catalogConfig?: CatalogNodeConfig;
  /** Survey configuration for 'survey_node' nodes */
  surveyConfig?: SurveyNodeConfig;
  /** Booking / appointment configuration for 'booking_node' nodes */
  bookingConfig?: BookingNodeConfig;
  /** Form title used when saving to collected_form_data */
  formTitle?: string;
  /** Optional layout coordinates for visual editor */
  position?: { x: number; y: number };
}

export interface FlowDefinition {
  startNodeId: string;
  fallbackText: string;
  nodes: FlowNode[];
}

export interface ScheduledFollowUpItem {
  nodeId: string;
  delaySeconds: number;
  followUpText: string;
  nextNodeId?: string;
  cancelIfReplied?: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: { id?: string; name?: string } | string | null;
}

export interface BotRecord {
  id: string;
  name: string;
  bale_username?: string | null;
  bot_token: string;
  webhook_secret: string;
  webhook_status: 'active' | 'inactive' | 'error';
  is_active: boolean;
  date_created?: string;
  date_updated?: string;
}

export interface BotFlowRecord {
  id: string;
  bot_id: string;
  name: string;
  version: number;
  is_published: boolean;
  flow_json: FlowDefinition;
  date_created?: string;
  date_updated?: string;
}

export interface BotContactRecord {
  id: string;
  bot_id: string;
  bale_user_id: string;
  bale_chat_id: string;
  first_name?: string | null;
  last_name?: string | null;
  bale_username?: string | null;
  phone?: string | null;
  tags: string[];
  custom_fields: Record<string, string>;
  is_blocked: boolean;
  last_interaction_at?: string | null;
  date_created?: string;
  date_updated?: string;
}

export interface ProductRecord {
  id: string;
  bot_id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  price: number;
  stock: number;
  image_url?: string | null;
  is_active: boolean;
  date_created?: string;
  date_updated?: string;
}

export interface OrderCartItem {
  product_id: string;
  title: string;
  price: number;
  quantity: number;
}

export type OrderStatus = 'pending' | 'confirmed' | 'cancelled';

export interface BotOrderRecord {
  id: string;
  bot_id: string;
  contact_id?: string | number | null;
  bale_user_id?: string | null;
  bale_chat_id?: string | null;
  bale_user_name?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  items: OrderCartItem[];
  total_amount: number;
  status: OrderStatus;
  note?: string | null;
  date_created?: string;
  date_updated?: string;
}

export interface SurveyRecord {
  id: string;
  bot_id: string;
  title: string;
  type: 'rating' | 'multi_choice';
  questions_json: SurveyQuestionItem[];
  allow_multiple: boolean;
  date_created?: string;
  date_updated?: string;
}

export interface SurveyResponseRecord {
  id: string;
  survey_id?: string | null;
  bot_id: string;
  contact_id?: string | number | null;
  bale_user_id?: string | null;
  bale_user_name?: string | null;
  answers_json: Record<string, string>;
  score?: number | null;
  date_created?: string;
}

// ---------------- Phase 4: Booking & Broadcast Types ----------------

export interface BookingServiceRecord {
  id: string;
  bot_id: string;
  title: string;
  description?: string | null;
  duration_minutes: number;
  capacity_per_slot: number;
  price: number;
  is_active: boolean;
  date_created?: string;
  date_updated?: string;
}

export interface BookingScheduleRecord {
  id: string;
  bot_id: string;
  service_id: string;
  /** 0 = شنبه ... 6 = جمعه */
  weekday: number;
  start_time: string;
  end_time: string;
  blocked_dates: string[];
  is_active: boolean;
  date_created?: string;
  date_updated?: string;
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled';

export interface AppointmentRecord {
  id: string;
  bot_id: string;
  service_id: string;
  contact_id?: string | number | null;
  bale_chat_id: string;
  bale_user_name?: string | null;
  customer_phone?: string | null;
  appointment_at: string;
  jalali_date: string;
  status: AppointmentStatus;
  reminder_sent: boolean;
  note?: string | null;
  date_created?: string;
  date_updated?: string;
}

export interface AvailableBookingSlot {
  isoAt: string;
  timeCode: string;
  timeLabel: string;
  jalaliDateTime: string;
  remainingCapacity: number;
  totalCapacity: number;
}

export interface AvailableBookingDay {
  dayOffset: number;
  isoDate: string;
  jalaliDateSlash: string;
  shortLabel: string;
  weekdayLabel: string;
  slots: AvailableBookingSlot[];
}

export type BroadcastCampaignStatus = 'draft' | 'queued' | 'sending' | 'completed' | 'failed';

export interface BroadcastCampaignRecord {
  id: string;
  bot_id: string;
  title: string;
  message_text: string;
  media_url?: string | null;
  target_tags: string[];
  status: BroadcastCampaignStatus;
  total_count: number;
  sent_count: number;
  failed_count: number;
  scheduled_at?: string | null;
  date_created?: string;
  date_updated?: string;
}

export interface BotSessionRecord {
  id?: string;
  bot_id: string;
  bale_chat_id: string;
  bale_user_id: string;
  bale_user_name?: string | null;
  current_node_id?: string | null;
  awaiting_field_key?: string | null;
  context_data: Record<string, string>;
  last_interaction_at: string;
}

export interface CollectedFormRecord {
  id: string;
  bot_id: string;
  flow_id?: string | null;
  bale_chat_id: string;
  bale_user_id: string;
  bale_user_name?: string | null;
  form_title?: string | null;
  payload: Record<string, string>;
  date_created: string;
}

export interface WebhookLogRecord {
  id: string;
  bot_id: string;
  update_id?: string | null;
  event_type: 'message' | 'callback_query' | 'error' | 'system';
  bale_chat_id?: string | null;
  incoming_text?: string | null;
  matched_node_id?: string | null;
  status: 'queued' | 'processed' | 'failed';
  latency_ms?: number | null;
  error_message?: string | null;
  date_created: string;
}

export interface BaleInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface BaleInlineKeyboardMarkup {
  inline_keyboard: BaleInlineKeyboardButton[][];
}

export interface BaleReplyKeyboardButton {
  text: string;
  request_contact?: boolean;
}

export interface BaleReplyKeyboardMarkup {
  keyboard: BaleReplyKeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
}

export interface BaleReplyKeyboardRemove {
  remove_keyboard: true;
}

export type BaleReplyMarkup =
  | BaleInlineKeyboardMarkup
  | BaleReplyKeyboardMarkup
  | BaleReplyKeyboardRemove;

export interface BaleSendMessagePayload {
  chat_id: number | string;
  text: string;
  reply_markup?: BaleReplyMarkup;
  reply_to_message_id?: number;
  photo_url?: string;
  is_edit?: boolean;
  edit_message_id?: number;
  has_source_photo?: boolean;
}

export interface BaleUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot?: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
      first_name?: string;
    };
    date: number;
    text?: string;
    contact?: {
      phone_number: string;
      first_name: string;
      user_id?: number;
    };
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    message?: {
      message_id: number;
      chat: {
        id: number;
      };
      text?: string;
      caption?: string;
      photo?: unknown[];
    };
    data?: string;
  };
}
