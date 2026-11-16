import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Database,
  FileSpreadsheet,
  LogOut,
  Workflow,
} from 'lucide-react';
import { AuthScreen } from './components/AuthScreen.tsx';
import { BotsOverviewView } from './components/BotsOverviewView.tsx';
import { CollectedFormsView } from './components/CollectedFormsView.tsx';
import { DirectusSchemaView } from './components/DirectusSchemaView.tsx';
import { FlowBuilderView } from './components/FlowBuilderView.tsx';
import { WebhookLogsView } from './components/WebhookLogsView.tsx';
import { api, ApiError, type AuthResponse, type HealthResponse } from './lib/api.ts';
import type {
  BotRecord,
  BotSessionRecord,
  CollectedFormRecord,
  DirectusUser,
  FlowDefinition,
  WebhookLogRecord,
} from './types/bot.ts';

type NavTab = 'bots' | 'flow' | 'forms' | 'logs' | 'schema';

const AUTH_STORAGE_KEY = 'balesaz_directus_session';

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
  forms: 'داده‌های فرم‌های جمع‌آوری‌شده',
  logs: 'گزارش وب‌هوک‌ها و نشست‌ها',
  schema: 'راهنمای دیتابیس دایرکتوس',
};

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [user, setUser] = useState<DirectusUser | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const [activeTab, setActiveTab] = useState<NavTab>('bots');
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [loadingBots, setLoadingBots] = useState(false);

  const [flowId, setFlowId] = useState<string | null>(null);
  const [flowName, setFlowName] = useState('جریان اصلی گفتگو');
  const [flow, setFlow] = useState<FlowDefinition>(EMPTY_FLOW);
  const [savingFlow, setSavingFlow] = useState(false);

  const [forms, setForms] = useState<CollectedFormRecord[]>([]);
  const [logs, setLogs] = useState<WebhookLogRecord[]>([]);
  const [sessions, setSessions] = useState<BotSessionRecord[]>([]);
  const [loadingBotData, setLoadingBotData] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const selectedBot = useMemo(
    () => bots.find((b) => b.id === selectedBotId) || null,
    [bots, selectedBotId]
  );

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Load initial health, default flow, and stored Directus session
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
            user?: DirectusUser;
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
    try {
      const [flowRes, formsRes, logsRes, sessionsRes] = await Promise.all([
        api.getBotFlow(token, selectedBotId),
        api.listForms(token, selectedBotId),
        api.listLogs(token, selectedBotId),
        api.listSessions(token, selectedBotId),
      ]);

      if (flowRes.flow) {
        setFlowId(flowRes.flow.id);
        setFlowName(flowRes.flow.name);
        setFlow(flowRes.flow.flow_json);
      } else {
        setFlowId(null);
        const def = await api.getDefaultFlow().catch(() => null);
        if (def?.flow) setFlow(def.flow);
      }

      setForms(formsRes.forms);
      setLogs(logsRes.logs);
      setSessions(sessionsRes.sessions);
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
    setSelectedBotId(null);
    setPreviewMode(false);
  }

  async function handleSaveFlow() {
    if (!token || !selectedBotId) return;
    setSavingFlow(true);
    try {
      const res = await api.saveBotFlow(token, selectedBotId, {
        flowId: flowId || undefined,
        name: flowName,
        flow_json: flow,
        is_published: true,
      });
      setFlowId(res.flow.id);
      showToast('success', 'جریان گفتگو با موفقیت در دایرکتوس ذخیره و منتشر شد.');
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'ذخیره جریان ناموفق بود.');
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
    { id: 'forms', label: 'داده‌های فرم‌ها', icon: <FileSpreadsheet className="w-4 h-4" /> },
    { id: 'logs', label: 'گزارش وب‌هوک‌ها', icon: <Activity className="w-4 h-4" /> },
    { id: 'schema', label: 'راهنمای دایرکتوس', icon: <Database className="w-4 h-4" /> },
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
            <span className="text-base font-bold text-slate-900 whitespace-nowrap">بله‌ساز</span>
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
              {user ? user.email : 'بدون اتصال دایرکتوس'}
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
                ورود به حساب دایرکتوس
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
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
              flow={flow}
              saving={savingFlow}
              onChangeFlow={setFlow}
              onSaveFlow={handleSaveFlow}
            />
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

          {activeTab === 'schema' && <DirectusSchemaView />}
        </main>
      </div>
    </div>
  );
}
