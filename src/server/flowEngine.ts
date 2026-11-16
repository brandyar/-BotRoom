import type {
  BaleInlineKeyboardButton,
  BaleInlineKeyboardMarkup,
  BaleSendMessagePayload,
  BaleUpdate,
  BotSessionRecord,
  FlowDefinition,
  FlowNode,
} from '../types/bot.ts';
import { normalizePersianText } from '../utils/jalali.ts';
import { answerBaleCallbackQuery, sendBaleMessage } from './baleApi.ts';
import { createCollectedFormAsAdmin, getDirectusConfig } from './directus.ts';
import { getOrInitSession, persistSession } from './sessionStore.ts';

export interface FlowExecutionResult {
  matchedNodeId: string | null;
  outgoingPayloads: BaleSendMessagePayload[];
  callbackAnswerText?: string;
  savedFormPayload?: Record<string, string> | null;
  session: BotSessionRecord;
}

function interpolateTemplate(
  template: string,
  session: BotSessionRecord,
  userFirstName: string
): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, rawPath: string) => {
    const path = rawPath.trim();
    if (path === 'user.first_name') {
      return userFirstName || 'کاربر گرامی';
    }
    if (path === 'user.id') {
      return session.bale_user_id;
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

  // Group into clean 1-button-per-row layout for crisp Persian label readability on mobile Bale screens
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

function validateUserInput(node: FlowNode, rawInput: string): { valid: boolean; cleaned: string } {
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
      const digitsOnly = normalized.replace(/[\s-]/g, '');
      const valid = /^(09\d{9}|\+989\d{9}|989\d{9})$/.test(digitsOnly);
      return { valid, cleaned: digitsOnly };
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

function evaluateCondition(node: FlowNode, session: BotSessionRecord, lastInput: string): string | undefined {
  if (!node.condition) return undefined;
  const { sourceKey, operator, value, trueNodeId, falseNodeId } = node.condition;
  const rawCandidate =
    sourceKey === 'last_input' ? lastInput : session.context_data[sourceKey] ?? '';
  const candidate = normalizePersianText(rawCandidate).toLowerCase();
  const expected = normalizePersianText(value).toLowerCase();

  let matched = false;
  if (operator === 'equals') matched = candidate === expected;
  else if (operator === 'contains') matched = candidate.includes(expected);
  else if (operator === 'not_empty') matched = candidate.length > 0;

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

export async function executeBotFlow(params: {
  botId: string;
  flowId?: string | null;
  botToken?: string;
  flow: FlowDefinition;
  update: BaleUpdate;
  dryRun?: boolean;
}): Promise<FlowExecutionResult> {
  const { botId, flowId, botToken, flow, update, dryRun = false } = params;

  const isCallback = Boolean(update.callback_query);
  const message = update.message || update.callback_query?.message;
  const from = update.callback_query?.from || update.message?.from;
  const chatId = String(message?.chat.id || from?.id || '0');
  const userId = String(from?.id || chatId);
  const userFirstName = from?.first_name || 'کاربر';
  const userFullName = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || userFirstName;

  const incomingText = isCallback
    ? ''
    : update.message?.contact?.phone_number || update.message?.text || '';

  let session = await getOrInitSession({
    botId,
    chatId,
    userId,
    userName: userFullName,
    persistToDirectus: !dryRun,
  });

  const nodeMap = new Map<string, FlowNode>(flow.nodes.map((n) => [n.id, n]));
  const outgoingPayloads: BaleSendMessagePayload[] = [];
  let savedFormPayload: Record<string, string> | null = null;
  let callbackAnswerText: string | undefined;
  let targetNode: FlowNode | undefined;

  // 1. Check if incoming text matches a global command/trigger (e.g., /start resets state)
  if (!isCallback && incomingText) {
    const matchedTrigger = findMatchingTriggerNode(flow, incomingText);
    if (matchedTrigger) {
      if (normalizePersianText(incomingText).toLowerCase() === '/start') {
        session.context_data = {};
        session.awaiting_field_key = null;
      }
      targetNode = matchedTrigger;
    }
  }

  // 2. Handle inline button callback_query ("node:<targetNodeId>:<buttonId>")
  if (!targetNode && isCallback && update.callback_query?.data) {
    const data = update.callback_query.data;
    if (data.startsWith('node:')) {
      const [, nextId, buttonId] = data.split(':');
      // If the user was on a 'choice' question node, store the clicked button text as the answer!
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
  }

  // 3. Handle awaiting question answer
  if (!targetNode && !isCallback && session.awaiting_field_key && session.current_node_id) {
    const currentNode = nodeMap.get(session.current_node_id);
    if (currentNode && currentNode.type === 'question') {
      const check = validateUserInput(currentNode, incomingText);
      if (!check.valid) {
        const errorMsg = currentNode.validationErrorText || 'ورودی نامعتبر است. لطفاً مجدداً تلاش کنید.';
        outgoingPayloads.push({
          chat_id: chatId,
          text: errorMsg,
          reply_markup: buildInlineMarkup(currentNode),
        });
        session = await persistSession(session, { persistToDirectus: !dryRun });
        if (!dryRun && botToken) {
          for (const payload of outgoingPayloads) {
            await sendBaleMessage(botToken, payload);
          }
        }
        return {
          matchedNodeId: currentNode.id,
          outgoingPayloads,
          session,
        };
      }

      session.context_data[session.awaiting_field_key] = check.cleaned;
      session.awaiting_field_key = null;
      if (currentNode.nextNodeId) {
        targetNode = nodeMap.get(currentNode.nextNodeId);
      }
    }
  }

  // 4. Fallback if nothing matched
  if (!targetNode) {
    outgoingPayloads.push({
      chat_id: chatId,
      text: flow.fallbackText || 'برای شروع دستور /start را ارسال کنید.',
    });
    session = await persistSession(session, { persistToDirectus: !dryRun });
    if (!dryRun && botToken) {
      if (isCallback && update.callback_query?.id) {
        await answerBaleCallbackQuery(botToken, update.callback_query.id);
      }
      for (const payload of outgoingPayloads) {
        await sendBaleMessage(botToken, payload);
      }
    }
    return {
      matchedNodeId: null,
      outgoingPayloads,
      session,
    };
  }

  // 5. Traverse deterministic nodes (guard against cycles with max 10 hops)
  let current: FlowNode | undefined = targetNode;
  let lastMatchedId: string | null = targetNode.id;
  let hops = 0;

  while (current && hops < 10) {
    hops += 1;
    lastMatchedId = current.id;
    session.current_node_id = current.id;

    if (current.type === 'trigger') {
      current = current.nextNodeId ? nodeMap.get(current.nextNodeId) : undefined;
      continue;
    }

    if (current.type === 'condition') {
      const branchId = evaluateCondition(current, session, incomingText);
      current = branchId ? nodeMap.get(branchId) : undefined;
      continue;
    }

    if (current.type === 'message') {
      const text = interpolateTemplate(current.messageText || '', session, userFirstName);
      if (text) {
        outgoingPayloads.push({
          chat_id: chatId,
          text,
          reply_markup: buildInlineMarkup(current),
        });
      }
      // If message has inline buttons, pause and wait for user click; otherwise continue if nextNodeId exists
      if (current.inlineButtons && current.inlineButtons.length > 0) {
        current = undefined;
      } else {
        current = current.nextNodeId ? nodeMap.get(current.nextNodeId) : undefined;
      }
      continue;
    }

    if (current.type === 'question') {
      const promptText = interpolateTemplate(current.messageText || '', session, userFirstName);
      session.awaiting_field_key = current.fieldKey || current.id;
      outgoingPayloads.push({
        chat_id: chatId,
        text: promptText,
        reply_markup: buildInlineMarkup(current),
      });
      // Pause execution to wait for user's reply
      current = undefined;
      continue;
    }

    if (current.type === 'save_form') {
      savedFormPayload = { ...session.context_data };
      const { isConfigured, hasAdminToken } = getDirectusConfig();
      if (!dryRun && isConfigured && hasAdminToken) {
        await createCollectedFormAsAdmin({
          bot_id: botId,
          flow_id: flowId || null,
          bale_chat_id: chatId,
          bale_user_id: userId,
          bale_user_name: userFullName,
          form_title: current.formTitle || current.title,
          payload: savedFormPayload,
        });
      }

      const confirmText = interpolateTemplate(
        current.messageText || 'اطلاعات شما با موفقیت ثبت شد.',
        session,
        userFirstName
      );
      outgoingPayloads.push({
        chat_id: chatId,
        text: confirmText,
        reply_markup: buildInlineMarkup(current),
      });
      session.awaiting_field_key = null;
      current = current.nextNodeId ? nodeMap.get(current.nextNodeId) : undefined;
      continue;
    }

    current = undefined;
  }

  session = await persistSession(session, { persistToDirectus: !dryRun });

  if (!dryRun && botToken) {
    if (isCallback && update.callback_query?.id) {
      await answerBaleCallbackQuery(botToken, update.callback_query.id, callbackAnswerText);
    }
    for (const payload of outgoingPayloads) {
      await sendBaleMessage(botToken, payload);
    }
  }

  return {
    matchedNodeId: lastMatchedId,
    outgoingPayloads,
    callbackAnswerText,
    savedFormPayload,
    session,
  };
}
