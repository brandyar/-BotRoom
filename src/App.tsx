import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bot,
  CalendarCheck,
  FileSpreadsheet,
  LogOut,
  Megaphone,
  ShoppingBag,
  Users,
  Workflow,
} from 'lucide-react';
import { AuthScreen } from './components/AuthScreen.tsx';
import { BookingView } from './components/BookingView.tsx';
import { BotsOverviewView } from './components/BotsOverviewView.tsx';
import { BroadcastView } from './components/BroadcastView.tsx';
import { CatalogOrdersView } from './components/CatalogOrdersView.tsx';
import { CollectedFormsView } from './components/CollectedFormsView.tsx';
import { ContactsView } from './components/ContactsView.tsx';
import { FlowBuilderView } from './components/FlowBuilderView.tsx';
import { SurveysView } from './components/SurveysView.tsx';
import { WebhookLogsView } from './components/WebhookLogsView.tsx';
import { api, ApiError, type AuthResponse, type HealthResponse } from './lib/api.ts';
import type {
  AppointmentRecord,
  AuthUser,
  BookingScheduleRecord,
  BookingServiceRecord,
  BotContactRecord,
  BotFlowRecord,
  BotOrderRecord,
  BotRecord,
  BotSessionRecord,
  BroadcastCampaignRecord,
  CollectedFormRecord,
  FlowDefinition,
  ProductRecord,
  SurveyRecord,
  SurveyResponseRecord,
  WebhookLogRecord,
} from './types/bot.ts';

type NavTab =
  | 'bots'
  | 'flow'
  | 'contacts'
  | 'booking'
  | 'catalog'
  | 'broadcast'
  | 'surveys'
  | 'forms'
  | 'logs';

const AUTH_STORAGE_KEY = 'balesaz_auth_session';

const EMPTY_FLOW: FlowDefinition = {
  startNodeId: 'node_start',
  fallbackText: 'برای شروع عبارت /start را ارسال کنید.',
  nodes: [
    {
      id: 'node_start',
      type: 'trigger',
      title: 'شروع گفتگو (/start)',
      triggerPattern: '/start',
      nextNodeId: 'node_welcome',
    },
    {
      id: 'node_welcome',
      type: 'message',
      title: 'پیام خوش‌آمدگویی',
      messageText: 'سلام {{user.first_name}}! خوش آمدید.',
    },
  ],
};

const TAB_TITLES: Record<NavTab, string> = {
  bots: 'بازوها و اتصال وب‌هوک',
  flow: 'طراح جریان گفتگو',
  contacts: 'مشتریان و مخاطبین بله (CRM)',
  booking: 'رزرو و نوبت‌دهی شمسی',
  catalog: 'کاتالوگ محصولات و سفارش‌ها',
  broadcast: 'ارسال پیام گروهی (کمپین‌ها)',
  surveys: 'نظرسنجی‌ها و تحلیل رضایت',
  forms: 'داده‌های فرم‌های جمع‌آوری‌شده',
  logs: 'گزارش وب‌هوک‌ها و نشست‌ها',
};

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const [activeTab, setActiveTab] = useState<NavTab>('bots');
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [loadingBots, setLoadingBots] = useState(false);

  const [flowId, setFlowId] = useState<string | null>(null);
  const [flowName, setFlowName] = useState('جریان اصلی گفتگو');
  const [flows, setFlows] = useState<BotFlowRecord[]>([]);
  const [flow, setFlow] = useState<FlowDefinition>(EMPTY_FLOW);
  const [savingFlow, setSavingFlow] = useState(false);

  const [contacts, setContacts] = useState<BotContactRecord[]>([]);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [orders, setOrders] = useState<BotOrderRecord[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [surveys, setSurveys] = useState<SurveyRecord[]>([]);
  const [surveyResponses, setSurveyResponses] = useState<SurveyResponseRecord[]>([]);
  const [surveysError, setSurveysError] = useState<string | null>(null);
  const [bookingServices, setBookingServices] = useState<BookingServiceRecord[]>([]);
  const [bookingSchedules, setBookingSchedules] = useState<BookingScheduleRecord[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<BroadcastCampaignRecord[]>([]);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [forms, setForms] = useState<CollectedFormRecord[]>([]);
  const [logs, setLogs] = useState<WebhookLogRecord[]>([]);
  const [sessions, setSessions] = useState<BotSessionRecord[]>([]);
  const [loadingBotData, setLoadingBotData] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const toastTimerRef = useRef<number | null>(null);

  const selectedBot = useMemo(
    () => bots.find((b) => b.id === selectedBotId) || null,
    [bots, selectedBotId]
  );

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Load initial health, default flow, and stored auth session
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [healthRes, defaultFlowRes] = await Promise.all([
          api.health().catch(() => null),
          api.getDefaultFlow().catch(() => null),
        ]);

        if (cancelled) return;
        if (healthRes) setHealth(healthRes);
        if (defaultFlowRes?.flow) setFlow(defaultFlowRes.flow);

        const rawSaved = sessionStorage.getItem(AUTH_STORAGE_KEY);
        if (rawSaved) {
          const parsed = JSON.parse(rawSaved) as {
            access_token?: string;
            refresh_token?: string;
            user?: AuthUser;
          };
          if (parsed.access_token) {
            try {
              const me = await api.me(parsed.access_token);
              if (!cancelled) {
                setToken(parsed.access_token);
                setRefreshToken(parsed.refresh_token || null);
                setUser(me.user);
              }
            } catch {
              if (parsed.refresh_token) {
                try {
                  const refreshed = await api.refresh(parsed.refresh_token);
                  const me = await api.me(refreshed.access_token);
                  if (!cancelled) {
                    setToken(refreshed.access_token);
                    setRefreshToken(refreshed.refresh_token);
                    setUser(me.user);
                    sessionStorage.setItem(
                      AUTH_STORAGE_KEY,
                      JSON.stringify({
                        access_token: refreshed.access_token,
                        refresh_token: refreshed.refresh_token,
                        user: me.user,
                      })
                    );
                  }
                } catch {
                  sessionStorage.removeItem(AUTH_STORAGE_KEY);
                }
              } else {
                sessionStorage.removeItem(AUTH_STORAGE_KEY);
              }
            }
          }
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadBots = useCallback(async () => {
    if (!token) return;
    setLoadingBots(true);
    try {
      const res = await api.listBots(token);
      setBots(res.bots);
      setSelectedBotId((prev) => {
        if (prev && res.bots.some((b) => b.id === prev)) return prev;
        return res.bots[0]?.id || null;
      });
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'خطا در دریافت لیست بازوها');
    } finally {
      setLoadingBots(false);
    }
  }, [token, showToast]);

  const loadSelectedBotDetails = useCallback(async () => {
    if (!token || !selectedBotId) return;
    setLoadingBotData(true);
    setContactsError(null);
    setCatalogError(null);
    setSurveysError(null);
    setBookingError(null);
    setBroadcastError(null);
    try {
      const [
        flowRes,
        formsRes,
        logsRes,
        sessionsRes,
        contactsRes,
        productsRes,
        ordersRes,
        surveysRes,
        surveyResponsesRes,
        bookingServicesRes,
        bookingSchedulesRes,
        appointmentsRes,
        campaignsRes,
      ] = await Promise.all([
        api.getBotFlow(token, selectedBotId),
        api.listForms(token, selectedBotId),
        api.listLogs(token, selectedBotId),
        api.listSessions(token, selectedBotId),
        api.listContacts(token, selectedBotId).catch((err) => {
          setContactsError(
            err instanceof ApiError
              ? err.message
              : 'مجموعه bot_contacts در سرور پایگاه داده ساخته نشده یا دسترسی آن تنظیم نشده است.'
          );
          return { contacts: [] as BotContactRecord[] };
        }),
        api.listProducts(token, selectedBotId).catch((err) => {
          setCatalogError(
            err instanceof ApiError
              ? err.message
              : 'مجموعه‌های products یا bot_orders در سرور پایگاه داده ساخته نشده یا دسترسی آن‌ها تنظیم نشده است.'
          );
          return { products: [] as ProductRecord[] };
        }),
        api.listOrders(token, selectedBotId).catch((err) => {
          setCatalogError((prev) =>
            prev ||
            (err instanceof ApiError
              ? err.message
              : 'مجموعه‌های products یا bot_orders در سرور پایگاه داده ساخته نشده یا دسترسی آن‌ها تنظیم نشده است.')
          );
          return { orders: [] as BotOrderRecord[] };
        }),
        api.listSurveys(token, selectedBotId).catch((err) => {
          setSurveysError(
            err instanceof ApiError
              ? err.message
              : 'مجموعه‌های surveys یا survey_responses در سرور پایگاه داده ساخته نشده یا دسترسی آن‌ها تنظیم نشده است.'
          );
          return { surveys: [] as SurveyRecord[] };
        }),
        api.listSurveyResponses(token, selectedBotId).catch((err) => {
          setSurveysError((prev) =>
            prev ||
            (err instanceof ApiError
              ? err.message
              : 'مجموعه‌های surveys یا survey_responses در سرور پایگاه داده ساخته نشده یا دسترسی آن‌ها تنظیم نشده است.')
          );
          return { responses: [] as SurveyResponseRecord[] };
        }),
        api.listBookingServices(token, selectedBotId).catch((err) => {
          setBookingError(
            err instanceof ApiError
              ? err.message
              : 'مجموعه‌های نوبت‌دهی (booking_services / booking_schedules / appointments) در سرور پایگاه داده ساخته نشده‌اند.'
          );
          return { services: [] as BookingServiceRecord[] };
        }),
        api.listBookingSchedules(token, selectedBotId).catch((err) => {
          setBookingError((prev) =>
            prev ||
            (err instanceof ApiError
              ? err.message
              : 'مجموعه‌های نوبت‌دهی در سرور پایگاه داده ساخته نشده‌اند.')
          );
          return { schedules: [] as BookingScheduleRecord[] };
        }),
        api.listAppointments(token, selectedBotId).catch((err) => {
          setBookingError((prev) =>
            prev ||
            (err instanceof ApiError
              ? err.message
              : 'مجموعه appointments در سرور پایگاه داده ساخته نشده یا دسترسی آن تنظیم نشده است.')
          );
          return { appointments: [] as AppointmentRecord[] };
        }),
        api.listCampaigns(token, selectedBotId).catch((err) => {
          setBroadcastError(
            err instanceof ApiError
              ? err.message
              : 'مجموعه broadcast_campaigns در سرور پایگاه داده ساخته نشده یا دسترسی آن تنظیم نشده است.'
          );
          return { campaigns: [] as BroadcastCampaignRecord[] };
        }),
      ]);

      setFlows(flowRes.flows || []);
      const preferredFlow =
        flowRes.flows?.find((f) => f.is_published) || flowRes.flow || flowRes.flows?.[0] || null;
      if (preferredFlow) {
        setFlowId(preferredFlow.id);
        setFlowName(preferredFlow.name);
        setFlow(preferredFlow.flow_json);
      } else {
        setFlowId(null);
        const def = await api.getDefaultFlow().catch(() => null);
        if (def?.flow) setFlow(def.flow);
      }

      setForms(formsRes.forms);
      setLogs(logsRes.logs);
      setSessions(sessionsRes.sessions);
      setContacts(contactsRes.contacts);
      setProducts(productsRes.products);
      setOrders(ordersRes.orders);
      setSurveys(surveysRes.surveys);
      setSurveyResponses(surveyResponsesRes.responses);
      setBookingServices(bookingServicesRes.services);
      setBookingSchedules(bookingSchedulesRes.schedules);
      setAppointments(appointmentsRes.appointments);
      setCampaigns(campaignsRes.campaigns);
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'خطا در دریافت اطلاعات بازو');
    } finally {
      setLoadingBotData(false);
    }
  }, [token, selectedBotId, showToast]);

  useEffect(() => {
    if (token) {
      void loadBots();
    }
  }, [token, loadBots]);

  useEffect(() => {
    if (token && selectedBotId) {
      void loadSelectedBotDetails();
    }
  }, [token, selectedBotId, loadSelectedBotDetails]);

  function handleAuthenticated(auth: AuthResponse) {
    setToken(auth.access_token);
    setRefreshToken(auth.refresh_token);
    setUser(auth.user);
    setPreviewMode(false);
    setActiveTab('bots');
    sessionStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        access_token: auth.access_token,
        refresh_token: auth.refresh_token,
        user: auth.user,
      })
    );
  }

  async function handleLogout() {
    await api.logout(refreshToken).catch(() => undefined);
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    setToken(null);
    setRefreshToken(null);
    setUser(null);
    setBots([]);
    setFlows([]);
    setContacts([]);
    setContactsError(null);
    setProducts([]);
    setOrders([]);
    setCatalogError(null);
    setSurveys([]);
    setSurveyResponses([]);
    setSurveysError(null);
    setBookingServices([]);
    setBookingSchedules([]);
    setAppointments([]);
    setBookingError(null);
    setCampaigns([]);
    setBroadcastError(null);
    setSelectedBotId(null);
    setPreviewMode(false);
  }

  async function handleSaveFlow(options?: { saveAsNewVersion?: boolean }) {
    if (!token || !selectedBotId) return;
    setSavingFlow(true);
    try {
      const res = await api.saveBotFlow(token, selectedBotId, {
        flowId: flowId || undefined,
        name: flowName,
        flow_json: flow,
        is_published: true,
        saveAsNewVersion: Boolean(options?.saveAsNewVersion),
      });
      setFlowId(res.flow.id);
      if (res.flows) setFlows(res.flows);
      showToast(
        'success',
        options?.saveAsNewVersion
          ? `نسخه جدید (${res.flow.version}) با موفقیت ذخیره و منتشر شد.`
          : 'جریان گفتگو با موفقیت ذخیره و منتشر شد.'
      );
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'ذخیره جریان ناموفق بود.');
    } finally {
      setSavingFlow(false);
    }
  }

  function handleSelectFlowVersion(flowRecord: BotFlowRecord) {
    setFlowId(flowRecord.id);
    setFlowName(flowRecord.name);
    setFlow(flowRecord.flow_json);
  }

  async function handlePublishFlowVersion(targetFlowId: string) {
    if (!token || !selectedBotId) return;
    setSavingFlow(true);
    try {
      const res = await api.publishBotFlowVersion(token, selectedBotId, targetFlowId);
      setFlowId(res.flow.id);
      setFlowName(res.flow.name);
      setFlow(res.flow.flow_json);
      if (res.flows) setFlows(res.flows);
      showToast('success', `نسخه ${res.flow.version} به‌عنوان نسخه فعال منتشر شد.`);
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'انتشار نسخه ناموفق بود.');
    } finally {
      setSavingFlow(false);
    }
  }

  if (initializing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        در حال بارگذاری فضای کاری...
      </div>
    );
  }

  if (!token && !previewMode) {
    return (
      <AuthScreen
        health={health}
        onAuthenticated={handleAuthenticated}
        onOpenPreviewStudio={() => {
          setPreviewMode(true);
          setActiveTab('flow');
        }}
      />
    );
  }

  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode }> = [
    { id: 'bots', label: 'بازوها و وب‌هوک', icon: <Bot className="w-4 h-4" /> },
    { id: 'flow', label: 'طراح جریان گفتگو', icon: <Workflow className="w-4 h-4" /> },
    { id: 'contacts', label: 'مشتریان و مخاطبین', icon: <Users className="w-4 h-4" /> },
    { id: 'booking', label: 'رزرو و نوبت‌دهی', icon: <CalendarCheck className="w-4 h-4" /> },
    { id: 'catalog', label: 'کاتالوگ و سفارش‌ها', icon: <ShoppingBag className="w-4 h-4" /> },
    { id: 'broadcast', label: 'ارسال پیام گروهی', icon: <Megaphone className="w-4 h-4" /> },
    { id: 'surveys', label: 'نظرسنجی و آمار', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'forms', label: 'داده‌های فرم‌ها', icon: <FileSpreadsheet className="w-4 h-4" /> },
    { id: 'logs', label: 'گزارش وب‌هوک‌ها', icon: <Activity className="w-4 h-4" /> },
  ];

  const userDisplayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email
    : 'حالت پیش‌نمایش و شبیه‌ساز';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Right Sidebar (RTL) */}
      <aside className="w-full lg:w-64 bg-white border-b lg:border-b-0 lg:border-l border-slate-200 flex flex-col justify-between shrink-0">
        <div>
          <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <span className="text-base font-bold text-slate-900 whitespace-nowrap">بات‌روم</span>
          </div>

          {bots.length > 0 && (
            <div className="p-4 border-b border-slate-200">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">
                بازوی فعال
              </label>
              <select
                value={selectedBotId || ''}
                onChange={(e) => setSelectedBotId(e.target.value)}
                className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              >
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} {b.bale_username ? `(${b.bale_username})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-emerald-50 text-emerald-800'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className={active ? 'text-emerald-700' : 'text-slate-400'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 truncate">{userDisplayName}</p>
            <p className="text-[11px] text-slate-500 truncate">
              {user ? user.email : 'بدون ورود به حساب کاربری'}
            </p>
          </div>
          {token ? (
            <button
              type="button"
              onClick={handleLogout}
              title="خروج از حساب"
              className="p-2 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-100 shrink-0 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setPreviewMode(false)}
              className="px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              ورود
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
            <span className="whitespace-nowrap">پنل مدیریت</span>
            <span>/</span>
            <span className="font-semibold text-slate-900 truncate">{TAB_TITLES[activeTab]}</span>
            {selectedBot && (
              <>
                <span>/</span>
                <span className="text-slate-600 truncate">{selectedBot.name}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {previewMode && (
              <button
                type="button"
                onClick={() => setPreviewMode(false)}
                className="px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                ورود به حساب کاربری
              </button>
            )}
          </div>
        </header>

        <main
          className={`flex-1 p-6 w-full mx-auto ${
            activeTab === 'flow' ? 'max-w-[1600px]' : 'max-w-7xl'
          }`}
        >
          {toast && (
            <div
              className={`mb-5 p-3.5 rounded-xl border text-xs ${
                toast.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              {toast.text}
            </div>
          )}

          {activeTab === 'bots' && (
            <BotsOverviewView
              token={token}
              bots={bots}
              selectedBotId={selectedBotId}
              loading={loadingBots}
              onSelectBot={setSelectedBotId}
              onBotsChanged={loadBots}
              onOpenFlowBuilder={(id) => {
                setSelectedBotId(id);
                setActiveTab('flow');
              }}
            />
          )}

          {activeTab === 'flow' && (
            <FlowBuilderView
              token={token}
              botId={selectedBotId}
              flowId={flowId}
              flowName={flowName}
              flows={flows}
              flow={flow}
              products={products}
              surveys={surveys}
              bookingServices={bookingServices}
              bookingSchedules={bookingSchedules}
              appointments={appointments}
              saving={savingFlow}
              onChangeFlow={setFlow}
              onSaveFlow={handleSaveFlow}
              onSelectFlowVersion={handleSelectFlowVersion}
              onPublishVersion={handlePublishFlowVersion}
            />
          )}

          {activeTab === 'contacts' && (
            <div className="space-y-4">
              {contactsError && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <span>{contactsError}</span>
                </div>
              )}
              <ContactsView
                token={token}
                botId={selectedBotId}
                contacts={contacts}
                loading={loadingBotData}
                onRefresh={loadSelectedBotDetails}
              />
            </div>
          )}

          {activeTab === 'booking' && (
            <div className="space-y-4">
              {bookingError && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <span>{bookingError}</span>
                </div>
              )}
              <BookingView
                token={token}
                botId={selectedBotId}
                services={bookingServices}
                schedules={bookingSchedules}
                appointments={appointments}
                loading={loadingBotData}
                onRefresh={loadSelectedBotDetails}
                onPreviewServicesChange={!token ? setBookingServices : undefined}
                onPreviewSchedulesChange={!token ? setBookingSchedules : undefined}
              />
            </div>
          )}

          {activeTab === 'catalog' && (
            <div className="space-y-4">
              {catalogError && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <span>{catalogError}</span>
                </div>
              )}
              <CatalogOrdersView
                token={token}
                botId={selectedBotId}
                products={products}
                orders={orders}
                loading={loadingBotData}
                onRefresh={loadSelectedBotDetails}
                onPreviewProductsChange={!token ? setProducts : undefined}
              />
            </div>
          )}

          {activeTab === 'broadcast' && (
            <div className="space-y-4">
              {broadcastError && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <span>{broadcastError}</span>
                </div>
              )}
              <BroadcastView
                token={token}
                botId={selectedBotId}
                contacts={contacts}
                campaigns={campaigns}
                loading={loadingBotData}
                onRefresh={loadSelectedBotDetails}
              />
            </div>
          )}

          {activeTab === 'surveys' && (
            <div className="space-y-4">
              {surveysError && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <span>{surveysError}</span>
                </div>
              )}
              <SurveysView
                token={token}
                botId={selectedBotId}
                surveys={surveys}
                responses={surveyResponses}
                loading={loadingBotData}
                onRefresh={loadSelectedBotDetails}
                onPreviewSurveysChange={!token ? setSurveys : undefined}
              />
            </div>
          )}

          {activeTab === 'forms' && (
            <CollectedFormsView
              token={token}
              botId={selectedBotId}
              forms={forms}
              loading={loadingBotData}
              onRefresh={loadSelectedBotDetails}
            />
          )}

          {activeTab === 'logs' && (
            <WebhookLogsView
              token={token}
              logs={logs}
              sessions={sessions}
              loading={loadingBotData}
              onRefresh={loadSelectedBotDetails}
            />
          )}
        </main>
      </div>
    </div>
  );
}
