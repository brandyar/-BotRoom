import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  Calendar,
  CheckCircle2,
  Clock,
  Code2,
  GitBranch,
  HelpCircle,
  History,
  Layers,
  ListTree,
  MessageSquare,
  Phone,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  ShoppingBag,
  Star,
  Tag,
  Trash2,
  UserCheck,
  Workflow,
  Zap,
} from 'lucide-react';
import type { FlowTemplateItem } from '../data/flowTemplates.ts';
import { api, ApiError } from '../lib/api.ts';
import type {
  AppointmentRecord,
  BaleInlineKeyboardMarkup,
  BaleReplyKeyboardMarkup,
  BaleReplyMarkup,
  BookingScheduleRecord,
  BookingServiceRecord,
  BotFlowRecord,
  ConditionOperator,
  ContactFieldMapping,
  FlowDefinition,
  FlowNode,
  InlineButtonConfig,
  NodeType,
  ProductRecord,
  QuestionInputType,
  ScheduledFollowUpItem,
  SurveyQuestionItem,
  SurveyRecord,
} from '../types/bot.ts';
import { autoLayoutFlow, needsAutoLayout, validateFlowGraph } from '../utils/flowValidator.ts';
import { formatJalaliDateTime, toPersianDigits } from '../utils/jalali.ts';
import { FlowCanvas, type EdgeKind } from './FlowCanvas.tsx';
import { TemplateGalleryModal } from './TemplateGalleryModal.tsx';

interface FlowBuilderViewProps {
  token: string | null;
  botId: string | null;
  flowId?: string | null;
  flowName: string;
  flows?: BotFlowRecord[];
  flow: FlowDefinition;
  products?: ProductRecord[];
  surveys?: SurveyRecord[];
  bookingServices?: BookingServiceRecord[];
  bookingSchedules?: BookingScheduleRecord[];
  appointments?: AppointmentRecord[];
  saving: boolean;
  onChangeFlow: (next: FlowDefinition) => void;
  onSaveFlow: (options?: { saveAsNewVersion?: boolean }) => Promise<void>;
  onSelectFlowVersion?: (flowRecord: BotFlowRecord) => void;
  onPublishVersion?: (targetFlowId: string) => Promise<void>;
}

interface SimMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  photoUrl?: string;
  replyMarkup?: BaleReplyMarkup;
  scheduledFollowUps?: ScheduledFollowUpItem[];
}

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  trigger: 'دستور شروع / ماشه',
  message: 'ارسال پیام و دکمه',
  question: 'دریافت ورودی (فیلد فرم)',
  condition: 'شرط و انشعاب',
  delay: 'تاخیر / پیام پیگیری',
  tag_contact: 'برچسب‌گذاری مشتری',
  update_contact: 'ذخیره در پروفایل CRM',
  save_form: 'ثبت نهایی فرم',
  catalog_browser: 'مرورگر کاتالوگ',
  survey_node: 'نظرسنجی',
  booking_node: 'رزرو و نوبت‌دهی شمسی',
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
    case 'delay':
      return <Clock className="w-3.5 h-3.5 text-amber-700" />;
    case 'tag_contact':
      return <Tag className="w-3.5 h-3.5 text-emerald-700" />;
    case 'update_contact':
      return <UserCheck className="w-3.5 h-3.5 text-emerald-700" />;
    case 'save_form':
      return <Save className="w-3.5 h-3.5 text-emerald-700" />;
    case 'catalog_browser':
      return <ShoppingBag className="w-3.5 h-3.5 text-sky-700" />;
    case 'survey_node':
      return <Star className="w-3.5 h-3.5 text-amber-600" />;
    case 'booking_node':
      return <Calendar className="w-3.5 h-3.5 text-emerald-700" />;
  }
}

export function FlowBuilderView({
  token,
  botId,
  flowId,
  flowName,
  flows = [],
  flow,
  products = [],
  surveys = [],
  bookingServices = [],
  bookingSchedules = [],
  appointments = [],
  saving,
  onChangeFlow,
  onSaveFlow,
  onSelectFlowVersion,
  onPublishVersion,
}: FlowBuilderViewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    flow.startNodeId || flow.nodes[0]?.id || ''
  );
  const [workspaceView, setWorkspaceView] = useState<'canvas' | 'list'>('canvas');
  const [rightPanelMode, setRightPanelMode] = useState<'inspector' | 'simulator' | 'json'>(
    'inspector'
  );
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [showValidationPanel, setShowValidationPanel] = useState(false);

  // Simulator state
  const [simMessages, setSimMessages] = useState<SimMessage[]>([]);
  const [simInput, setSimInput] = useState('');
  const [simContext, setSimContext] = useState<Record<string, string>>({});
  const [simTags, setSimTags] = useState<string[]>([]);
  const [simInitialTags, setSimInitialTags] = useState<string[]>([]);
  const [simSending, setSimSending] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  // JSON editor state
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const normalizedFlow = useMemo(
    () => (needsAutoLayout(flow) ? autoLayoutFlow(flow) : flow),
    [flow]
  );

  const validation = useMemo(() => validateFlowGraph(normalizedFlow), [normalizedFlow]);

  const selectedNode = useMemo(
    () =>
      normalizedFlow.nodes.find((n) => n.id === selectedNodeId) ||
      normalizedFlow.nodes[0] ||
      null,
    [normalizedFlow.nodes, selectedNodeId]
  );

  const activeFlowRecord = useMemo(
    () => flows.find((f) => f.id === flowId) || null,
    [flows, flowId]
  );

  useEffect(() => {
    setSimMessages([]);
    setSimContext({});
    setSimTags([]);
    setSimError(null);
  }, [botId]);

  useEffect(() => {
    if (!normalizedFlow.nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(normalizedFlow.startNodeId || normalizedFlow.nodes[0]?.id || '');
    }
  }, [flowId, normalizedFlow.nodes, normalizedFlow.startNodeId, selectedNodeId]);

  const nodeTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of normalizedFlow.nodes) {
      map.set(node.id, node.title);
    }
    return map;
  }, [normalizedFlow.nodes]);

  const questionFields = useMemo(
    () =>
      normalizedFlow.nodes
        .filter((n) => n.type === 'question' && n.fieldKey)
        .map((n) => ({ key: n.fieldKey!, label: n.fieldLabel || n.fieldKey! })),
    [normalizedFlow.nodes]
  );

  function updateNode(nodeId: string, patch: Partial<FlowNode>) {
    const nextNodes = normalizedFlow.nodes.map((n) =>
      n.id === nodeId ? { ...n, ...patch } : n
    );
    onChangeFlow({ ...normalizedFlow, nodes: nextNodes });
  }

  function updateNodePosition(nodeId: string, position: { x: number; y: number }) {
    const nextNodes = normalizedFlow.nodes.map((n) =>
      n.id === nodeId ? { ...n, position } : n
    );
    onChangeFlow({ ...normalizedFlow, nodes: nextNodes });
  }

  function connectEdge(kind: EdgeKind, targetNodeId: string) {
    if (kind.sourceNodeId === targetNodeId) return;
    const sourceNode = normalizedFlow.nodes.find((n) => n.id === kind.sourceNodeId);
    if (!sourceNode) return;

    if (kind.type === 'next') {
      updateNode(sourceNode.id, { nextNodeId: targetNodeId });
    } else if (kind.type === 'condition_true' && sourceNode.condition) {
      updateNode(sourceNode.id, {
        condition: { ...sourceNode.condition, trueNodeId: targetNodeId },
      });
    } else if (kind.type === 'condition_false' && sourceNode.condition) {
      updateNode(sourceNode.id, {
        condition: { ...sourceNode.condition, falseNodeId: targetNodeId },
      });
    } else if (kind.type === 'survey_low') {
      updateNode(sourceNode.id, {
        surveyConfig: {
          surveyType: sourceNode.surveyConfig?.surveyType || 'rating',
          ...sourceNode.surveyConfig,
          lowScoreNodeId: targetNodeId,
        },
      });
    } else if (kind.type === 'button') {
      updateNode(sourceNode.id, {
        inlineButtons: (sourceNode.inlineButtons || []).map((b) =>
          b.id === kind.buttonId ? { ...b, targetNodeId } : b
        ),
      });
    }
  }

  function disconnectEdge(kind: EdgeKind) {
    const sourceNode = normalizedFlow.nodes.find((n) => n.id === kind.sourceNodeId);
    if (!sourceNode) return;

    if (kind.type === 'next') {
      updateNode(sourceNode.id, { nextNodeId: '' });
    } else if (kind.type === 'condition_true' && sourceNode.condition) {
      updateNode(sourceNode.id, {
        condition: { ...sourceNode.condition, trueNodeId: '' },
      });
    } else if (kind.type === 'condition_false' && sourceNode.condition) {
      updateNode(sourceNode.id, {
        condition: { ...sourceNode.condition, falseNodeId: '' },
      });
    } else if (kind.type === 'survey_low' && sourceNode.surveyConfig) {
      updateNode(sourceNode.id, {
        surveyConfig: { ...sourceNode.surveyConfig, lowScoreNodeId: '' },
      });
    } else if (kind.type === 'button') {
      updateNode(sourceNode.id, {
        inlineButtons: (sourceNode.inlineButtons || []).map((b) =>
          b.id === kind.buttonId ? { ...b, targetNodeId: '' } : b
        ),
      });
    }
  }

  function addNode(type: NodeType) {
    const id = `node_${Date.now().toString(36)}`;
    const anchorPos = selectedNode?.position || { x: 420, y: 120 };
    const newPosition = {
      x: Math.max(40, anchorPos.x - 340),
      y: anchorPos.y + (normalizedFlow.nodes.length % 2 === 0 ? 0 : 140),
    };

    const defaults: Record<NodeType, Partial<FlowNode>> = {
      trigger: {
        title: 'دستور جدید',
        triggerPattern: '/help',
        nextNodeId: normalizedFlow.nodes[1]?.id || '',
      },
      message: {
        title: 'پیام جدید',
        messageText: 'متن پیام پاسخ بازو را اینجا بنویسید...',
        inlineButtons: [],
      },
      question: {
        title: 'سوال فرم جدید',
        messageText: 'لطفاً مقدار مورد نظر را وارد کنید:',
        fieldKey: `field_${normalizedFlow.nodes.length + 1}`,
        fieldLabel: 'فیلد جدید',
        inputType: 'text',
        validationErrorText: 'ورودی نامعتبر است.',
      },
      condition: {
        title: 'بررسی شرط',
        condition: {
          sourceKey: 'contact.tags',
          operator: 'contains',
          value: 'VIP',
          trueNodeId: '',
          falseNodeId: '',
        },
      },
      delay: {
        title: 'پیام پیگیری تاخیری',
        delayConfig: {
          delaySeconds: 10,
          followUpText: 'یادآوری خودکار: همچنان منتظر پاسخ یا هماهنگی شما هستیم.',
          cancelIfReplied: true,
        },
      },
      tag_contact: {
        title: 'برچسب‌گذاری مشتری',
        tagConfig: {
          action: 'add',
          tags: ['مشتری جدید'],
        },
      },
      update_contact: {
        title: 'ذخیره در پروفایل CRM',
        contactFieldMappings: [
          { sessionKey: 'full_name', targetField: 'first_name' },
          { sessionKey: 'phone', targetField: 'phone' },
        ],
      },
      save_form: {
        title: 'ثبت نهایی اطلاعات',
        formTitle: 'فرم جدید',
        messageText: 'اطلاعات شما با موفقیت ثبت شد.',
      },
      catalog_browser: {
        title: 'مرورگر کاتالوگ محصولات',
        catalogConfig: {
          categoryFilter: 'all',
          allowCart: true,
          emptyText: 'محصول فعالی یافت نشد.',
          checkoutConfirmText: '✅ سفارش شما ثبت شد!',
        },
      },
      survey_node: {
        title: 'نظرسنجی رضایت مشتری',
        surveyConfig: {
          surveyType: 'rating',
          questionText: 'از کیفیت خدمات ما چه امتیازی (۱ تا ۵) می‌دهید؟',
          lowScoreThreshold: 3,
          thankYouText: 'با تشکر از ثبت نظر شما!',
        },
      },
      booking_node: {
        title: 'رزرو نوبت شمسی',
        bookingConfig: {
          daysAhead: 7,
          defaultStatus: 'confirmed',
          introText: 'سلام! برای رزرو نوبت، خدمت مورد نظر را انتخاب کنید:',
          confirmText: '✅ نوبت شما با موفقیت ثبت شد!',
          emptySlotsText: 'در روزهای آینده نوبت آزادی یافت نشد.',
        },
      },
    };

    const newNode: FlowNode = {
      id,
      type,
      title: defaults[type].title || 'گره جدید',
      position: newPosition,
      ...defaults[type],
    };

    onChangeFlow({
      ...normalizedFlow,
      nodes: [...normalizedFlow.nodes, newNode],
    });
    setSelectedNodeId(id);
    setRightPanelMode('inspector');
  }

  function deleteNode(nodeId: string) {
    if (normalizedFlow.nodes.length <= 1) return;
    const filtered = normalizedFlow.nodes
      .filter((n) => n.id !== nodeId)
      .map((n) => ({
        ...n,
        nextNodeId: n.nextNodeId === nodeId ? '' : n.nextNodeId,
        condition: n.condition
          ? {
              ...n.condition,
              trueNodeId: n.condition.trueNodeId === nodeId ? '' : n.condition.trueNodeId,
              falseNodeId: n.condition.falseNodeId === nodeId ? '' : n.condition.falseNodeId,
            }
          : undefined,
        surveyConfig: n.surveyConfig
          ? {
              ...n.surveyConfig,
              lowScoreNodeId:
                n.surveyConfig.lowScoreNodeId === nodeId ? '' : n.surveyConfig.lowScoreNodeId,
            }
          : undefined,
        inlineButtons: n.inlineButtons?.map((b) =>
          b.targetNodeId === nodeId ? { ...b, targetNodeId: '' } : b
        ),
      }));

    const nextStart =
      normalizedFlow.startNodeId === nodeId ? filtered[0]?.id || '' : normalizedFlow.startNodeId;
    onChangeFlow({ ...normalizedFlow, startNodeId: nextStart, nodes: filtered });
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(filtered[0]?.id || '');
    }
  }

  function addInlineButton(node: FlowNode) {
    const newBtn: InlineButtonConfig = {
      id: `btn_${Date.now().toString(36)}`,
      text: 'دکمه جدید',
      targetNodeId: normalizedFlow.nodes[0]?.id || '',
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

  async function sendSimulatedMessage(
    text?: string,
    callbackData?: string,
    buttonLabel?: string,
    contactPhone?: string,
    overrideTags?: string[],
    resumeNodeId?: string
  ) {
    setSimSending(true);
    setSimError(null);

    const displayUserText =
      buttonLabel || (contactPhone ? `شماره ارسال‌شده: ${contactPhone}` : text || '');
    if (displayUserText) {
      setSimMessages((prev) => [
        ...prev,
        { id: `u_${Date.now()}`, sender: 'user', text: displayUserText },
      ]);
    }

    try {
      const effectiveTags = overrideTags !== undefined ? overrideTags : simInitialTags;
      const fallbackPreviewServices: BookingServiceRecord[] | undefined =
        !token && bookingServices.length === 0
          ? [
              {
                id: 'sim_svc_1',
                bot_id: 'simulator-bot',
                title: 'مشاوره عمومی و ویزیت',
                duration_minutes: 30,
                capacity_per_slot: 2,
                price: 250000,
                is_active: true,
              },
            ]
          : undefined;
      const fallbackPreviewSchedules: BookingScheduleRecord[] | undefined =
        !token && bookingServices.length === 0
          ? [0, 1, 2, 3, 4, 5].map((wd) => ({
              id: `sim_sch_${wd}`,
              bot_id: 'simulator-bot',
              service_id: 'sim_svc_1',
              weekday: wd,
              start_time: '09:00',
              end_time: '13:00',
              blocked_dates: [],
              is_active: true,
            }))
          : undefined;

      const res = await api.simulateDispatch({
        botId: botId || 'simulator-bot',
        userName: 'کاربر آزمایشی',
        flow: normalizedFlow,
        text,
        callbackData,
        contactPhone,
        simulatedTags: effectiveTags.length > 0 ? effectiveTags : undefined,
        resumeNodeId,
        previewProducts: products,
        previewSurveys: surveys,
        previewBookingServices:
          bookingServices.length > 0 ? bookingServices : fallbackPreviewServices,
        previewBookingSchedules:
          bookingSchedules.length > 0 ? bookingSchedules : fallbackPreviewSchedules,
        previewAppointments: appointments.length > 0 ? appointments : undefined,
      });

      setSimContext(res.session.context_data || {});
      setSimTags(res.contactTags || []);

      const editPayloads = res.outgoingPayloads.filter((p) => p.is_edit);
      const normalPayloads = res.outgoingPayloads.filter((p) => !p.is_edit);

      setSimMessages((prev) => {
        let next = [...prev];
        if (editPayloads.length > 0) {
          const edited = editPayloads[editPayloads.length - 1];
          let lastBotIdx = -1;
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].sender === 'bot' && !next[i].scheduledFollowUps) {
              lastBotIdx = i;
              break;
            }
          }
          if (lastBotIdx >= 0) {
            next[lastBotIdx] = {
              ...next[lastBotIdx],
              text: edited.text,
              photoUrl: edited.photo_url,
              replyMarkup: edited.reply_markup,
            };
          } else {
            next.push({
              id: `b_${Date.now()}_edit`,
              sender: 'bot',
              text: edited.text,
              photoUrl: edited.photo_url,
              replyMarkup: edited.reply_markup,
            });
          }
        }

        const appended: SimMessage[] = normalPayloads.map((p, idx) => ({
          id: `b_${Date.now()}_${idx}`,
          sender: 'bot',
          text: p.text,
          photoUrl: p.photo_url,
          replyMarkup: p.reply_markup,
        }));

        if (res.scheduledFollowUps && res.scheduledFollowUps.length > 0) {
          appended.push({
            id: `delay_${Date.now()}`,
            sender: 'bot',
            text: 'پیام پیگیری زمان‌بندی شد:',
            scheduledFollowUps: res.scheduledFollowUps,
          });
        }

        return [...next, ...appended];
      });
    } catch (err) {
      setSimError(err instanceof ApiError ? err.message : 'خطا در اجرای شبیه‌ساز');
    } finally {
      setSimSending(false);
    }
  }

  async function triggerScheduledFollowUpInSimulator(item: ScheduledFollowUpItem) {
    if (item.followUpText) {
      setSimMessages((prev) => [
        ...prev,
        {
          id: `fu_${Date.now()}`,
          sender: 'bot',
          text: item.followUpText,
        },
      ]);
    }
    if (item.nextNodeId) {
      await sendSimulatedMessage(undefined, undefined, undefined, undefined, undefined, item.nextNodeId);
    }
  }

  async function resetSimulator(overrideTags?: string[]) {
    await api.simulateReset(botId || 'simulator-bot').catch(() => undefined);
    setSimMessages([]);
    setSimContext({});
    setSimTags(overrideTags || simInitialTags);
    setSimError(null);
    await sendSimulatedMessage('/start', undefined, undefined, undefined, overrideTags);
  }

  function openJsonPanel() {
    setJsonDraft(JSON.stringify(normalizedFlow, null, 2));
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
      const layouted = autoLayoutFlow(parsed);
      onChangeFlow(layouted);
      setJsonError(null);
      setRightPanelMode('inspector');
    } catch {
      setJsonError('فرمت JSON نامعتبر است.');
    }
  }

  function handleApplyTemplate(template: FlowTemplateItem) {
    const cloned: FlowDefinition = JSON.parse(JSON.stringify(template.flow));
    onChangeFlow(cloned);
    setSelectedNodeId(cloned.startNodeId || cloned.nodes[0]?.id || '');
    setRightPanelMode('inspector');
    setShowValidationPanel(false);
  }

  async function handlePublishClick(asNewVersion = false) {
    if (validation.errorCount > 0) {
      setShowValidationPanel(true);
      return;
    }
    await onSaveFlow({ saveAsNewVersion: asNewVersion });
  }

  const presetConditionSources = [
    { value: 'last_input', label: 'آخرین پیام کاربر (last_input)' },
    { value: 'contact.tags', label: 'برچسب‌های CRM مشتری (contact.tags)' },
    { value: 'contact.phone', label: 'شماره تماس مشتری (contact.phone)' },
    { value: 'survey_score', label: 'امتیاز آخرین نظرسنجی (survey_score)' },
    { value: 'order_total', label: 'مبلغ سفارش سبد خرید (order_total)' },
    { value: 'appointment_service', label: 'خدمت نوبت رزروشده (appointment_service)' },
    { value: 'appointment_date', label: 'تاریخ نوبت رزروشده (appointment_date)' },
    ...questionFields.map((qf) => ({
      value: qf.key,
      label: `فیلد فرم: ${qf.label} (${qf.key})`,
    })),
  ];

  const isCustomConditionSource =
    selectedNode?.type === 'condition' &&
    selectedNode.condition &&
    !presetConditionSources.some((s) => s.value === selectedNode.condition!.sourceKey);

  return (
    <div className="space-y-4">
      {/* Studio Top Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* View Toggle + Templates + Validation */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setWorkspaceView('canvas')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  workspaceView === 'canvas'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Workflow className="w-3.5 h-3.5 text-emerald-700" />
                <span>بوم گراف بصری</span>
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceView('list')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  workspaceView === 'list'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ListTree className="w-3.5 h-3.5" />
                <span>نمای لیستی</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setTemplateModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-emerald-700" />
              <span>قالب‌های آماده</span>
            </button>

            <button
              type="button"
              onClick={() => setShowValidationPanel((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                validation.errorCount > 0
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : validation.warningCount > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-emerald-50/70 border-emerald-200 text-emerald-800'
              }`}
            >
              {validation.errorCount === 0 && validation.warningCount === 0 ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>گراف سالم است</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="tabular-nums">
                    بررسی گراف ({toPersianDigits(validation.errorCount)} خطا ·{' '}
                    {toPersianDigits(validation.warningCount)} هشدار)
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Right Panel Modes + Versioning + Save */}
          <div className="flex items-center gap-2 flex-wrap">
            {token && botId && flows.length > 0 && (
              <div className="flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <select
                  value={flowId || flows[0]?.id || ''}
                  onChange={(e) => {
                    const target = flows.find((f) => f.id === e.target.value);
                    if (target && onSelectFlowVersion) {
                      onSelectFlowVersion(target);
                    }
                  }}
                  className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600 tabular-nums"
                >
                  {flows.map((f) => (
                    <option key={f.id} value={f.id}>
                      نسخه {toPersianDigits(f.version || 1)}
                      {f.is_published ? ' (منتشرشده)' : ''}
                    </option>
                  ))}
                </select>
                {activeFlowRecord && !activeFlowRecord.is_published && onPublishVersion && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => onPublishVersion(activeFlowRecord.id)}
                    className="px-2.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    انتشار این نسخه
                  </button>
                )}
              </div>
            )}

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
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handlePublishClick(true)}
                  className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  title="ساخت نسخه جدید از جریان فعلی"
                >
                  ذخیره نسخه جدید
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handlePublishClick(false)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'در حال ذخیره...' : 'ذخیره و انتشار'}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Node Addition Palette Strip */}
        <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-slate-100">
          <span className="text-xs font-semibold text-slate-500 ml-1">افزودن گره:</span>
          {(
            [
              'trigger',
              'message',
              'question',
              'condition',
              'delay',
              'booking_node',
              'catalog_browser',
              'survey_node',
              'tag_contact',
              'update_contact',
              'save_form',
            ] as NodeType[]
          ).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addNode(type)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-700" />
              <span>{NODE_TYPE_LABELS[type]}</span>
            </button>
          ))}
        </div>

        {/* Expandable Validation Diagnostics Drawer */}
        {showValidationPanel && (
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800">
                نتیجه اعتبارسنجی پیش از انتشار
              </span>
              {validation.errorCount > 0 && (
                <span className="text-red-700 font-medium">
                  برای انتشار، ابتدا خطاهای قرمز رنگ را برطرف کنید.
                </span>
              )}
            </div>
            {validation.issues.length === 0 ? (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                تمامی گره‌ها متصل، معتبر و آماده انتشار هستند.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {validation.issues.map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => {
                      if (issue.nodeId) {
                        setSelectedNodeId(issue.nodeId);
                        setRightPanelMode('inspector');
                      }
                    }}
                    className={`text-right p-2.5 rounded-lg border text-xs flex items-start gap-2 cursor-pointer transition-colors ${
                      issue.severity === 'error'
                        ? 'bg-red-50/70 border-red-200 text-red-900 hover:bg-red-50'
                        : 'bg-amber-50/70 border-amber-200 text-amber-900 hover:bg-amber-50'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{issue.message}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main 2-Pane Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Visual Canvas OR List View (8 columns) */}
        <div className="lg:col-span-8 space-y-4">
          {workspaceView === 'canvas' ? (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    بوم جریان گفتگو · {flowName}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                    {toPersianDigits(normalizedFlow.nodes.length)} گره
                    {activeFlowRecord && (
                      <>
                        {' · '}نسخه {toPersianDigits(activeFlowRecord.version)}
                        {activeFlowRecord.date_updated
                          ? ` · ${formatJalaliDateTime(activeFlowRecord.date_updated)}`
                          : ''}
                      </>
                    )}
                    {' · '}گره‌ها را بکشید یا با کلیک روی پورت خروجی به گره مقصد متصل کنید
                  </p>
                </div>
              </div>

              <FlowCanvas
                flow={normalizedFlow}
                selectedNodeId={selectedNode?.id || ''}
                validation={validation}
                onSelectNode={(id) => {
                  setSelectedNodeId(id);
                  if (rightPanelMode === 'json') setRightPanelMode('inspector');
                }}
                onUpdateNodePosition={updateNodePosition}
                onConnectEdge={connectEdge}
                onDisconnectEdge={disconnectEdge}
                onDeleteNode={deleteNode}
                onAutoLayout={() => onChangeFlow(autoLayoutFlow(normalizedFlow))}
              />

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  پیام پیش‌فرض (Fallback) در صورت نامفهوم بودن ورودی کاربر
                </label>
                <input
                  type="text"
                  value={normalizedFlow.fallbackText}
                  onChange={(e) => onChangeFlow({ ...normalizedFlow, fallbackText: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    درخت جریان گفتگو · {flowName}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                    تعداد گره‌ها: {toPersianDigits(normalizedFlow.nodes.length)} · برای ویرایش روی هر گره کلیک کنید
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {normalizedFlow.nodes.map((node, index) => {
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

                            {node.type === 'delay' && node.delayConfig && (
                              <p className="text-xs text-amber-800 tabular-nums">
                                تاخیر {toPersianDigits(node.delayConfig.delaySeconds)} ثانیه ·{' '}
                                {node.delayConfig.followUpText || 'ادامه جریان'}
                              </p>
                            )}

                            {node.type === 'tag_contact' && node.tagConfig && (
                              <p className="text-xs text-slate-600">
                                {node.tagConfig.action === 'add' ? 'افزودن برچسب: ' : 'حذف برچسب: '}
                                {node.tagConfig.tags.join('، ') || '—'}
                              </p>
                            )}

                            {node.type === 'update_contact' && (
                              <p className="text-xs text-slate-600">
                                به‌روزرسانی{' '}
                                {toPersianDigits((node.contactFieldMappings || []).length)} فیلد در
                                پروفایل مشتری
                              </p>
                            )}

                            {node.type === 'catalog_browser' && (
                              <p className="text-xs text-sky-800">
                                نمایش کاتالوگ (
                                {node.catalogConfig?.categoryFilter &&
                                node.catalogConfig.categoryFilter !== 'all'
                                  ? `دسته ${node.catalogConfig.categoryFilter}`
                                  : 'همه دسته‌ها'}
                                )
                              </p>
                            )}

                            {node.type === 'survey_node' && (
                              <p className="text-xs text-amber-800">
                                {node.surveyConfig?.surveyType === 'multi_choice'
                                  ? `نظرسنجی چندسوالی (${toPersianDigits(
                                      node.surveyConfig?.questions?.length || 1
                                    )} سوال)`
                                  : 'نظرسنجی امتیازی ۱ تا ۵ ستاره'}
                              </p>
                            )}

                            {node.type === 'booking_node' && (
                              <p className="text-xs text-emerald-800 tabular-nums">
                                رزرو نوبت شمسی برای {toPersianDigits(node.bookingConfig?.daysAhead || 7)}{' '}
                                روز آینده (
                                {node.bookingConfig?.defaultStatus === 'pending'
                                  ? 'در انتظار تایید'
                                  : 'تایید خودکار'}
                                )
                              </p>
                            )}
                          </div>

                          {normalizedFlow.nodes.length > 1 && (
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

                      {nextTitle && index < normalizedFlow.nodes.length - 1 && (
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
                  value={normalizedFlow.fallbackText}
                  onChange={(e) => onChangeFlow({ ...normalizedFlow, fallbackText: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Inspector / Simulator / JSON (4 columns) */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden sticky top-6">
          {rightPanelMode === 'inspector' && selectedNode && (
            <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  {getNodeIcon(selectedNode.type)}
                  <h3 className="text-sm font-bold text-slate-900">ویرایش گره</h3>
                </div>
                <div className="flex items-center gap-2">
                  {normalizedFlow.startNodeId !== selectedNode.id && selectedNode.type === 'trigger' && (
                    <button
                      type="button"
                      onClick={() => onChangeFlow({ ...normalizedFlow, startNodeId: selectedNode.id })}
                      className="text-[11px] font-medium text-emerald-700 hover:underline cursor-pointer"
                    >
                      تنظیم به‌عنوان نقطه شروع
                    </button>
                  )}
                  <code className="text-xs font-mono text-slate-400" dir="ltr">
                    {selectedNode.id}
                  </code>
                </div>
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
                selectedNode.type === 'delay' ||
                selectedNode.type === 'save_form') && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-700">
                      {selectedNode.type === 'delay'
                        ? 'پیام فوری پیش از تاخیر (اختیاری)'
                        : 'متن پیام بازو'}
                    </label>
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
                    rows={selectedNode.type === 'delay' ? 2 : 4}
                    value={selectedNode.messageText || ''}
                    onChange={(e) => updateNode(selectedNode.id, { messageText: e.target.value })}
                    className="w-full px-3 py-2 text-xs leading-6 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                  />
                </div>
              )}

              {selectedNode.type === 'delay' && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      مدت تاخیر پیش از ارسال پیام پیگیری (ثانیه)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={86400}
                        dir="ltr"
                        value={selectedNode.delayConfig?.delaySeconds ?? 10}
                        onChange={(e) =>
                          updateNode(selectedNode.id, {
                            delayConfig: {
                              ...selectedNode.delayConfig,
                              delaySeconds: Math.max(1, Number(e.target.value) || 1),
                            },
                          })
                        }
                        className="w-28 px-3 py-2 text-xs font-mono text-left border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                      />
                      <div className="flex items-center gap-1 flex-wrap">
                        {[
                          { label: '۱۰ ثانیه', secs: 10 },
                          { label: '۵ دقیقه', secs: 300 },
                          { label: '۱ ساعت', secs: 3600 },
                        ].map((preset) => (
                          <button
                            key={preset.secs}
                            type="button"
                            onClick={() =>
                              updateNode(selectedNode.id, {
                                delayConfig: {
                                  ...selectedNode.delayConfig,
                                  delaySeconds: preset.secs,
                                },
                              })
                            }
                            className="px-2.5 py-1.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md cursor-pointer"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      متن پیام پیگیری (پس از پایان تاخیر)
                    </label>
                    <textarea
                      rows={3}
                      value={selectedNode.delayConfig?.followUpText || ''}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          delayConfig: {
                            delaySeconds: selectedNode.delayConfig?.delaySeconds ?? 10,
                            ...selectedNode.delayConfig,
                            followUpText: e.target.value,
                          },
                        })
                      }
                      placeholder="سلام {{user.first_name}}، یادآوری پیگیری سفارش یا نوبت شما..."
                      className="w-full px-3 py-2 text-xs leading-6 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                    />
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedNode.delayConfig?.cancelIfReplied)}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          delayConfig: {
                            delaySeconds: selectedNode.delayConfig?.delaySeconds ?? 10,
                            ...selectedNode.delayConfig,
                            cancelIfReplied: e.target.checked,
                          },
                        })
                      }
                      className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                    />
                    <span>در صورت ارسال پیام جدید توسط کاربر پیش از پایان زمان، پیگیری لغو شود</span>
                  </label>
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

                  {selectedNode.inputType === 'phone' && (
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                      <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedNode.requestContact)}
                          onChange={(e) =>
                            updateNode(selectedNode.id, {
                              requestContact: e.target.checked,
                              requestContactButtonText:
                                selectedNode.requestContactButtonText || 'ارسال شماره موبایل من',
                            })
                          }
                          className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                        />
                        <span>نمایش دکمه بومی ارسال شماره تماس بله (request_contact)</span>
                      </label>

                      {selectedNode.requestContact && (
                        <div>
                          <label className="block text-[11px] text-slate-600 mb-1">
                            عنوان دکمه کیبورد بله
                          </label>
                          <input
                            type="text"
                            value={selectedNode.requestContactButtonText || ''}
                            onChange={(e) =>
                              updateNode(selectedNode.id, {
                                requestContactButtonText: e.target.value,
                              })
                            }
                            placeholder="ارسال شماره موبایل من"
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-emerald-600"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedNode.type === 'tag_contact' && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      نوع عملیات برچسب
                    </label>
                    <select
                      value={selectedNode.tagConfig?.action || 'add'}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          tagConfig: {
                            action: e.target.value as 'add' | 'remove',
                            tags: selectedNode.tagConfig?.tags || [],
                          },
                        })
                      }
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="add">افزودن برچسب‌ها به مشتری</option>
                      <option value="remove">حذف برچسب‌ها از مشتری</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      برچسب‌ها (با کاما جدا کنید)
                    </label>
                    <input
                      type="text"
                      value={(selectedNode.tagConfig?.tags || []).join('، ')}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          tagConfig: {
                            action: selectedNode.tagConfig?.action || 'add',
                            tags: e.target.value
                              .split(/[،,]/)
                              .map((t) => t.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                      placeholder="مثلاً: سرنخ جدید، خریدار"
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                </div>
              )}

              {selectedNode.type === 'update_contact' && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-700">
                      نگاشت پاسخ‌های فرم به پروفایل CRM
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const next: ContactFieldMapping[] = [
                          ...(selectedNode.contactFieldMappings || []),
                          { sessionKey: '', targetField: 'custom', customKey: '' },
                        ];
                        updateNode(selectedNode.id, { contactFieldMappings: next });
                      }}
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>افزودن فیلد</span>
                    </button>
                  </div>

                  {(selectedNode.contactFieldMappings || []).map((mapping, mIdx) => (
                    <div
                      key={mIdx}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2"
                    >
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          dir="ltr"
                          value={mapping.sessionKey}
                          onChange={(e) => {
                            const next = [...(selectedNode.contactFieldMappings || [])];
                            next[mIdx] = { ...mapping, sessionKey: e.target.value };
                            updateNode(selectedNode.id, { contactFieldMappings: next });
                          }}
                          placeholder="کلید سوال (مثلاً phone)"
                          className="px-2.5 py-1.5 text-xs font-mono text-left bg-white border border-slate-200 rounded-md"
                        />
                        <select
                          value={mapping.targetField}
                          onChange={(e) => {
                            const next = [...(selectedNode.contactFieldMappings || [])];
                            next[mIdx] = {
                              ...mapping,
                              targetField: e.target.value as ContactFieldMapping['targetField'],
                            };
                            updateNode(selectedNode.id, { contactFieldMappings: next });
                          }}
                          className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                        >
                          <option value="first_name">نام</option>
                          <option value="last_name">نام خانوادگی</option>
                          <option value="phone">شماره موبایل</option>
                          <option value="custom">فیلد سفارشی CRM</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        {mapping.targetField === 'custom' && (
                          <input
                            type="text"
                            dir="ltr"
                            value={mapping.customKey || ''}
                            onChange={(e) => {
                              const next = [...(selectedNode.contactFieldMappings || [])];
                              next[mIdx] = { ...mapping, customKey: e.target.value };
                              updateNode(selectedNode.id, { contactFieldMappings: next });
                            }}
                            placeholder="نام کلید در custom_fields"
                            className="flex-1 px-2.5 py-1.5 text-xs font-mono text-left bg-white border border-slate-200 rounded-md"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const next = (selectedNode.contactFieldMappings || []).filter(
                              (_, i) => i !== mIdx
                            );
                            updateNode(selectedNode.id, { contactFieldMappings: next });
                          }}
                          className="p-1 text-slate-400 hover:text-red-700 cursor-pointer mr-auto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedNode.type === 'save_form' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    عنوان فرم برای ذخیره در پایگاه داده
                  </label>
                  <input
                    type="text"
                    value={selectedNode.formTitle || ''}
                    onChange={(e) => updateNode(selectedNode.id, { formTitle: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                  />
                </div>
              )}

              {selectedNode.type === 'catalog_browser' && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      فیلتر دسته‌بندی پیش‌فرض کاتالوگ
                    </label>
                    <select
                      value={selectedNode.catalogConfig?.categoryFilter || 'all'}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          catalogConfig: {
                            ...selectedNode.catalogConfig,
                            categoryFilter: e.target.value,
                          },
                        })
                      }
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="all">همه دسته‌بندی‌ها (با دکمه تغییر دسته در بله)</option>
                      {Array.from(
                        new Set(products.map((p) => (p.category || '').trim()).filter(Boolean))
                      ).map((cat) => (
                        <option key={cat} value={cat}>
                          فقط دسته: {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedNode.catalogConfig?.allowCart !== false}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          catalogConfig: {
                            ...selectedNode.catalogConfig,
                            allowCart: e.target.checked,
                          },
                        })
                      }
                      className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                    />
                    <span>فعال‌سازی سبد خرید و ثبت سفارش درون‌بله</span>
                  </label>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      پیام تایید ثبت سفارش
                    </label>
                    <input
                      type="text"
                      value={selectedNode.catalogConfig?.checkoutConfirmText || ''}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          catalogConfig: {
                            ...selectedNode.catalogConfig,
                            checkoutConfirmText: e.target.value,
                          },
                        })
                      }
                      placeholder="✅ سفارش شما با موفقیت ثبت شد!"
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      پیام در صورت خالی بودن کاتالوگ
                    </label>
                    <input
                      type="text"
                      value={selectedNode.catalogConfig?.emptyText || ''}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          catalogConfig: {
                            ...selectedNode.catalogConfig,
                            emptyText: e.target.value,
                          },
                        })
                      }
                      placeholder="در حال حاضر محصول فعالی موجود نیست."
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
              )}

              {selectedNode.type === 'survey_node' && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  {surveys.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        اتصال به نظرسنجی ساخته‌شده (اختیاری)
                      </label>
                      <select
                        value={selectedNode.surveyConfig?.surveyId || ''}
                        onChange={(e) => {
                          const targetSurvey = surveys.find((s) => s.id === e.target.value);
                          updateNode(selectedNode.id, {
                            surveyConfig: {
                              surveyType:
                                targetSurvey?.type ||
                                selectedNode.surveyConfig?.surveyType ||
                                'rating',
                              ...selectedNode.surveyConfig,
                              surveyId: e.target.value || undefined,
                            },
                          });
                        }}
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="">تنظیم دستی مستقیم در همین گره</option>
                        {surveys.map((srv) => (
                          <option key={srv.id} value={srv.id}>
                            {srv.title} ({srv.type === 'rating' ? 'امتیازی' : 'چندسوالی'})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {!selectedNode.surveyConfig?.surveyId && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          نوع نظرسنجی
                        </label>
                        <select
                          value={selectedNode.surveyConfig?.surveyType || 'rating'}
                          onChange={(e) =>
                            updateNode(selectedNode.id, {
                              surveyConfig: {
                                ...selectedNode.surveyConfig,
                                surveyType: e.target.value as 'rating' | 'multi_choice',
                                questions:
                                  e.target.value === 'multi_choice' &&
                                  (!selectedNode.surveyConfig?.questions ||
                                    selectedNode.surveyConfig.questions.length === 0)
                                    ? [
                                        {
                                          id: `q_${Date.now().toString(36)}`,
                                          text: 'کیفیت خدمات ما را چگونه ارزیابی می‌کنید؟',
                                          type: 'rating',
                                        },
                                      ]
                                    : selectedNode.surveyConfig?.questions,
                              },
                            })
                          }
                          className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                        >
                          <option value="rating">امتیازدهی سریع ۱ تا ۵ ستاره</option>
                          <option value="multi_choice">چندسوالی (تستی / متنی / امتیازی)</option>
                        </select>
                      </div>

                      {(selectedNode.surveyConfig?.surveyType || 'rating') === 'rating' ? (
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            متن سوال نظرسنجی
                          </label>
                          <textarea
                            rows={2}
                            value={selectedNode.surveyConfig?.questionText || ''}
                            onChange={(e) =>
                              updateNode(selectedNode.id, {
                                surveyConfig: {
                                  surveyType: 'rating',
                                  ...selectedNode.surveyConfig,
                                  questionText: e.target.value,
                                },
                              })
                            }
                            placeholder="چقدر از خدمات ما رضایت داشتید؟"
                            className="w-full px-3 py-2 text-xs leading-6 border border-slate-200 rounded-lg"
                          />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-700">سوالات نظرسنجی</span>
                            <button
                              type="button"
                              onClick={() => {
                                const nextQ: SurveyQuestionItem = {
                                  id: `q_${Date.now().toString(36)}`,
                                  text: 'سوال جدید',
                                  type: 'choice',
                                  options: ['عالی', 'متوسط', 'نیاز به بهبود'],
                                };
                                updateNode(selectedNode.id, {
                                  surveyConfig: {
                                    surveyType: 'multi_choice',
                                    ...selectedNode.surveyConfig,
                                    questions: [...(selectedNode.surveyConfig?.questions || []), nextQ],
                                  },
                                });
                              }}
                              className="text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
                            >
                              + افزودن سوال
                            </button>
                          </div>
                          {(selectedNode.surveyConfig?.questions || []).map((q, qIdx) => (
                            <div
                              key={q.id}
                              className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2"
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={q.text}
                                  onChange={(e) => {
                                    const next = [...(selectedNode.surveyConfig?.questions || [])];
                                    next[qIdx] = { ...q, text: e.target.value };
                                    updateNode(selectedNode.id, {
                                      surveyConfig: {
                                        surveyType: 'multi_choice',
                                        ...selectedNode.surveyConfig,
                                        questions: next,
                                      },
                                    });
                                  }}
                                  className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                                />
                                <select
                                  value={q.type}
                                  onChange={(e) => {
                                    const next = [...(selectedNode.surveyConfig?.questions || [])];
                                    next[qIdx] = {
                                      ...q,
                                      type: e.target.value as SurveyQuestionItem['type'],
                                      options:
                                        e.target.value === 'choice' && !q.options?.length
                                          ? ['گزینه ۱', 'گزینه ۲']
                                          : q.options,
                                    };
                                    updateNode(selectedNode.id, {
                                      surveyConfig: {
                                        surveyType: 'multi_choice',
                                        ...selectedNode.surveyConfig,
                                        questions: next,
                                      },
                                    });
                                  }}
                                  className="px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                                >
                                  <option value="rating">امتیاز ۱-۵</option>
                                  <option value="choice">چندگزینه‌ای</option>
                                  <option value="text">متنی آزاد</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = (selectedNode.surveyConfig?.questions || []).filter(
                                      (_, i) => i !== qIdx
                                    );
                                    updateNode(selectedNode.id, {
                                      surveyConfig: {
                                        surveyType: 'multi_choice',
                                        ...selectedNode.surveyConfig,
                                        questions: next,
                                      },
                                    });
                                  }}
                                  className="p-1 text-slate-400 hover:text-red-700 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              {q.type === 'choice' && (
                                <input
                                  type="text"
                                  value={(q.options || []).join('، ')}
                                  onChange={(e) => {
                                    const next = [...(selectedNode.surveyConfig?.questions || [])];
                                    next[qIdx] = {
                                      ...q,
                                      options: e.target.value
                                        .split(/[،,]/)
                                        .map((o) => o.trim())
                                        .filter(Boolean),
                                    };
                                    updateNode(selectedNode.id, {
                                      surveyConfig: {
                                        surveyType: 'multi_choice',
                                        ...selectedNode.surveyConfig,
                                        questions: next,
                                      },
                                    });
                                  }}
                                  placeholder="گزینه‌ها را با کاما جدا کنید"
                                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        سقف امتیاز پایین (≤)
                      </label>
                      <select
                        value={selectedNode.surveyConfig?.lowScoreThreshold ?? 3}
                        onChange={(e) =>
                          updateNode(selectedNode.id, {
                            surveyConfig: {
                              surveyType: selectedNode.surveyConfig?.surveyType || 'rating',
                              ...selectedNode.surveyConfig,
                              lowScoreThreshold: Number(e.target.value),
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value={1}>۱ یا کمتر</option>
                        <option value={2}>۲ یا کمتر</option>
                        <option value={3}>۳ یا کمتر</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        گره مسیر امتیاز پایین
                      </label>
                      <select
                        value={selectedNode.surveyConfig?.lowScoreNodeId || ''}
                        onChange={(e) =>
                          updateNode(selectedNode.id, {
                            surveyConfig: {
                              surveyType: selectedNode.surveyConfig?.surveyType || 'rating',
                              ...selectedNode.surveyConfig,
                              lowScoreNodeId: e.target.value,
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="">ندارد (ادامه مسیر عادی)</option>
                        {normalizedFlow.nodes
                          .filter((n) => n.id !== selectedNode.id)
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.title}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      پیام تشکر (در صورت نبود گره بعدی)
                    </label>
                    <input
                      type="text"
                      value={selectedNode.surveyConfig?.thankYouText || ''}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          surveyConfig: {
                            surveyType: selectedNode.surveyConfig?.surveyType || 'rating',
                            ...selectedNode.surveyConfig,
                            thankYouText: e.target.value,
                          },
                        })
                      }
                      placeholder="با تشکر از ثبت نظر ارزشمند شما!"
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
              )}

              {selectedNode.type === 'booking_node' && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      انتخاب خدمت پیش‌فرض (اختیاری)
                    </label>
                    <select
                      value={selectedNode.bookingConfig?.serviceId || ''}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          bookingConfig: {
                            ...selectedNode.bookingConfig,
                            serviceId: e.target.value || undefined,
                          },
                        })
                      }
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="">نمایش همه خدمات فعال نوبت‌دهی</option>
                      {bookingServices.map((svc) => (
                        <option key={svc.id} value={svc.id}>
                          {svc.title} ({toPersianDigits(svc.duration_minutes)} دقیقه)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        تعداد روزهای باز تقویم
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        dir="ltr"
                        value={selectedNode.bookingConfig?.daysAhead ?? 7}
                        onChange={(e) =>
                          updateNode(selectedNode.id, {
                            bookingConfig: {
                              ...selectedNode.bookingConfig,
                              daysAhead: Math.max(1, Math.min(30, Number(e.target.value) || 7)),
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs font-mono text-left border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        وضعیت اولیه نوبت ثبت‌شده
                      </label>
                      <select
                        value={selectedNode.bookingConfig?.defaultStatus || 'confirmed'}
                        onChange={(e) =>
                          updateNode(selectedNode.id, {
                            bookingConfig: {
                              ...selectedNode.bookingConfig,
                              defaultStatus: e.target.value as 'confirmed' | 'pending',
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="confirmed">تایید خودکار (confirmed)</option>
                        <option value="pending">در انتظار تایید اپراتور (pending)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      پیام خوش‌آمد نوبت‌دهی
                    </label>
                    <textarea
                      rows={2}
                      value={selectedNode.bookingConfig?.introText || ''}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          bookingConfig: {
                            ...selectedNode.bookingConfig,
                            introText: e.target.value,
                          },
                        })
                      }
                      placeholder="سلام {{user.first_name}}، خدمت مورد نظر را انتخاب کنید:"
                      className="w-full px-3 py-2 text-xs leading-6 border border-slate-200 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      پیام تایید ثبت نوبت
                    </label>
                    <input
                      type="text"
                      value={selectedNode.bookingConfig?.confirmText || ''}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          bookingConfig: {
                            ...selectedNode.bookingConfig,
                            confirmText: e.target.value,
                          },
                        })
                      }
                      placeholder="✅ نوبت شما با موفقیت ثبت شد!"
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      پیام در صورت نبود ساعت آزاد
                    </label>
                    <input
                      type="text"
                      value={selectedNode.bookingConfig?.emptySlotsText || ''}
                      onChange={(e) =>
                        updateNode(selectedNode.id, {
                          bookingConfig: {
                            ...selectedNode.bookingConfig,
                            emptySlotsText: e.target.value,
                          },
                        })
                      }
                      placeholder="متاسفانه در روزهای آینده ساعت آزادی وجود ندارد."
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
              )}

              {selectedNode.type === 'condition' && selectedNode.condition && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      منبع مقایسه (فیلد فرم یا پروفایل CRM)
                    </label>
                    <select
                      value={
                        isCustomConditionSource ? '__custom__' : selectedNode.condition.sourceKey
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        updateNode(selectedNode.id, {
                          condition: {
                            ...selectedNode.condition!,
                            sourceKey: val === '__custom__' ? 'contact.custom.' : val,
                          },
                        });
                      }}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                    >
                      {presetConditionSources.map((src) => (
                        <option key={src.value} value={src.value}>
                          {src.label}
                        </option>
                      ))}
                      <option value="__custom__">کلید سفارشی CRM (contact.custom.*)</option>
                    </select>
                  </div>

                  {isCustomConditionSource && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        نام کلید سفارشی
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
                        placeholder="contact.custom.city"
                        className="w-full px-3 py-2 text-xs font-mono text-left border border-slate-200 rounded-lg"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">عملگر</label>
                      <select
                        value={selectedNode.condition.operator}
                        onChange={(e) =>
                          updateNode(selectedNode.id, {
                            condition: {
                              ...selectedNode.condition!,
                              operator: e.target.value as ConditionOperator,
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="equals">برابر با</option>
                        <option value="not_equals">مخالف با</option>
                        <option value="contains">شامل متن / برچسب</option>
                        <option value="not_contains">فاقد متن / برچسب</option>
                        <option value="not_empty">خالی نباشد</option>
                        <option value="greater_than">بزرگ‌تر از (عددی)</option>
                        <option value="less_than">کوچک‌تر از (عددی)</option>
                      </select>
                    </div>
                    {selectedNode.condition.operator !== 'not_empty' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          مقدار مقایسه
                        </label>
                        <input
                          type="text"
                          value={selectedNode.condition.value}
                          onChange={(e) =>
                            updateNode(selectedNode.id, {
                              condition: { ...selectedNode.condition!, value: e.target.value },
                            })
                          }
                          placeholder="مثلاً: VIP یا 4"
                          className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                        />
                      </div>
                    )}
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
                        {normalizedFlow.nodes
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
                        {normalizedFlow.nodes
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
                        {normalizedFlow.nodes
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
                    {normalizedFlow.nodes
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
            <div className="flex flex-col h-[640px]">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">شبیه‌ساز زنده پیام‌رسان بله</h3>
                    <p className="text-[11px] text-slate-500">
                      اجرای مستقیم موتور FlowExecutionEngine سرور
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => resetSimulator()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>شروع مجدد</span>
                  </button>
                </div>

                {/* Simulate CRM tag toggle for testing VIP branches */}
                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200/70 text-[11px]">
                  <span className="text-slate-600">شبیه‌سازی مشتری با تگ:</span>
                  <div className="flex items-center gap-1">
                    {['VIP', 'خریدار قبلی'].map((tag) => {
                      const active = simInitialTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => {
                            const next = active
                              ? simInitialTags.filter((t) => t !== tag)
                              : [...simInitialTags, tag];
                            setSimInitialTags(next);
                            void resetSimulator(next);
                          }}
                          className={`px-2 py-0.5 rounded font-medium cursor-pointer transition-colors ${
                            active
                              ? 'bg-emerald-700 text-white'
                              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
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
                    {msg.scheduledFollowUps && msg.scheduledFollowUps.length > 0 ? (
                      <div className="max-w-[90%] rounded-xl px-3.5 py-2.5 bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
                        {msg.scheduledFollowUps.map((item) => (
                          <div key={item.nodeId} className="space-y-1.5">
                            <div className="flex items-center gap-1.5 font-semibold tabular-nums">
                              <Clock className="w-3.5 h-3.5 text-amber-700" />
                              <span>
                                زمان‌بندی تاخیر ({toPersianDigits(item.delaySeconds)} ثانیه)
                              </span>
                            </div>
                            {item.followUpText && (
                              <p className="text-amber-900/90 leading-5 whitespace-pre-line">
                                {item.followUpText}
                              </p>
                            )}
                            <button
                              type="button"
                              disabled={simSending}
                              onClick={() => triggerScheduledFollowUpInSimulator(item)}
                              className="px-2.5 py-1 text-[11px] font-medium bg-white border border-amber-300 hover:bg-amber-100/60 rounded-md cursor-pointer"
                            >
                              اجرای فوری پیام پیگیری در شبیه‌ساز
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div
                        className={`max-w-[85%] rounded-xl overflow-hidden text-xs leading-6 whitespace-pre-line ${
                          msg.sender === 'user'
                            ? 'bg-emerald-700 text-white px-3.5 py-2.5'
                            : 'bg-white border border-slate-200 text-slate-800'
                        }`}
                      >
                        {msg.photoUrl && (
                          <div className="w-full h-36 bg-slate-100 border-b border-slate-100 overflow-hidden">
                            <img
                              src={msg.photoUrl}
                              alt="تصویر محصول"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                              }}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        <div className={msg.sender === 'bot' ? 'px-3.5 py-2.5' : ''}>
                          {msg.text}
                        </div>
                      </div>
                    )}

                    {msg.replyMarkup &&
                      'inline_keyboard' in msg.replyMarkup &&
                      (msg.replyMarkup as BaleInlineKeyboardMarkup).inline_keyboard && (
                        <div className="mt-1.5 flex flex-col gap-1 w-[85%]">
                          {(msg.replyMarkup as BaleInlineKeyboardMarkup).inline_keyboard.map(
                            (row, rIdx) => (
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
                            )
                          )}
                        </div>
                      )}

                    {msg.replyMarkup &&
                      'keyboard' in msg.replyMarkup &&
                      (msg.replyMarkup as BaleReplyKeyboardMarkup).keyboard && (
                        <div className="mt-1.5 flex flex-col gap-1 w-[85%]">
                          {(msg.replyMarkup as BaleReplyKeyboardMarkup).keyboard.map((row, rIdx) => (
                            <div key={rIdx} className="flex gap-1">
                              {row.map((btn, bIdx) => (
                                <button
                                  key={bIdx}
                                  type="button"
                                  disabled={simSending}
                                  onClick={() =>
                                    btn.request_contact
                                      ? sendSimulatedMessage(
                                          undefined,
                                          undefined,
                                          btn.text,
                                          '09123456789'
                                        )
                                      : sendSimulatedMessage(btn.text)
                                  }
                                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                                >
                                  {btn.request_contact && (
                                    <Phone className="w-3.5 h-3.5 text-emerald-700" />
                                  )}
                                  <span>{btn.text}</span>
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

              {(Object.keys(simContext).some((k) => !k.startsWith('__')) || simTags.length > 0) && (
                <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-600 flex items-center gap-2 flex-wrap">
                  {Object.keys(simContext).some((k) => !k.startsWith('__')) && (
                    <>
                      <span className="font-semibold text-slate-700">حافظه نشست:</span>
                      {Object.entries(simContext)
                        .filter(([k]) => !k.startsWith('__'))
                        .map(([k, v]) => (
                          <span key={k} className="font-mono">
                            {k}={v}
                          </span>
                        ))}
                    </>
                  )}
                  {simTags.length > 0 && (
                    <>
                      <span className="font-semibold text-emerald-800">برچسب CRM:</span>
                      <span>{simTags.join(' · ')}</span>
                    </>
                  )}
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

      <TemplateGalleryModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onSelectTemplate={handleApplyTemplate}
      />
    </div>
  );
}
