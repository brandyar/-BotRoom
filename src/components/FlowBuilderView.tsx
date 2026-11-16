import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  Code2,
  GitBranch,
  HelpCircle,
  MessageSquare,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  Trash2,
  Zap,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type {
  BaleInlineKeyboardMarkup,
  FlowDefinition,
  FlowNode,
  InlineButtonConfig,
  NodeType,
  QuestionInputType,
} from '../types/bot.ts';
import { toPersianDigits } from '../utils/jalali.ts';

interface FlowBuilderViewProps {
  token: string | null;
  botId: string | null;
  flowId?: string | null;
  flowName: string;
  flow: FlowDefinition;
  saving: boolean;
  onChangeFlow: (next: FlowDefinition) => void;
  onSaveFlow: () => Promise<void>;
}

interface SimMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  replyMarkup?: BaleInlineKeyboardMarkup;
}

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  trigger: 'دستور شروع / ماشه',
  message: 'ارسال پیام و دکمه',
  question: 'دریافت ورودی (فیلد فرم)',
  condition: 'شرط و انشعاب',
  save_form: 'ثبت نهایی فرم',
};

function getNodeIcon(type: NodeType) {
  switch (type) {
    case 'trigger':
      return <Zap className="w-3.5 h-3.5 text-amber-600" />;
    case 'message':
      return <MessageSquare className="w-3.5 h-3.5 text-emerald-700" />;
    case 'question':
      return <HelpCircle className="w-3.5 h-3.5 text-sky-700" />;
    case 'condition':
      return <GitBranch className="w-3.5 h-3.5 text-slate-700" />;
    case 'save_form':
      return <Save className="w-3.5 h-3.5 text-emerald-700" />;
  }
}

export function FlowBuilderView({
  token,
  botId,
  flowName,
  flow,
  saving,
  onChangeFlow,
  onSaveFlow,
}: FlowBuilderViewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    flow.startNodeId || flow.nodes[0]?.id || ''
  );
  const [rightPanelMode, setRightPanelMode] = useState<'inspector' | 'simulator' | 'json'>(
    'inspector'
  );

  // Simulator state
  const [simMessages, setSimMessages] = useState<SimMessage[]>([]);
  const [simInput, setSimInput] = useState('');
  const [simContext, setSimContext] = useState<Record<string, string>>({});
  const [simSending, setSimSending] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  // JSON editor state
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => flow.nodes.find((n) => n.id === selectedNodeId) || flow.nodes[0] || null,
    [flow.nodes, selectedNodeId]
  );

  const nodeTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of flow.nodes) {
      map.set(node.id, node.title);
    }
    return map;
  }, [flow.nodes]);

  const questionFields = useMemo(
    () =>
      flow.nodes
        .filter((n) => n.type === 'question' && n.fieldKey)
        .map((n) => ({ key: n.fieldKey!, label: n.fieldLabel || n.fieldKey! })),
    [flow.nodes]
  );

  function updateNode(nodeId: string, patch: Partial<FlowNode>) {
    const nextNodes = flow.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n));
    onChangeFlow({ ...flow, nodes: nextNodes });
  }

  function addNode(type: NodeType) {
    const id = `node_${Date.now().toString(36)}`;
    const defaults: Record<NodeType, Partial<FlowNode>> = {
      trigger: {
        title: 'دستور جدید',
        triggerPattern: '/help',
        nextNodeId: flow.nodes[1]?.id || '',
      },
      message: {
        title: 'پیام جدید',
        messageText: 'متن پیام پاسخ بازو را اینجا بنویسید...',
        inlineButtons: [],
      },
      question: {
        title: 'سوال فرم جدید',
        messageText: 'لطفاً مقدار مورد نظر را وارد کنید:',
        fieldKey: `field_${flow.nodes.length + 1}`,
        fieldLabel: 'فیلد جدید',
        inputType: 'text',
        validationErrorText: 'ورودی نامعتبر است.',
      },
      condition: {
        title: 'بررسی شرط',
        condition: {
          sourceKey: 'last_input',
          operator: 'contains',
          value: 'بله',
          trueNodeId: '',
          falseNodeId: '',
        },
      },
      save_form: {
        title: 'ثبت نهایی اطلاعات',
        formTitle: 'فرم جدید',
        messageText: 'اطلاعات شما با موفقیت ثبت شد.',
      },
    };

    const newNode: FlowNode = {
      id,
      type,
      title: defaults[type].title || 'گره جدید',
      ...defaults[type],
    };

    onChangeFlow({
      ...flow,
      nodes: [...flow.nodes, newNode],
    });
    setSelectedNodeId(id);
    setRightPanelMode('inspector');
  }

  function deleteNode(nodeId: string) {
    if (flow.nodes.length <= 1) return;
    const filtered = flow.nodes
      .filter((n) => n.id !== nodeId)
      .map((n) => ({
        ...n,
        nextNodeId: n.nextNodeId === nodeId ? '' : n.nextNodeId,
        inlineButtons: n.inlineButtons?.map((b) =>
          b.targetNodeId === nodeId ? { ...b, targetNodeId: '' } : b
        ),
      }));

    const nextStart =
      flow.startNodeId === nodeId ? filtered[0]?.id || '' : flow.startNodeId;
    onChangeFlow({ ...flow, startNodeId: nextStart, nodes: filtered });
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(filtered[0]?.id || '');
    }
  }

  function addInlineButton(node: FlowNode) {
    const newBtn: InlineButtonConfig = {
      id: `btn_${Date.now().toString(36)}`,
      text: 'دکمه جدید',
      targetNodeId: flow.nodes[0]?.id || '',
    };
    updateNode(node.id, {
      inlineButtons: [...(node.inlineButtons || []), newBtn],
    });
  }

  function updateInlineButton(
    node: FlowNode,
    buttonId: string,
    patch: Partial<InlineButtonConfig>
  ) {
    const nextButtons = (node.inlineButtons || []).map((b) =>
      b.id === buttonId ? { ...b, ...patch } : b
    );
    updateNode(node.id, { inlineButtons: nextButtons });
  }

  function removeInlineButton(node: FlowNode, buttonId: string) {
    const nextButtons = (node.inlineButtons || []).filter((b) => b.id !== buttonId);
    updateNode(node.id, { inlineButtons: nextButtons });
  }

  async function sendSimulatedMessage(text?: string, callbackData?: string, buttonLabel?: string) {
    setSimSending(true);
    setSimError(null);

    const displayUserText = buttonLabel || text || '';
    if (displayUserText) {
      setSimMessages((prev) => [
        ...prev,
        { id: `u_${Date.now()}`, sender: 'user', text: displayUserText },
      ]);
    }

    try {
      const res = await api.simulateDispatch({
        botId: botId || 'simulator-bot',
        userName: 'کاربر آزمایشی',
        flow,
        text,
        callbackData,
      });

      setSimContext(res.session.context_data || {});
      const botReplies: SimMessage[] = res.outgoingPayloads.map((p, idx) => ({
        id: `b_${Date.now()}_${idx}`,
        sender: 'bot',
        text: p.text,
        replyMarkup: p.reply_markup,
      }));
      setSimMessages((prev) => [...prev, ...botReplies]);
    } catch (err) {
      setSimError(err instanceof ApiError ? err.message : 'خطا در اجرای شبیه‌ساز');
    } finally {
      setSimSending(false);
    }
  }

  async function resetSimulator() {
    await api.simulateReset(botId || 'simulator-bot').catch(() => undefined);
    setSimMessages([]);
    setSimContext({});
    setSimError(null);
    await sendSimulatedMessage('/start');
  }

  function openJsonPanel() {
    setJsonDraft(JSON.stringify(flow, null, 2));
    setJsonError(null);
    setRightPanelMode('json');
  }

  function applyJsonDraft() {
    try {
      const parsed = JSON.parse(jsonDraft) as FlowDefinition;
      if (!parsed || !Array.isArray(parsed.nodes)) {
        setJsonError('فیلد nodes باید آرایه‌ای از گره‌ها باشد.');
        return;
      }
      onChangeFlow(parsed);
      setJsonError(null);
      setRightPanelMode('inspector');
    } catch {
      setJsonError('فرمت JSON نامعتبر است.');
    }
  }

  return (
    <div className="space-y-4">
      {/* Studio Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 ml-1">افزودن گره:</span>
          {(['trigger', 'message', 'question', 'condition', 'save_form'] as NodeType[]).map(
            (type) => (
              <button
                key={type}
                type="button"
                onClick={() => addNode(type)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-700" />
                <span>{NODE_TYPE_LABELS[type]}</span>
              </button>
            )
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setRightPanelMode('inspector')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                rightPanelMode === 'inspector'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              تنظیمات گره
            </button>
            <button
              type="button"
              onClick={() => {
                setRightPanelMode('simulator');
                if (simMessages.length === 0) {
                  void sendSimulatedMessage('/start');
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                rightPanelMode === 'simulator'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Play className="w-3 h-3 text-emerald-700" />
              <span>شبیه‌ساز چت بله</span>
            </button>
            <button
              type="button"
              onClick={openJsonPanel}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                rightPanelMode === 'json'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>JSON</span>
            </button>
          </div>

          {token && botId && (
            <button
              type="button"
              disabled={saving}
              onClick={() => onSaveFlow()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'در حال ذخیره...' : 'ذخیره و انتشار در دایرکتوس'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main 2-Pane Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Flow Tree / Node List (7 columns) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                درخت جریان گفتگو · {flowName}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                تعداد گره‌ها: {toPersianDigits(flow.nodes.length)} · برای ویرایش روی هر گره کلیک کنید
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {flow.nodes.map((node, index) => {
              const isSelected = selectedNode?.id === node.id;
              const nextTitle = node.nextNodeId ? nodeTitleMap.get(node.nextNodeId) : null;

              return (
                <div key={node.id} className="space-y-2">
                  <div
                    onClick={() => {
                      setSelectedNodeId(node.id);
                      if (rightPanelMode === 'json') setRightPanelMode('inspector');
                    }}
                    className={`p-4 rounded-xl border transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-emerald-700 bg-emerald-50/30 ring-1 ring-emerald-700/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {getNodeIcon(node.type)}
                          <span className="text-sm font-bold text-slate-900">{node.title}</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-xs text-slate-500">
                            {NODE_TYPE_LABELS[node.type]}
                          </span>
                          {node.type === 'trigger' && node.triggerPattern && (
                            <>
                              <span className="text-slate-300">·</span>
                              <code className="text-xs font-mono text-emerald-800" dir="ltr">
                                {node.triggerPattern}
                              </code>
                            </>
                          )}
                          {node.type === 'question' && node.fieldKey && (
                            <>
                              <span className="text-slate-300">·</span>
                              <span className="text-xs text-sky-800 font-mono">
                                {node.fieldKey}
                              </span>
                            </>
                          )}
                        </div>

                        {node.messageText && (
                          <p className="text-xs text-slate-600 line-clamp-2 leading-5 whitespace-pre-line">
                            {node.messageText}
                          </p>
                        )}

                        {node.inlineButtons && node.inlineButtons.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {node.inlineButtons.map((btn) => (
                              <span
                                key={btn.id}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-100 text-slate-700 rounded-md"
                              >
                                <span>{btn.text}</span>
                                {btn.targetNodeId && (
                                  <span className="text-slate-400">
                                    ← {nodeTitleMap.get(btn.targetNodeId) || btn.targetNodeId}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        )}

                        {node.type === 'condition' && node.condition && (
                          <p className="text-xs text-slate-600">
                            اگر <code className="font-mono">{node.condition.sourceKey}</code>{' '}
                            ({node.condition.operator}) «{node.condition.value}» بود →{' '}
                            {nodeTitleMap.get(node.condition.trueNodeId) || 'نامشخص'} / در غیر این صورت →{' '}
                            {nodeTitleMap.get(node.condition.falseNodeId) || 'نامشخص'}
                          </p>
                        )}
                      </div>

                      {flow.nodes.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNode(node.id);
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-700 rounded-lg shrink-0 cursor-pointer"
                          title="حذف گره"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {nextTitle && index < flow.nodes.length - 1 && (
                    <div className="flex items-center gap-1.5 pr-4 text-xs text-slate-400">
                      <ArrowDown className="w-3.5 h-3.5" />
                      <span>انتقال بعدی: {nextTitle}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-200">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              پیام پیش‌فرض (Fallback) در صورت نامفهوم بودن ورودی کاربر
            </label>
            <input
              type="text"
              value={flow.fallbackText}
              onChange={(e) => onChangeFlow({ ...flow, fallbackText: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            />
          </div>
        </div>

        {/* Right Column: Inspector / Simulator / JSON (5 columns) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden sticky top-6">
          {rightPanelMode === 'inspector' && selectedNode && (
            <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  {getNodeIcon(selectedNode.type)}
                  <h3 className="text-sm font-bold text-slate-900">ویرایش گره</h3>
                </div>
                <code className="text-xs font-mono text-slate-400" dir="ltr">
                  {selectedNode.id}
                </code>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">عنوان گره</label>
                <input
                  type="text"
                  value={selectedNode.title}
                  onChange={(e) => updateNode(selectedNode.id, { title: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                />
              </div>

              {selectedNode.type === 'trigger' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    دستور یا عبارت محرک (با کاما جدا کنید)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={selectedNode.triggerPattern || ''}
                    onChange={(e) =>
                      updateNode(selectedNode.id, { triggerPattern: e.target.value })
                    }
                    placeholder="/start, شروع"
                    className="w-full px-3 py-2 text-xs text-left font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                  />
                </div>
              )}

              {(selectedNode.type === 'message' ||
                selectedNode.type === 'question' ||
                selectedNode.type === 'save_form') && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-700">متن پیام بازو</label>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() =>
                          updateNode(selectedNode.id, {
                            messageText: `${selectedNode.messageText || ''} {{user.first_name}}`.trim(),
                          })
                        }
                        className="text-[11px] font-mono text-emerald-700 hover:underline cursor-pointer"
                      >
                        +نام کاربر
                      </button>
                      {questionFields.map((qf) => (
                        <button
                          key={qf.key}
                          type="button"
                          onClick={() =>
                            updateNode(selectedNode.id, {
                              messageText: `${selectedNode.messageText || ''} {{form.${qf.key}}}`.trim(),
                            })
                          }
                          className="text-[11px] font-mono text-sky-700 hover:underline cursor-pointer"
                        >
                          +{qf.key}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    rows={4}
                    value={selectedNode.messageText || ''}
                    onChange={(e) => updateNode(selectedNode.id, { messageText: e.target.value })}
                    className="w-full px-3 py-2 text-xs leading-6 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                  />
                </div>
              )}

              {selectedNode.type === 'question' && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        کلید فیلد (انگلیسی)
                      </label>
                      <input
                        type="text"
                        dir="ltr"
                        value={selectedNode.fieldKey || ''}
                        onChange={(e) => updateNode(selectedNode.id, { fieldKey: e.target.value })}
                        className="w-full px-3 py-2 text-xs text-left font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        نوع اعتبارسنجی
                      </label>
                      <select
                        value={selectedNode.inputType || 'text'}
                        onChange={(e) =>
                          updateNode(selectedNode.id, {
                            inputType: e.target.value as QuestionInputType,
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-emerald-600"
                      >
                        <option value="text">متن آزاد</option>
                        <option value="phone">شماره موبایل ایران</option>
                        <option value="number">عدد</option>
                        <option value="email">ایمیل</option>
                        <option value="choice">انتخاب با دکمه یا متن</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      پیام خطای اعتبارسنجی
                    </label>
                    <input
                      type="text"
                      value={selectedNode.validationErrorText || ''}
                      onChange={(e) =>
                        updateNode(selectedNode.id, { validationErrorText: e.target.value })
                      }
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                </div>
              )}

              {selectedNode.type === 'save_form' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    عنوان فرم برای ذخیره در دایرکتوس
                  </label>
                  <input
                    type="text"
                    value={selectedNode.formTitle || ''}
                    onChange={(e) => updateNode(selectedNode.id, { formTitle: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                  />
                </div>
              )}

              {selectedNode.type === 'condition' && selectedNode.condition && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        متغیر منبع
                      </label>
                      <input
                        type="text"
                        dir="ltr"
                        value={selectedNode.condition.sourceKey}
                        onChange={(e) =>
                          updateNode(selectedNode.id, {
                            condition: { ...selectedNode.condition!, sourceKey: e.target.value },
                          })
                        }
                        className="w-full px-3 py-2 text-xs font-mono text-left border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">عملگر</label>
                      <select
                        value={selectedNode.condition.operator}
                        onChange={(e) =>
                          updateNode(selectedNode.id, {
                            condition: {
                              ...selectedNode.condition!,
                              operator: e.target.value as 'equals' | 'contains' | 'not_empty',
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="equals">برابر با</option>
                        <option value="contains">شامل متن</option>
                        <option value="not_empty">خالی نباشد</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">مقدار مقایسه</label>
                    <input
                      type="text"
                      value={selectedNode.condition.value}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          condition: { ...selectedNode.condition!, value: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        در صورت درستی (True)
                      </label>
                      <select
                        value={selectedNode.condition.trueNodeId}
                        onChange={(e) =>
                          updateNode(selectedNode.id, {
                            condition: { ...selectedNode.condition!, trueNodeId: e.target.value },
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="">انتخاب گره...</option>
                        {flow.nodes
                          .filter((n) => n.id !== selectedNode.id)
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.title}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        در صورت نادرستی (False)
                      </label>
                      <select
                        value={selectedNode.condition.falseNodeId}
                        onChange={(e) =>
                          updateNode(selectedNode.id, {
                            condition: { ...selectedNode.condition!, falseNodeId: e.target.value },
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="">انتخاب گره...</option>
                        {flow.nodes
                          .filter((n) => n.id !== selectedNode.id)
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.title}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Inline Buttons Builder */}
              {(selectedNode.type === 'message' || selectedNode.type === 'question') && (
                <div className="space-y-2.5 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-700">
                      دکمه‌های شیشه‌ای بله (Inline Keyboard)
                    </label>
                    <button
                      type="button"
                      onClick={() => addInlineButton(selectedNode)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>افزودن دکمه</span>
                    </button>
                  </div>

                  {(selectedNode.inlineButtons || []).map((btn) => (
                    <div
                      key={btn.id}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={btn.text}
                          onChange={(e) =>
                            updateInlineButton(selectedNode, btn.id, { text: e.target.value })
                          }
                          placeholder="عنوان فارسی دکمه"
                          className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-emerald-600"
                        />
                        <button
                          type="button"
                          onClick={() => removeInlineButton(selectedNode, btn.id)}
                          className="p-1 text-slate-400 hover:text-red-700 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <select
                        value={btn.targetNodeId}
                        onChange={(e) =>
                          updateInlineButton(selectedNode, btn.id, {
                            targetNodeId: e.target.value,
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-emerald-600"
                      >
                        <option value="">انتخاب گره مقصد پس از کلیک...</option>
                        {flow.nodes
                          .filter((n) => n.id !== selectedNode.id)
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.title}
                            </option>
                          ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}

              {/* Next node transition */}
              {selectedNode.type !== 'condition' && (
                <div className="pt-2 border-t border-slate-100">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    گره بعدی (پس از اتمام این مرحله)
                  </label>
                  <select
                    value={selectedNode.nextNodeId || ''}
                    onChange={(e) => updateNode(selectedNode.id, { nextNodeId: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-emerald-600"
                  >
                    <option value="">توقف / پایان</option>
                    {flow.nodes
                      .filter((n) => n.id !== selectedNode.id)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.title}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {rightPanelMode === 'simulator' && (
            <div className="flex flex-col h-[600px]">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-900">شبیه‌ساز زنده پیام‌رسان بله</h3>
                  <p className="text-[11px] text-slate-500">
                    اجرای مستقیم موتور FlowExecutionEngine سرور
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetSimulator}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>شروع مجدد</span>
                </button>
              </div>

              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/50">
                {simMessages.length === 0 && (
                  <div className="text-center py-10 text-xs text-slate-500">
                    برای شروع گفتگو عبارت <code className="font-mono">/start</code> را ارسال کنید.
                  </div>
                )}

                {simMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.sender === 'user' ? 'items-start' : 'items-end'
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs leading-6 whitespace-pre-line ${
                        msg.sender === 'user'
                          ? 'bg-emerald-700 text-white'
                          : 'bg-white border border-slate-200 text-slate-800'
                      }`}
                    >
                      {msg.text}
                    </div>

                    {msg.replyMarkup?.inline_keyboard && (
                      <div className="mt-1.5 flex flex-col gap-1 w-[85%]">
                        {msg.replyMarkup.inline_keyboard.map((row, rIdx) => (
                          <div key={rIdx} className="flex gap-1">
                            {row.map((btn, bIdx) => (
                              <button
                                key={bIdx}
                                type="button"
                                disabled={simSending}
                                onClick={() =>
                                  btn.callback_data &&
                                  sendSimulatedMessage(undefined, btn.callback_data, btn.text)
                                }
                                className="flex-1 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-white border border-emerald-200 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                              >
                                {btn.text}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {simError && (
                  <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                    {simError}
                  </div>
                )}
              </div>

              {Object.keys(simContext).length > 0 && (
                <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-600 flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-700">حافظه نشست:</span>
                  {Object.entries(simContext).map(([k, v]) => (
                    <span key={k} className="font-mono">
                      {k}={v}
                    </span>
                  ))}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!simInput.trim() || simSending) return;
                  const val = simInput.trim();
                  setSimInput('');
                  void sendSimulatedMessage(val);
                }}
                className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
              >
                <input
                  type="text"
                  value={simInput}
                  onChange={(e) => setSimInput(e.target.value)}
                  placeholder="پیام یا دستور (/start) بنویسید..."
                  className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                />
                <button
                  type="submit"
                  disabled={simSending || !simInput.trim()}
                  className="p-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-lg cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}

          {rightPanelMode === 'json' && (
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">ساختار JSON جریان گفتگو</h3>
                <button
                  type="button"
                  onClick={applyJsonDraft}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                >
                  اعمال تغییرات JSON
                </button>
              </div>
              {jsonError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
                  {jsonError}
                </p>
              )}
              <textarea
                rows={22}
                dir="ltr"
                value={jsonDraft}
                onChange={(e) => setJsonDraft(e.target.value)}
                className="w-full p-3 text-xs font-mono text-left border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
