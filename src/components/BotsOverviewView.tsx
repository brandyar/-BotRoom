import React, { useState } from 'react';
import {
  Check,
  Copy,
  Globe,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  Unlink,
  Workflow,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type { BotRecord } from '../types/bot.ts';
import { formatJalaliDateTime, toPersianDigits } from '../utils/jalali.ts';

interface BotsOverviewViewProps {
  token: string | null;
  bots: BotRecord[];
  selectedBotId: string | null;
  loading: boolean;
  onSelectBot: (botId: string) => void;
  onBotsChanged: () => Promise<void>;
  onOpenFlowBuilder: (botId: string) => void;
}

export function BotsOverviewView({
  token,
  bots,
  selectedBotId,
  loading,
  onSelectBot,
  onBotsChanged,
  onOpenFlowBuilder,
}: BotsOverviewViewProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [botName, setBotName] = useState('');
  const [botToken, setBotToken] = useState('');
  const [verifyToken, setVerifyToken] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyBotId, setBusyBotId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  function getWebhookUrl(secret: string): string {
    return `${window.location.origin}/api/webhooks/bale/${secret}`;
  }

  function copyWebhookUrl(bot: BotRecord) {
    navigator.clipboard.writeText(getWebhookUrl(bot.webhook_secret));
    setCopiedId(bot.id);
    setTimeout(() => setCopiedId(null), 1800);
  }

  async function handleCreateBot(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setFeedback(null);
    setSubmitting(true);

    try {
      const created = await api.createBot(token, {
        name: botName.trim(),
        bot_token: botToken.trim(),
        verifyToken,
      });
      setBotName('');
      setBotToken('');
      setShowCreateForm(false);
      await onBotsChanged();
      onSelectBot(created.bot.id);
      setFeedback({
        type: 'success',
        text: `بازوی «${created.bot.name}» با موفقیت ثبت و جریان پیش‌فرض برای آن ایجاد شد.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof ApiError ? err.message : 'ثبت بازو ناموفق بود.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegisterWebhook(bot: BotRecord) {
    if (!token) return;
    setBusyBotId(bot.id);
    setFeedback(null);
    try {
      const res = await api.registerWebhook(token, bot.id);
      await onBotsChanged();
      setFeedback({
        type: 'success',
        text: `وب‌هوک بازوی «${bot.name}» در پیام‌رسان بله با موفقیت فعال شد (${res.webhookUrl}).`,
      });
    } catch (err) {
      await onBotsChanged();
      setFeedback({
        type: 'error',
        text: err instanceof ApiError ? err.message : 'خطا در ثبت وب‌هوک در سرور بله.',
      });
    } finally {
      setBusyBotId(null);
    }
  }

  async function handleRemoveWebhook(bot: BotRecord) {
    if (!token) return;
    setBusyBotId(bot.id);
    setFeedback(null);
    try {
      await api.removeWebhook(token, bot.id);
      await onBotsChanged();
      setFeedback({
        type: 'success',
        text: `اتصال وب‌هوک بازوی «${bot.name}» قطع شد.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof ApiError ? err.message : 'خطا در قطع وب‌هوک.',
      });
    } finally {
      setBusyBotId(null);
    }
  }

  async function handleToggleActive(bot: BotRecord) {
    if (!token) return;
    setBusyBotId(bot.id);
    try {
      await api.updateBot(token, bot.id, { is_active: !bot.is_active });
      await onBotsChanged();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof ApiError ? err.message : 'بروزرسانی وضعیت بازو ناموفق بود.',
      });
    } finally {
      setBusyBotId(null);
    }
  }

  async function handleDeleteBot(bot: BotRecord) {
    if (!token) return;
    setBusyBotId(bot.id);
    setFeedback(null);
    try {
      await api.deleteBot(token, bot.id);
      await onBotsChanged();
      setFeedback({ type: 'success', text: `بازوی «${bot.name}» حذف شد.` });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof ApiError ? err.message : 'حذف بازو ناموفق بود.',
      });
    } finally {
      setBusyBotId(null);
    }
  }

  const activeCount = bots.filter((b) => b.webhook_status === 'active').length;

  return (
    <div className="space-y-6">
      {/* Header summary strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-6">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-900">مدیریت بازوهای بله</h2>
          <p className="text-xs text-slate-500 tabular-nums">
            مجموع بازوها: {toPersianDigits(bots.length)} · وب‌هوک‌های فعال:{' '}
            {toPersianDigits(activeCount)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onBotsChanged()}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>بروزرسانی لیست</span>
          </button>

          {token && (
            <button
              type="button"
              onClick={() => setShowCreateForm((v) => !v)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>افزودن بازوی جدید</span>
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-xl border text-xs leading-6 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {!token && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600 leading-7">
          شما در حالت پیش‌نمایش هستید. برای ثبت واقعی بازو و اتصال وب‌هوک به پیام‌رسان بله، وارد حساب کاربری خود شوید. هم‌اکنون می‌توانید از تب «طراح جریان گفتگو» برای طراحی و تست جریان استفاده کنید.
        </div>
      )}

      {showCreateForm && token && (
        <form
          onSubmit={handleCreateBot}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">اتصال بازوی جدید پیام‌رسان بله</h3>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              انصراف
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                نام نمایشی بازو
              </label>
              <input
                type="text"
                required
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                placeholder="مثلاً بازوی پشتیبانی فروشگاه"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                توکن بازو (دریافتی از @BotFather در بله)
              </label>
              <input
                type="text"
                required
                dir="ltr"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxyz"
                className="w-full px-3 py-2 text-sm text-left font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={verifyToken}
                onChange={(e) => setVerifyToken(e.target.checked)}
                className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
              />
              <span>اعتبارسنجی خودکار توکن از طریق متد getMe پیام‌رسان بله</span>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              {submitting ? 'در حال ثبت...' : 'ثبت بازو و ساخت جریان اولیه'}
            </button>
          </div>
        </form>
      )}

      {/* Bots Table / List */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : bots.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-900">هنوز هیچ بازویی ثبت نشده است</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-6">
              توکن بازوی بله خود را از @BotFather دریافت کرده و با دکمه «افزودن بازوی جدید» به سرویس متصل کنید.
            </p>
            {token && (
              <button
                type="button"
                onClick={() => setShowCreateForm(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>ثبت اولین بازو</span>
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {bots.map((bot) => {
              const isSelected = bot.id === selectedBotId;
              const isBusy = busyBotId === bot.id;
              const statusLabel =
                bot.webhook_status === 'active'
                  ? 'وب‌هوک متصل'
                  : bot.webhook_status === 'error'
                  ? 'خطا در وب‌هوک'
                  : 'وب‌هوک غیرفعال';
              const statusColor =
                bot.webhook_status === 'active'
                  ? 'text-emerald-700'
                  : bot.webhook_status === 'error'
                  ? 'text-red-700'
                  : 'text-slate-500';

              return (
                <div
                  key={bot.id}
                  onClick={() => onSelectBot(bot.id)}
                  className={`p-5 transition-colors cursor-pointer ${
                    isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="text-sm font-bold text-slate-900">{bot.name}</h3>
                        {bot.bale_username && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="text-xs font-mono text-slate-600" dir="ltr">
                              {bot.bale_username}
                            </span>
                          </>
                        )}
                        <span className="text-slate-300">·</span>
                        <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
                        <span className="text-slate-300">·</span>
                        <span className="text-xs text-slate-500 tabular-nums">
                          ایجاد: {formatJalaliDateTime(bot.date_created)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Globe className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        <code className="font-mono truncate max-w-md" dir="ltr">
                          {getWebhookUrl(bot.webhook_secret)}
                        </code>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyWebhookUrl(bot);
                          }}
                          className="text-emerald-700 hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer"
                        >
                          {copiedId === bot.id ? (
                            <>
                              <Check className="w-3 h-3" />
                              <span>کپی شد</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>کپی آدرس</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-2 flex-wrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectBot(bot.id);
                          onOpenFlowBuilder(bot.id);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
                      >
                        <Workflow className="w-3.5 h-3.5 text-emerald-700" />
                        <span>طراحی جریان</span>
                      </button>

                      {bot.webhook_status === 'active' ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleRemoveWebhook(bot)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                        >
                          <Unlink className="w-3.5 h-3.5" />
                          <span>قطع وب‌هوک</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleRegisterWebhook(bot)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg whitespace-nowrap cursor-pointer"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          <span>{isBusy ? 'در حال ثبت...' : 'ثبت وب‌هوک در بله'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleToggleActive(bot)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
                      >
                        {bot.is_active ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDeleteBot(bot)}
                        title="حذف بازو"
                        className="p-1.5 text-slate-400 hover:text-red-700 border border-transparent hover:border-red-200 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
