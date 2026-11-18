import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  ClipboardList,
  Download,
  Edit3,
  Plus,
  RefreshCw,
  Save,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type {
  SurveyQuestionItem,
  SurveyRecord,
  SurveyResponseRecord,
} from '../types/bot.ts';
import { formatJalaliDateTime, toPersianDigits } from '../utils/jalali.ts';

interface SurveysViewProps {
  token: string | null;
  botId: string | null;
  surveys: SurveyRecord[];
  responses: SurveyResponseRecord[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onPreviewSurveysChange?: (next: SurveyRecord[]) => void;
}

export function SurveysView({
  token,
  botId,
  surveys,
  responses,
  loading,
  onRefresh,
  onPreviewSurveysChange,
}: SurveysViewProps) {
  const [subTab, setSubTab] = useState<'analytics' | 'builder'>('analytics');
  const [selectedSurveyId, setSelectedSurveyId] = useState<string>('all');

  // Survey Form State
  const [formOpen, setFormOpen] = useState(false);
  const [editingSurveyId, setEditingSurveyId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [surveyType, setSurveyType] = useState<'rating' | 'multi_choice'>('rating');
  const [allowMultiple, setAllowMultiple] = useState(true);
  const [questions, setQuestions] = useState<SurveyQuestionItem[]>([
    { id: 'q_1', text: 'از کیفیت خدمات ما چه امتیازی می‌دهید؟', type: 'rating' },
  ]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredResponses = useMemo(() => {
    if (selectedSurveyId === 'all') return responses;
    return responses.filter((r) => r.survey_id === selectedSurveyId);
  }, [responses, selectedSurveyId]);

  const metrics = useMemo(() => {
    const scored = filteredResponses
      .map((r) => r.score)
      .filter((s): s is number => typeof s === 'number' && !Number.isNaN(s) && s >= 1 && s <= 5);

    const avg =
      scored.length > 0
        ? (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1)
        : '۰';
    const highCount = scored.filter((s) => s >= 4).length;
    const lowCount = scored.filter((s) => s <= 2).length;
    const csatPct = scored.length > 0 ? Math.round((highCount / scored.length) * 100) : 0;

    const distribution = [5, 4, 3, 2, 1].map((star) => {
      const count = scored.filter((s) => Math.round(s) === star).length;
      const pct = scored.length > 0 ? Math.round((count / scored.length) * 100) : 0;
      return { star, count, pct };
    });

    return {
      totalResponses: filteredResponses.length,
      scoredCount: scored.length,
      avg,
      csatPct,
      lowCount,
      distribution,
    };
  }, [filteredResponses]);

  const surveyTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of surveys) map.set(s.id, s.title);
    return map;
  }, [surveys]);

  function openNewSurvey() {
    setEditingSurveyId(null);
    setTitle('');
    setSurveyType('rating');
    setAllowMultiple(true);
    setQuestions([
      { id: `q_${Date.now().toString(36)}`, text: 'از کیفیت خدمات ما چه امتیازی می‌دهید؟', type: 'rating' },
    ]);
    setError(null);
    setFormOpen(true);
    setSubTab('builder');
  }

  function openEditSurvey(survey: SurveyRecord) {
    setEditingSurveyId(survey.id);
    setTitle(survey.title);
    setSurveyType(survey.type);
    setAllowMultiple(survey.allow_multiple !== false);
    setQuestions(
      survey.questions_json.length > 0
        ? survey.questions_json
        : [{ id: 'q_1', text: survey.title, type: 'rating' }]
    );
    setError(null);
    setFormOpen(true);
    setSubTab('builder');
  }

  async function handleSaveSurvey(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('عنوان نظرسنجی الزامی است.');
      return;
    }

    const cleanQuestions = questions.filter((q) => q.text.trim());
    if (cleanQuestions.length === 0) {
      setError('حداقل یک سوال برای نظرسنجی تعریف کنید.');
      return;
    }

    if (!token || !botId) {
      if (onPreviewSurveysChange) {
        if (editingSurveyId) {
          onPreviewSurveysChange(
            surveys.map((s) =>
              s.id === editingSurveyId
                ? {
                    ...s,
                    title: title.trim(),
                    type: surveyType,
                    questions_json: cleanQuestions,
                    allow_multiple: allowMultiple,
                  }
                : s
            )
          );
        } else {
          onPreviewSurveysChange([
            {
              id: `srv_${Date.now().toString(36)}`,
              bot_id: 'simulator-bot',
              title: title.trim(),
              type: surveyType,
              questions_json: cleanQuestions,
              allow_multiple: allowMultiple,
              date_created: new Date().toISOString(),
            },
            ...surveys,
          ]);
        }
        setFormOpen(false);
      }
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingSurveyId) {
        await api.updateSurvey(token, botId, editingSurveyId, {
          title: title.trim(),
          type: surveyType,
          questions_json: cleanQuestions,
          allow_multiple: allowMultiple,
        });
      } else {
        await api.createSurvey(token, botId, {
          title: title.trim(),
          type: surveyType,
          questions_json: cleanQuestions,
          allow_multiple: allowMultiple,
        });
      }
      setFormOpen(false);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ذخیره نظرسنجی ناموفق بود.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSurvey(surveyId: string) {
    if (!token || !botId) {
      if (onPreviewSurveysChange) {
        onPreviewSurveysChange(surveys.filter((s) => s.id !== surveyId));
      }
      return;
    }
    setBusyId(surveyId);
    setError(null);
    try {
      await api.deleteSurvey(token, botId, surveyId);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حذف نظرسنجی ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteResponse(responseId: string) {
    if (!token || !botId) return;
    setBusyId(responseId);
    setError(null);
    try {
      await api.deleteSurveyResponse(token, botId, responseId);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حذف پاسخ ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  }

  function exportResponsesCsv() {
    const headers = ['کاربر بله', 'نظرسنجی', 'امتیاز', 'پاسخ‌ها', 'تاریخ ثبت'];
    const rows = filteredResponses.map((r) => [
      r.bale_user_name || r.bale_user_id || '—',
      (r.survey_id && surveyTitleMap.get(r.survey_id)) || 'نظرسنجی داخل جریان',
      r.score !== null && r.score !== undefined ? String(r.score) : '—',
      Object.entries(r.answers_json || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | '),
      formatJalaliDateTime(r.date_created),
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
    link.download = `bale-surveys-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">نظرسنجی و سنجش رضایت مشتریان</h2>
            <p className="text-xs text-slate-500 mt-1 tabular-nums">
              {toPersianDigits(surveys.length)} نظرسنجی در <code className="font-mono">surveys</code> ·{' '}
              {toPersianDigits(responses.length)} پاسخ ثبت‌شده در{' '}
              <code className="font-mono">survey_responses</code>
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setSubTab('analytics')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  subTab === 'analytics'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 text-emerald-700" />
                <span>آمار و پاسخ‌ها</span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('builder')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  subTab === 'builder'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ClipboardList className="w-3.5 h-3.5 text-emerald-700" />
                <span>تعریف نظرسنجی ({toPersianDigits(surveys.length)})</span>
              </button>
            </div>

            <button
              type="button"
              onClick={openNewSurvey}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>نظرسنجی جدید</span>
            </button>

            {subTab === 'analytics' && (
              <button
                type="button"
                onClick={exportResponsesCsv}
                disabled={filteredResponses.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>خروجی اکسل</span>
              </button>
            )}

            {token && (
              <button
                type="button"
                onClick={() => onRefresh()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>بروزرسانی</span>
              </button>
            )}
          </div>
        </div>

        {subTab === 'analytics' && surveys.length > 0 && (
          <div className="flex items-center gap-2 pt-3 border-t border-slate-100 flex-wrap">
            <span className="text-xs text-slate-500">فیلتر نظرسنجی:</span>
            <select
              value={selectedSurveyId}
              onChange={(e) => setSelectedSurveyId(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            >
              <option value="all">همه نظرسنجی‌ها</option>
              {surveys.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900">
          {error}
        </div>
      )}

      {/* Survey Builder Form */}
      {formOpen && subTab === 'builder' && (
        <form
          onSubmit={handleSaveSurvey}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900">
              {editingSurveyId ? 'ویرایش نظرسنجی' : 'ساخت نظرسنجی جدید'}
            </h3>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">عنوان نظرسنجی</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثلاً سنجش رضایت پس از خرید"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">ساختار نظرسنجی</label>
              <select
                value={surveyType}
                onChange={(e) => setSurveyType(e.target.value as 'rating' | 'multi_choice')}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="rating">امتیازی (۱ تا ۵ ستاره)</option>
                <option value="multi_choice">چندسوالی (تستی / متنی / امتیازی)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2.5 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">سوالات نظرسنجی</span>
              <button
                type="button"
                onClick={() =>
                  setQuestions((prev) => [
                    ...prev,
                    {
                      id: `q_${Date.now().toString(36)}`,
                      text: '',
                      type: 'choice',
                      options: ['عالی', 'خوب', 'نیاز به بهبود'],
                    },
                  ])
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>افزودن سوال</span>
              </button>
            </div>

            {questions.map((q, idx) => (
              <div
                key={q.id}
                className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    {toPersianDigits(idx + 1)}.
                  </span>
                  <input
                    type="text"
                    required
                    value={q.text}
                    onChange={(e) => {
                      const next = [...questions];
                      next[idx] = { ...q, text: e.target.value };
                      setQuestions(next);
                    }}
                    placeholder="متن سوال را بنویسید..."
                    className="flex-1 min-w-[200px] px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                  />
                  <select
                    value={q.type}
                    onChange={(e) => {
                      const next = [...questions];
                      const nextType = e.target.value as SurveyQuestionItem['type'];
                      next[idx] = {
                        ...q,
                        type: nextType,
                        options:
                          nextType === 'choice' && !q.options?.length
                            ? ['عالی', 'متوسط', 'ضعیف']
                            : q.options,
                      };
                      setQuestions(next);
                    }}
                    className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                  >
                    <option value="rating">امتیاز ۱ تا ۵</option>
                    <option value="choice">چندگزینه‌ای</option>
                    <option value="text">پاسخ متنی آزاد</option>
                  </select>
                  {questions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1 text-slate-400 hover:text-red-700 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {q.type === 'choice' && (
                  <input
                    type="text"
                    value={(q.options || []).join('، ')}
                    onChange={(e) => {
                      const next = [...questions];
                      next[idx] = {
                        ...q,
                        options: e.target.value
                          .split(/[،,]/)
                          .map((o) => o.trim())
                          .filter(Boolean),
                      };
                      setQuestions(next);
                    }}
                    placeholder="گزینه‌ها را با کاما یا ویرگول جدا کنید..."
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={allowMultiple}
                onChange={(e) => setAllowMultiple(e.target.checked)}
                className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
              />
              <span>امکان شرکت مجدد یک کاربر در این نظرسنجی وجود داشته باشد</span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'در حال ذخیره...' : 'ذخیره نظرسنجی'}</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {subTab === 'analytics' ? (
        <div className="space-y-6">
          {/* 4-Column KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">تعداد کل پاسخ‌ها</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {toPersianDigits(metrics.totalResponses)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">میانگین امتیاز رضایت (از ۵)</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                {toPersianDigits(metrics.avg)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">نرخ رضایت بالا (۴ و ۵ ستاره)</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {toPersianDigits(metrics.csatPct)}٪
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">هشدارهای امتیاز پایین (۱ و ۲)</p>
              <p className="text-2xl font-bold text-amber-700 mt-1 tabular-nums">
                {toPersianDigits(metrics.lowCount)}
              </p>
            </div>
          </div>

          {/* Score Distribution Chart */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">توزیع امتیازهای دریافت‌شده</h3>
              <span className="text-xs text-slate-500 tabular-nums">
                بر اساس {toPersianDigits(metrics.scoredCount)} رای امتیازدار
              </span>
            </div>

            <div className="space-y-3">
              {metrics.distribution.map((row) => (
                <div key={row.star} className="flex items-center gap-3 text-xs">
                  <div className="w-20 flex items-center gap-1 font-medium text-slate-700 tabular-nums shrink-0">
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                    <span>{toPersianDigits(row.star)} ستاره</span>
                  </div>
                  <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        row.star >= 4
                          ? 'bg-emerald-600'
                          : row.star === 3
                          ? 'bg-amber-500'
                          : 'bg-red-500'
                      }`}
                      style={{ width: `${row.pct}%` }}
                    />
                  </div>
                  <div className="w-24 text-left font-mono text-slate-600 tabular-nums shrink-0">
                    {toPersianDigits(row.count)} ({toPersianDigits(row.pct)}٪)
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Responses Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : filteredResponses.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-semibold text-slate-900">هنوز پاسخی ثبت نشده است</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-6">
                  پس از قرار دادن گره «نظرسنجی» در جریان ربات و پاسخ‌گویی کاربران بله، نمودارها و لیست پاسخ‌ها اینجا نمایش داده می‌شود.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 bg-slate-50/70">
                      <th className="py-3 px-4 whitespace-nowrap">کاربر</th>
                      <th className="py-3 px-4 whitespace-nowrap">نظرسنجی</th>
                      <th className="py-3 px-4 whitespace-nowrap">امتیاز</th>
                      <th className="py-3 px-4 whitespace-nowrap">پاسخ‌های ثبت‌شده</th>
                      <th className="py-3 px-4 whitespace-nowrap">تاریخ</th>
                      <th className="py-3 px-4 whitespace-nowrap">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredResponses.map((resp) => (
                      <tr key={resp.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                          {resp.bale_user_name || resp.bale_user_id || 'کاربر بله'}
                        </td>
                        <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                          {(resp.survey_id && surveyTitleMap.get(resp.survey_id)) ||
                            'نظرسنجی جریان'}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          {resp.score !== null && resp.score !== undefined ? (
                            <span
                              className={
                                resp.score <= 2
                                  ? 'text-red-700 font-bold'
                                  : resp.score >= 4
                                  ? 'text-emerald-700 font-bold'
                                  : 'text-amber-700 font-bold'
                              }
                            >
                              {toPersianDigits(resp.score)} / ۵
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-600 max-w-md truncate">
                          {Object.entries(resp.answers_json || {})
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' · ') || '—'}
                        </td>
                        <td className="py-3 px-4 text-slate-500 tabular-nums whitespace-nowrap">
                          {formatJalaliDateTime(resp.date_created)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <button
                            type="button"
                            disabled={!token || busyId === resp.id}
                            onClick={() => handleDeleteResponse(resp.id)}
                            className="p-1.5 text-slate-400 hover:text-red-700 rounded-lg cursor-pointer disabled:opacity-40"
                            title="حذف پاسخ"
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
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : surveys.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-900">هنوز نظرسنجی تعریف نشده است</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-6">
                نظرسنجی‌های امتیازی یا چندسوالی بسازید تا بتوانید در طراح جریان گفتگو از آن‌ها استفاده کنید.
              </p>
              <button
                type="button"
                onClick={openNewSurvey}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>ساخت اولین نظرسنجی</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {surveys.map((survey) => (
                <div
                  key={survey.id}
                  className="p-5 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50/60"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span>{survey.type === 'rating' ? 'امتیازی ۱-۵' : 'چندسوالی'}</span>
                      <span>·</span>
                      <span className="tabular-nums">
                        {toPersianDigits(survey.questions_json.length)} سوال
                      </span>
                      <span>·</span>
                      <span>{survey.allow_multiple ? 'چندبار شرکت' : 'یک‌بار برای هر کاربر'}</span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">{survey.title}</h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditSurvey(survey)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>ویرایش</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === survey.id}
                      onClick={() => handleDeleteSurvey(survey.id)}
                      className="p-1.5 text-slate-400 hover:text-red-700 rounded-lg cursor-pointer disabled:opacity-40"
                      title="حذف نظرسنجی"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
