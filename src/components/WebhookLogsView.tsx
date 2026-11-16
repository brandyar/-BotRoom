import React, { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { BotSessionRecord, WebhookLogRecord } from '../types/bot.ts';
import { formatJalaliDateTime, toPersianDigits } from '../utils/jalali.ts';

interface WebhookLogsViewProps {
  token: string | null;
  logs: WebhookLogRecord[];
  sessions: BotSessionRecord[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}

export function WebhookLogsView({
  token,
  logs,
  sessions,
  loading,
  onRefresh,
}: WebhookLogsViewProps) {
  const [subTab, setSubTab] = useState<'logs' | 'sessions'>('logs');
  const [statusFilter, setStatusFilter] = useState<'all' | 'processed' | 'failed'>('all');

  const filteredLogs = useMemo(() => {
    if (statusFilter === 'all') return logs;
    return logs.filter((l) => l.status === statusFilter);
  }, [logs, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">گزارش وب‌هوک‌ها و نشست‌های کاربران</h2>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            رویدادهای ثبت‌شده: {toPersianDigits(logs.length)} · نشست‌های فعال:{' '}
            {toPersianDigits(sessions.length)}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSubTab('logs')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                subTab === 'logs'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              لاگ وب‌هوک‌ها
            </button>
            <button
              type="button"
              onClick={() => setSubTab('sessions')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                subTab === 'sessions'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              نشست‌های کاربران بله
            </button>
          </div>

          {subTab === 'logs' && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['all', 'processed', 'failed'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    statusFilter === status
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {status === 'all' ? 'همه' : status === 'processed' ? 'موفق' : 'ناموفق'}
                </button>
              ))}
            </div>
          )}

          {token && (
            <button
              type="button"
              onClick={() => onRefresh()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>بروزرسانی</span>
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : subTab === 'logs' ? (
          filteredLogs.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-900">گزارش وب‌هوکی ثبت نشده است</p>
              <p className="text-xs text-slate-500">
                پس از اتصال وب‌هوک و دریافت پیام در پیام‌رسان بله، گزارش پردازش صف و زمان اجرا اینجا ثبت می‌شود.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 bg-slate-50/70">
                    <th className="py-3 px-4 whitespace-nowrap">نوع رویداد</th>
                    <th className="py-3 px-4 whitespace-nowrap">متن / داده ورودی</th>
                    <th className="py-3 px-4 whitespace-nowrap">گره اجراشده</th>
                    <th className="py-3 px-4 whitespace-nowrap">وضعیت</th>
                    <th className="py-3 px-4 whitespace-nowrap">زمان پردازش</th>
                    <th className="py-3 px-4 whitespace-nowrap">تاریخ (شمسی)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                        {log.event_type}
                      </td>
                      <td className="py-3 px-4 text-slate-900 max-w-xs truncate">
                        {log.incoming_text || log.error_message || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                        {log.matched_node_id || '—'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={
                            log.status === 'processed'
                              ? 'text-emerald-700 font-medium'
                              : log.status === 'failed'
                              ? 'text-red-700 font-medium'
                              : 'text-amber-700 font-medium'
                          }
                        >
                          {log.status === 'processed'
                            ? 'پردازش موفق'
                            : log.status === 'failed'
                            ? 'خطا'
                            : 'در صف'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {log.latency_ms != null ? `${toPersianDigits(log.latency_ms)} ms` : '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-500 tabular-nums whitespace-nowrap">
                        {formatJalaliDateTime(log.date_created)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : sessions.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-900">نشست فعالی ثبت نشده است</p>
            <p className="text-xs text-slate-500">
              وضعیت هر کاربر در حال گفتگو با بازوی بله در این جدول نگهداری می‌شود.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-4 whitespace-nowrap">نام کاربر</th>
                  <th className="py-3 px-4 whitespace-nowrap">شناسه چت</th>
                  <th className="py-3 px-4 whitespace-nowrap">گره فعلی</th>
                  <th className="py-3 px-4 whitespace-nowrap">در انتظار فیلد</th>
                  <th className="py-3 px-4 whitespace-nowrap">آخرین تعامل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {sessions.map((s) => (
                  <tr key={s.id || s.bale_chat_id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      {s.bale_user_name || s.bale_user_id}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {s.bale_chat_id}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                      {s.current_node_id || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono text-emerald-700 whitespace-nowrap">
                      {s.awaiting_field_key || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-500 tabular-nums whitespace-nowrap">
                      {formatJalaliDateTime(s.last_interaction_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
