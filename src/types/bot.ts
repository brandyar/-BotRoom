export type NodeType = 'trigger' | 'message' | 'question' | 'condition' | 'save_form';

export type QuestionInputType = 'text' | 'number' | 'phone' | 'email' | 'choice';

export interface InlineButtonConfig {
  id: string;
  text: string;
  targetNodeId: string;
  url?: string;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  title: string;
  /** Command or text trigger for 'trigger' nodes (e.g., "/start", "شروع", "سفارش") */
  triggerPattern?: string;
  /** Message text sent to user (supports {{user.first_name}}, {{form.field}}) */
  messageText?: string;
  /** Inline keyboard rows for 'message' or 'question' (choice) nodes */
  inlineButtons?: InlineButtonConfig[];
  /** Field key stored in session.context_data for 'question' nodes */
  fieldKey?: string;
  /** Persian human-readable field label for form exports */
  fieldLabel?: string;
  /** Expected input type & validation for 'question' nodes */
  inputType?: QuestionInputType;
  /** Error message shown if validation fails */
  validationErrorText?: string;
  /** Next node ID for linear transitions ('trigger', 'message', 'question', 'save_form') */
  nextNodeId?: string;
  /** Condition configuration for 'condition' nodes */
  condition?: {
    sourceKey: string; // e.g., 'last_input' or a form fieldKey
    operator: 'equals' | 'contains' | 'not_empty';
    value: string;
    trueNodeId: string;
    falseNodeId: string;
  };
  /** Form title used when saving to Directus collected_form_data */
  formTitle?: string;
  /** Optional layout coordinates for visual editor */
  position?: { x: number; y: number };
}

export interface FlowDefinition {
  startNodeId: string;
  fallbackText: string;
  nodes: FlowNode[];
}

export interface DirectusUser {
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

export interface BaleSendMessagePayload {
  chat_id: number | string;
  text: string;
  reply_markup?: BaleInlineKeyboardMarkup;
  reply_to_message_id?: number;
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
    };
    data?: string;
  };
}
