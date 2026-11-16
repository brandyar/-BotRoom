import React, { useMemo, useState } from 'react';
import { Download, RefreshCw, Search, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type { CollectedFormRecord } from '../types/bot.ts';
import { formatJalaliDateTime, toPersianDigits } from '../utils/jalali.ts';

interface CollectedFormsViewProps {
  token: string | null;
  botId: string | null;
  forms: CollectedFormRecord[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}

export function CollectedFormsView({
  token,
  botId,
  forms,
  loading,
  onRefresh,
}: CollectedFormsViewProps) {
  const [query, setQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dynamicKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const form of forms) {
      if (form.payload && typeof form.payload === 'object') {
        Object.keys(form.payload).forEach((k) => keys.add(k));
      }
    }
    return Array.from(keys);
  }, [forms]);

  const filteredForms = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return forms;
    return forms.filter((item) => {
      const baseMatch =
        (item.bale_user_name || '').toLowerCase().includes(q) ||
        (item.form_title || '').toLowerCase().includes(q) ||
        item.bale_chat_id.toLowerCase().includes(q);
      const payloadMatch = Object.values(item.payload || {}).some((val) =>
        String(val).toLowerCase().includes(q)
      );
      return baseMatch || payloadMatch;
    });
  }, [forms, query]);

  async function handleDelete(recordId: string) {
    if (!token || !botId) return;
    setDeletingId(recordId);
    setError(null);
    try {
      await api.deleteForm(token, botId, recordId);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حذف رکورد ناموفق بود.');
    } finally {
      setDeletingId(null);
    }
  }

  function exportCsv() {
    const headers = ['شناسه', 'نام کاربر بله', 'عنوان فرم', 'تاریخ ثبت', ...dynamicKeys];
    const rows = filteredForms.map((item) => [
      item.id,
      item.bale_user_name || item.bale_user_id,
      item.form_title || '—',
      formatJalaliDateTime(item.date_created),
      ...dynamicKeys.map((k) => String(item.payload?.[k] ?? '')),
    ]);

    const csvContent =
      '\uFEFF' +
      [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bale-forms-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">داده‌های فرم‌های جمع‌آوری‌شده</h2>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            تعداد رکوردهای ثبت‌شده در کالکشن <code className="font-mono">collected_form_data</code>:{' '}
            {toPersianDigits(filteredForms.length)}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو در نام یا مقادیر..."
              className="pr-9 pl-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600 w-56"
            />
          </div>

          <button
            type="button"
            onClick={exportCsv}
            disabled={filteredForms.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>خروجی اکسل (CSV)</span>
          </button>

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

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredForms.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-900">رکورد فرمی یافت نشد</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-6">
              پس از تکمیل گره «ثبت فرم (save_form)» توسط کاربران در پیام‌رسان بله، اطلاعات جمع‌آوری‌شده در این جدول نمایش داده می‌شود.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-4 whitespace-nowrap">کاربر بله</th>
                  <th className="py-3 px-4 whitespace-nowrap">عنوان فرم</th>
                  {dynamicKeys.map((key) => (
                    <th key={key} className="py-3 px-4 whitespace-nowrap font-mono">
                      {key}
                    </th>
                  ))}
                  <th className="py-3 px-4 whitespace-nowrap">زمان ثبت (شمسی)</th>
                  <th className="py-3 px-4 whitespace-nowrap">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredForms.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      {item.bale_user_name || item.bale_user_id}
                    </td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                      {item.form_title || '—'}
                    </td>
                    {dynamicKeys.map((key) => (
                      <td key={key} className="py-3 px-4 text-slate-800 max-w-xs truncate">
                        {String(item.payload?.[key] ?? '—')}
                      </td>
                    ))}
                    <td className="py-3 px-4 text-slate-500 tabular-nums whitespace-nowrap">
                      {formatJalaliDateTime(item.date_created)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={deletingId === item.id || !token}
                        onClick={() => handleDelete(item.id)}
                        className="p-1.5 text-slate-400 hover:text-red-700 rounded-lg cursor-pointer disabled:opacity-40"
                        title="حذف رکورد"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
