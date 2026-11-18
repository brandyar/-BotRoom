import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Megaphone,
  RefreshCw,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type {
  BotContactRecord,
  BroadcastCampaignRecord,
  BroadcastCampaignStatus,
} from '../types/bot.ts';
import { formatJalaliDateTime, toPersianDigits } from '../utils/jalali.ts';

interface BroadcastViewProps {
  token: string | null;
  botId: string | null;
  contacts: BotContactRecord[];
  campaigns: BroadcastCampaignRecord[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}

const CAMPAIGN_STATUS_META: Record<
  BroadcastCampaignStatus,
  { label: string; textColor: string }
> = {
  draft: { label: 'پیش‌نویس', textColor: 'text-slate-600' },
  queued: { label: 'زمان‌بندی / در صف', textColor: 'text-amber-700' },
  sending: { label: 'در حال ارسال گروهی', textColor: 'text-sky-700' },
  completed: { label: 'تکمیل‌شده', textColor: 'text-emerald-700' },
  failed: { label: 'خطا در ارسال', textColor: 'text-red-700' },
};

export function BroadcastView({
  token,
  botId,
  contacts,
  campaigns,
  loading,
  onRefresh,
}: BroadcastViewProps) {
  const [title, setTitle] = useState('');
  const [messageText, setMessageText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) {
      for (const tag of c.tags || []) {
        if (tag?.trim()) set.add(tag.trim());
      }
    }
    return Array.from(set);
  }, [contacts]);

  const activeContacts = useMemo(() => contacts.filter((c) => !c.is_blocked), [contacts]);

  const estimatedRecipients = useMemo(() => {
    if (selectedTags.length === 0) return activeContacts.length;
    return activeContacts.filter((c) =>
      (c.tags || []).some((t) => selectedTags.includes(t))
    ).length;
  }, [activeContacts, selectedTags]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function addCustomTag() {
    const clean = customTagInput.trim();
    if (!clean) return;
    if (!selectedTags.includes(clean)) {
      setSelectedTags((prev) => [...prev, clean]);
    }
    setCustomTagInput('');
  }

  async function handleCreateCampaign(sendImmediately: boolean) {
    if (!token || !botId) {
      setError('برای ارسال پیام گروهی ابتدا وارد حساب دایرکتوس شوید.');
      return;
    }
    if (!title.trim() || !messageText.trim()) {
      setError('عنوان کمپین و متن پیام هر دو الزامی هستند.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const isoSchedule =
        !sendImmediately && scheduledAt ? new Date(scheduledAt).toISOString() : null;
      const createdRes = await api.createCampaign(token, botId, {
        title: title.trim(),
        message_text: messageText.trim(),
        media_url: mediaUrl.trim() || null,
        target_tags: selectedTags,
        scheduled_at: isoSchedule,
      });

      if (sendImmediately) {
        await api.sendCampaign(token, botId, createdRes.campaign.id);
        setNotice(
          'کمپین در صف ارسال با کنترل نرخ (Rate Limiter) قرار گرفت. وضعیت پیشرفت را با دکمه بروزرسانی دنبال کنید.'
        );
      } else if (isoSchedule) {
        setNotice('کمپین برای ارسال خودکار در زمان مشخص‌شده ثبت شد.');
      } else {
        setNotice('کمپین به‌عنوان پیش‌نویس ذخیره شد.');
      }

      setTitle('');
      setMessageText('');
      setMediaUrl('');
      setScheduledAt('');
      setSelectedTags([]);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ثبت کمپین ناموفق بود.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendExisting(campaignId: string) {
    if (!token || !botId) return;
    setBusyId(campaignId);
    setError(null);
    setNotice(null);
    try {
      await api.sendCampaign(token, botId, campaignId);
      setNotice('ارسال گروهی کمپین آغاز شد.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'شروع ارسال کمپین ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteCampaign(campaignId: string) {
    if (!token || !botId) return;
    setBusyId(campaignId);
    try {
      await api.deleteCampaign(token, botId, campaignId);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حذف کمپین ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Info & Refresh Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-emerald-700" />
            <h2 className="text-sm font-bold text-slate-900">
              ارسال پیام گروهی (Broadcast) با کنترل نرخ بله
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            صف ارسال با سرعت کنترل‌شده (~۱۶ پیام در ثانیه) اجرا می‌شود و مخاطبانی که ربات را مسدود
            کرده‌اند به صورت خودکار علامت‌گذاری می‌شوند.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-600 tabular-nums">
            مخاطبین فعال: <strong className="text-slate-900">{toPersianDigits(activeContacts.length)}</strong>
            {' · '}
            بلاک‌شده: <strong className="text-slate-700">{toPersianDigits(contacts.length - activeContacts.length)}</strong>
          </div>
          {token && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void onRefresh()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>بروزرسانی</span>
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
          {notice}
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Composer (5 columns) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
            ساخت کمپین پیام گروهی جدید
          </h3>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              عنوان داخلی کمپین
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً: اطلاع‌رسانی تخفیف ویژه عید"
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-700">متن پیام ارسالی در بله</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setMessageText((prev) => `${prev} {{user.first_name}}`.trimStart())
                  }
                  className="text-[11px] font-mono text-emerald-700 hover:underline cursor-pointer"
                >
                  +نام مشتری
                </button>
                <button
                  type="button"
                  onClick={() => setMessageText((prev) => `${prev} {{user.phone}}`.trimStart())}
                  className="text-[11px] font-mono text-sky-700 hover:underline cursor-pointer"
                >
                  +موبایل
                </button>
              </div>
            </div>
            <textarea
              rows={5}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="سلام {{user.first_name}} عزیز! خبر ویژه امروز..."
              className="w-full px-3 py-2 text-xs leading-6 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              لینک تصویر ضمیمه (اختیاری — ارسال با sendPhoto)
            </label>
            <input
              type="url"
              dir="ltr"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="https://example.com/banner.jpg"
              className="w-full px-3 py-2 text-xs font-mono text-left border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            />
          </div>

          {/* Target Tags Filter */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700">
                فیلتر مخاطبین بر اساس برچسب CRM (خالی = همه مخاطبین)
              </label>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 tabular-nums">
                <Users className="w-3.5 h-3.5" />
                <span>{toPersianDigits(estimatedRecipients)} گیرنده</span>
              </span>
            </div>

            {availableTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {availableTags.map((tag) => {
                  const active = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`px-2.5 py-1 text-xs rounded-lg border transition-colors cursor-pointer ${
                        active
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomTag();
                  }
                }}
                placeholder="افزودن برچسب دلخواه (مثلاً VIP)..."
                className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
              />
              <button
                type="button"
                onClick={addCustomTag}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                افزودن
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              زمان‌بندی ارسال آینده (اختیاری — برای ارسال زمان‌دار)
            </label>
            <input
              type="datetime-local"
              dir="ltr"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono text-left border border-slate-200 rounded-lg"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              disabled={submitting || !token}
              onClick={() => void handleCreateCampaign(true)}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? 'در حال ثبت...' : 'ایجاد و ارسال فوری'}</span>
            </button>

            <button
              type="button"
              disabled={submitting || !token}
              onClick={() => void handleCreateCampaign(false)}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <CalendarClock className="w-3.5 h-3.5" />
              <span>{scheduledAt ? 'زمان‌بندی کمپین' : 'ذخیره پیش‌نویس'}</span>
            </button>
          </div>
        </div>

        {/* Campaigns List (7 columns) */}
        <div className="lg:col-span-7 space-y-4">
          {campaigns.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
              <Megaphone className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-800">
                هنوز هیچ کمپین ارسال گروهی ثبت نشده است
              </p>
              <p className="text-xs text-slate-500">
                از فرم سمت راست کمپین جدید بسازید و برای همه مخاطبین یا یک سگمنت خاص پیام ارسال
                کنید.
              </p>
            </div>
          ) : (
            campaigns.map((camp) => {
              const statusMeta = CAMPAIGN_STATUS_META[camp.status] || CAMPAIGN_STATUS_META.draft;
              const total = camp.total_count || 0;
              const processed = (camp.sent_count || 0) + (camp.failed_count || 0);
              const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

              return (
                <div
                  key={camp.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-slate-900">{camp.title}</h4>
                        <span className="text-slate-300">·</span>
                        <span className={`text-xs font-semibold ${statusMeta.textColor}`}>
                          {statusMeta.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        هدف:{' '}
                        {camp.target_tags && camp.target_tags.length > 0
                          ? `برچسب‌های ${camp.target_tags.join('، ')}`
                          : 'همه مخاطبین فعال'}
                        {camp.scheduled_at && (
                          <>
                            {' · '}
                            زمان‌بندی: {formatJalaliDateTime(camp.scheduled_at)}
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {(camp.status === 'draft' ||
                        camp.status === 'queued' ||
                        camp.status === 'failed') && (
                        <button
                          type="button"
                          disabled={busyId === camp.id || !token}
                          onClick={() => void handleSendExisting(camp.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          <Send className="w-3 h-3" />
                          <span>ارسال فوری</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === camp.id || !token}
                        onClick={() => void handleDeleteCampaign(camp.id)}
                        className="p-1.5 text-slate-400 hover:text-red-700 rounded-lg cursor-pointer"
                        title="حذف کمپین"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-700 bg-slate-50 border border-slate-100 rounded-lg p-3 leading-6 whitespace-pre-line">
                    {camp.message_text}
                  </p>

                  {/* Progress & Delivery Metrics */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs tabular-nums">
                      <div className="flex items-center gap-3 text-slate-600">
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>ارسال موفق: {toPersianDigits(camp.sent_count || 0)}</span>
                        </span>
                        {(camp.failed_count || 0) > 0 && (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>ناموفق/بلاک: {toPersianDigits(camp.failed_count || 0)}</span>
                          </span>
                        )}
                      </div>
                      <span className="text-slate-500">
                        از کل {toPersianDigits(total)} مخاطب ({toPersianDigits(pct)}٪)
                      </span>
                    </div>

                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-700 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
