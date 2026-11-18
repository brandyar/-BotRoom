import React, { useMemo, useState } from 'react';
import {
  BellRing,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type {
  AppointmentRecord,
  AppointmentStatus,
  BookingScheduleRecord,
  BookingServiceRecord,
} from '../types/bot.ts';
import {
  PERSIAN_WEEKDAYS,
  formatJalaliDateTime,
  formatPriceToman,
  toPersianDigits,
} from '../utils/jalali.ts';

interface BookingViewProps {
  token: string | null;
  botId: string | null;
  services: BookingServiceRecord[];
  schedules: BookingScheduleRecord[];
  appointments: AppointmentRecord[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onPreviewServicesChange?: (next: BookingServiceRecord[]) => void;
  onPreviewSchedulesChange?: (next: BookingScheduleRecord[]) => void;
}

const APPT_STATUS_META: Record<
  AppointmentStatus,
  { label: string; textColor: string; icon: React.ReactNode }
> = {
  pending: {
    label: 'در انتظار تایید',
    textColor: 'text-amber-700',
    icon: <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />,
  },
  confirmed: {
    label: 'تاییدشده',
    textColor: 'text-emerald-700',
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />,
  },
  cancelled: {
    label: 'لغوشده',
    textColor: 'text-red-700',
    icon: <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />,
  },
};

export function BookingView({
  token,
  botId,
  services,
  schedules,
  appointments,
  loading,
  onRefresh,
  onPreviewServicesChange,
  onPreviewSchedulesChange,
}: BookingViewProps) {
  const [subTab, setSubTab] = useState<'appointments' | 'schedules' | 'services'>('appointments');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AppointmentStatus>('all');
  const [serviceFilter, setServiceFilter] = useState<string>('all');

  // Service Form State
  const [svcFormOpen, setSvcFormOpen] = useState(false);
  const [editingSvcId, setEditingSvcId] = useState<string | null>(null);
  const [svcTitle, setSvcTitle] = useState('');
  const [svcDuration, setSvcDuration] = useState('30');
  const [svcCapacity, setSvcCapacity] = useState('1');
  const [svcPrice, setSvcPrice] = useState('0');
  const [svcDesc, setSvcDesc] = useState('');
  const [svcActive, setSvcActive] = useState(true);

  // Schedule Form State
  const [schFormOpen, setSchFormOpen] = useState(false);
  const [editingSchId, setEditingSchId] = useState<string | null>(null);
  const [schServiceId, setSchServiceId] = useState('');
  const [schWeekday, setSchWeekday] = useState('0');
  const [schStartTime, setSchStartTime] = useState('09:00');
  const [schEndTime, setSchEndTime] = useState('13:00');
  const [schBlockedDates, setSchBlockedDates] = useState('');
  const [schActive, setSchActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serviceMap = useMemo(
    () => new Map<string, BookingServiceRecord>(services.map((s) => [s.id, s])),
    [services]
  );

  const stats = useMemo(() => {
    let confirmed = 0;
    let pending = 0;
    let cancelled = 0;
    for (const a of appointments) {
      if (a.status === 'confirmed') confirmed += 1;
      else if (a.status === 'pending') pending += 1;
      else if (a.status === 'cancelled') cancelled += 1;
    }
    return { total: appointments.length, confirmed, pending, cancelled };
  }, [appointments]);

  const filteredAppointments = useMemo(() => {
    const q = query.trim().toLowerCase();
    return appointments.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (serviceFilter !== 'all' && a.service_id !== serviceFilter) return false;
      if (!q) return true;
      const svcTitleText = serviceMap.get(a.service_id)?.title || '';
      return (
        (a.bale_user_name || '').toLowerCase().includes(q) ||
        (a.customer_phone || '').toLowerCase().includes(q) ||
        (a.jalali_date || '').toLowerCase().includes(q) ||
        svcTitleText.toLowerCase().includes(q)
      );
    });
  }, [appointments, statusFilter, serviceFilter, query, serviceMap]);

  function openNewServiceForm() {
    setEditingSvcId(null);
    setSvcTitle('');
    setSvcDuration('30');
    setSvcCapacity('1');
    setSvcPrice('0');
    setSvcDesc('');
    setSvcActive(true);
    setSvcFormOpen(true);
    setError(null);
  }

  function openEditServiceForm(svc: BookingServiceRecord) {
    setEditingSvcId(svc.id);
    setSvcTitle(svc.title);
    setSvcDuration(String(svc.duration_minutes || 30));
    setSvcCapacity(String(svc.capacity_per_slot || 1));
    setSvcPrice(String(svc.price || 0));
    setSvcDesc(svc.description || '');
    setSvcActive(svc.is_active !== false);
    setSvcFormOpen(true);
    setError(null);
  }

  async function handleSaveService(e: React.FormEvent) {
    e.preventDefault();
    if (!svcTitle.trim()) {
      setError('عنوان خدمت نوبت‌دهی الزامی است.');
      return;
    }

    const durationVal = Math.max(5, Number(svcDuration) || 30);
    const capacityVal = Math.max(1, Number(svcCapacity) || 1);
    const priceVal = Math.max(0, Number(svcPrice) || 0);

    if (!token || !botId) {
      if (onPreviewServicesChange) {
        if (editingSvcId) {
          onPreviewServicesChange(
            services.map((s) =>
              s.id === editingSvcId
                ? {
                    ...s,
                    title: svcTitle.trim(),
                    duration_minutes: durationVal,
                    capacity_per_slot: capacityVal,
                    price: priceVal,
                    description: svcDesc.trim() || null,
                    is_active: svcActive,
                  }
                : s
            )
          );
        } else {
          onPreviewServicesChange([
            {
              id: `prev_svc_${Date.now()}`,
              bot_id: 'simulator-bot',
              title: svcTitle.trim(),
              duration_minutes: durationVal,
              capacity_per_slot: capacityVal,
              price: priceVal,
              description: svcDesc.trim() || null,
              is_active: svcActive,
            },
            ...services,
          ]);
        }
        setSvcFormOpen(false);
        return;
      }
      setError('برای ذخیره در دایرکتوس وارد حساب کاربری شوید.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: svcTitle.trim(),
        duration_minutes: durationVal,
        capacity_per_slot: capacityVal,
        price: priceVal,
        description: svcDesc.trim() || null,
        is_active: svcActive,
      };
      if (editingSvcId) {
        await api.updateBookingService(token, botId, editingSvcId, payload);
      } else {
        await api.createBookingService(token, botId, payload);
      }
      setSvcFormOpen(false);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ذخیره خدمت ناموفق بود.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteService(svcId: string) {
    if (!token || !botId) {
      if (onPreviewServicesChange) {
        onPreviewServicesChange(services.filter((s) => s.id !== svcId));
      }
      return;
    }
    setBusyId(svcId);
    setError(null);
    try {
      await api.deleteBookingService(token, botId, svcId);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حذف خدمت ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  }

  function openNewScheduleForm() {
    setEditingSchId(null);
    setSchServiceId(services[0]?.id || '');
    setSchWeekday('0');
    setSchStartTime('09:00');
    setSchEndTime('13:00');
    setSchBlockedDates('');
    setSchActive(true);
    setSchFormOpen(true);
    setError(null);
  }

  function openEditScheduleForm(sch: BookingScheduleRecord) {
    setEditingSchId(sch.id);
    setSchServiceId(sch.service_id);
    setSchWeekday(String(sch.weekday));
    setSchStartTime(sch.start_time);
    setSchEndTime(sch.end_time);
    setSchBlockedDates((sch.blocked_dates || []).join('، '));
    setSchActive(sch.is_active !== false);
    setSchFormOpen(true);
    setError(null);
  }

  async function handleSaveSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!schServiceId) {
      setError('ابتدا باید یک خدمت نوبت‌دهی انتخاب یا ایجاد کنید.');
      return;
    }
    const blockedArr = schBlockedDates
      .split(/[،,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!token || !botId) {
      if (onPreviewSchedulesChange) {
        if (editingSchId) {
          onPreviewSchedulesChange(
            schedules.map((s) =>
              s.id === editingSchId
                ? {
                    ...s,
                    service_id: schServiceId,
                    weekday: Number(schWeekday),
                    start_time: schStartTime,
                    end_time: schEndTime,
                    blocked_dates: blockedArr,
                    is_active: schActive,
                  }
                : s
            )
          );
        } else {
          onPreviewSchedulesChange([
            {
              id: `prev_sch_${Date.now()}`,
              bot_id: 'simulator-bot',
              service_id: schServiceId,
              weekday: Number(schWeekday),
              start_time: schStartTime,
              end_time: schEndTime,
              blocked_dates: blockedArr,
              is_active: schActive,
            },
            ...schedules,
          ]);
        }
        setSchFormOpen(false);
        return;
      }
      setError('برای ذخیره زمان‌بندی وارد حساب شوید.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingSchId) {
        await api.updateBookingSchedule(token, botId, editingSchId, {
          weekday: Number(schWeekday),
          start_time: schStartTime,
          end_time: schEndTime,
          blocked_dates: blockedArr,
          is_active: schActive,
        });
      } else {
        await api.createBookingSchedule(token, botId, {
          service_id: schServiceId,
          weekday: Number(schWeekday),
          start_time: schStartTime,
          end_time: schEndTime,
          blocked_dates: blockedArr,
          is_active: schActive,
        });
      }
      setSchFormOpen(false);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ذخیره زمان‌بندی ناموفق بود.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSchedule(schId: string) {
    if (!token || !botId) {
      if (onPreviewSchedulesChange) {
        onPreviewSchedulesChange(schedules.filter((s) => s.id !== schId));
      }
      return;
    }
    setBusyId(schId);
    try {
      await api.deleteBookingSchedule(token, botId, schId);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حذف زمان‌بندی ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpdateAppointmentStatus(apptId: string, status: AppointmentStatus) {
    if (!token || !botId) return;
    setBusyId(apptId);
    setError(null);
    try {
      await api.updateAppointment(token, botId, apptId, { status });
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'بروزرسانی وضعیت نوبت ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteAppointment(apptId: string) {
    if (!token || !botId) return;
    setBusyId(apptId);
    try {
      await api.deleteAppointment(token, botId, apptId);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حذف نوبت ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleSendRemindersNow() {
    if (!token || !botId) return;
    setSendingReminders(true);
    setNotice(null);
    setError(null);
    try {
      const res = await api.sendAppointmentReminders(token, botId);
      setNotice(
        `بررسی انجام شد: ${toPersianDigits(res.checked)} نوبت در بازه ۲۴ ساعته · ${toPersianDigits(
          res.sent
        )} یادآور ارسال شد.`
      );
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ارسال یادآورها ناموفق بود.');
    } finally {
      setSendingReminders(false);
    }
  }

  function exportAppointmentsCsv() {
    if (filteredAppointments.length === 0) return;
    const headers = [
      'شناسه نوبت',
      'خدمت',
      'تاریخ و ساعت شمسی',
      'نام مراجع',
      'شماره موبایل',
      'شناسه چت بله',
      'وضعیت',
      'وضعیت یادآور ۲۴ ساعته',
    ];
    const rows = filteredAppointments.map((a) => [
      a.id,
      serviceMap.get(a.service_id)?.title || a.service_id,
      a.jalali_date || formatJalaliDateTime(a.appointment_at),
      a.bale_user_name || '',
      a.customer_phone || '',
      a.bale_chat_id,
      APPT_STATUS_META[a.status]?.label || a.status,
      a.reminder_sent ? 'ارسال شده' : 'در انتظار',
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appointments-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header & Sub-tab Switcher */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setSubTab('appointments')}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'appointments'
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span className="tabular-nums">
              نوبت‌های رزروشده ({toPersianDigits(appointments.length)})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('schedules')}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'schedules'
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span className="tabular-nums">
              تقویم و ساعات کاری ({toPersianDigits(schedules.length)})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('services')}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'services'
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <span>خدمات نوبت‌دهی ({toPersianDigits(services.length)})</span>
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {subTab === 'appointments' && (
            <>
              <button
                type="button"
                disabled={!token || sendingReminders}
                onClick={handleSendRemindersNow}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
              >
                <BellRing className="w-3.5 h-3.5" />
                <span>
                  {sendingReminders ? 'در حال ارسال...' : 'ارسال یادآورهای ۲۴ ساعت آینده'}
                </span>
              </button>

              <button
                type="button"
                disabled={filteredAppointments.length === 0}
                onClick={exportAppointmentsCsv}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>خروجی اکسل</span>
              </button>
            </>
          )}

          {subTab === 'schedules' && (
            <button
              type="button"
              onClick={openNewScheduleForm}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>افزودن ساعت کاری هفتگی</span>
            </button>
          )}

          {subTab === 'services' && (
            <button
              type="button"
              onClick={openNewServiceForm}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>افزودن خدمت جدید</span>
            </button>
          )}

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

      {/* ---------------- SUBTAB 1: APPOINTMENTS ---------------- */}
      {subTab === 'appointments' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">کل نوبت‌ها</p>
              <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
                {toPersianDigits(stats.total)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">تاییدشده</p>
              <p className="text-xl font-bold text-emerald-700 mt-1 tabular-nums">
                {toPersianDigits(stats.confirmed)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">در انتظار تایید</p>
              <p className="text-xl font-bold text-amber-700 mt-1 tabular-nums">
                {toPersianDigits(stats.pending)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">لغوشده</p>
              <p className="text-xl font-bold text-slate-700 mt-1 tabular-nums">
                {toPersianDigits(stats.cancelled)}
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جستجو بر اساس نام مراجع، موبایل، تاریخ شمسی یا خدمت..."
                className="w-full pr-9 pl-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | AppointmentStatus)}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">همه وضعیت‌ها</option>
              <option value="confirmed">تاییدشده</option>
              <option value="pending">در انتظار تایید</option>
              <option value="cancelled">لغوشده</option>
            </select>

            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">همه خدمات</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>

          {filteredAppointments.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
              <Calendar className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-800">هنوز نوبتی ثبت نشده است</p>
              <p className="text-xs text-slate-500">
                پس از تعریف خدمات و ساعت‌های کاری و اتصال گره «رزرو و نوبت‌دهی شمسی» در طراح
                جریان، نوبت‌های کاربران بله اینجا نمایش داده می‌شوند.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">زمان نوبت (شمسی)</th>
                      <th className="py-3 px-4">خدمت</th>
                      <th className="py-3 px-4">مراجع بله</th>
                      <th className="py-3 px-4">شماره تماس</th>
                      <th className="py-3 px-4">وضعیت</th>
                      <th className="py-3 px-4">یادآور ۲۴ ساعته</th>
                      <th className="py-3 px-4 text-left">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredAppointments.map((appt) => {
                      const statusMeta = APPT_STATUS_META[appt.status] || APPT_STATUS_META.pending;
                      const svc = serviceMap.get(appt.service_id);
                      return (
                        <tr key={appt.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-semibold text-slate-900 tabular-nums">
                            {appt.jalali_date || formatJalaliDateTime(appt.appointment_at)}
                          </td>
                          <td className="py-3 px-4 text-slate-700">
                            {svc?.title || 'خدمت حذف‌شده'}
                          </td>
                          <td className="py-3 px-4 text-slate-700">
                            {appt.bale_user_name || 'کاربر بله'}
                            <span className="text-slate-400 mx-1">·</span>
                            <span className="font-mono text-[11px] text-slate-500" dir="ltr">
                              {appt.bale_chat_id}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-700 tabular-nums" dir="ltr">
                            <div className="text-right">{appt.customer_phone || '—'}</div>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center gap-1.5 font-medium ${statusMeta.textColor}`}
                            >
                              {statusMeta.icon}
                              <span>{statusMeta.label}</span>
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            {appt.reminder_sent ? 'ارسال شده' : 'در انتظار موعد'}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-end gap-1.5">
                              {appt.status !== 'confirmed' && (
                                <button
                                  type="button"
                                  disabled={busyId === appt.id}
                                  onClick={() =>
                                    void handleUpdateAppointmentStatus(appt.id, 'confirmed')
                                  }
                                  className="px-2.5 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-md cursor-pointer whitespace-nowrap"
                                >
                                  تایید
                                </button>
                              )}
                              {appt.status !== 'cancelled' && (
                                <button
                                  type="button"
                                  disabled={busyId === appt.id}
                                  onClick={() =>
                                    void handleUpdateAppointmentStatus(appt.id, 'cancelled')
                                  }
                                  className="px-2.5 py-1 text-[11px] font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-md cursor-pointer whitespace-nowrap"
                                >
                                  لغو
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busyId === appt.id}
                                onClick={() => void handleDeleteAppointment(appt.id)}
                                className="p-1.5 text-slate-400 hover:text-red-700 rounded-md cursor-pointer"
                                title="حذف نوبت"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- SUBTAB 2: SCHEDULES ---------------- */}
      {subTab === 'schedules' && (
        <div className="space-y-4">
          {schFormOpen && (
            <form
              onSubmit={handleSaveSchedule}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">
                  {editingSchId ? 'ویرایش بازه کاری هفتگی' : 'افزودن بازه کاری جدید'}
                </h3>
                <button
                  type="button"
                  onClick={() => setSchFormOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">خدمت</label>
                  <select
                    value={schServiceId}
                    disabled={Boolean(editingSchId)}
                    onChange={(e) => setSchServiceId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-50"
                  >
                    <option value="">انتخاب خدمت...</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">روز هفته</label>
                  <select
                    value={schWeekday}
                    onChange={(e) => setSchWeekday(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    {PERSIAN_WEEKDAYS.map((dayName, idx) => (
                      <option key={idx} value={idx}>
                        {dayName} ({toPersianDigits(idx)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ساعت شروع (Asia/Tehran)
                  </label>
                  <input
                    type="time"
                    dir="ltr"
                    value={schStartTime}
                    onChange={(e) => setSchStartTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ساعت پایان (Asia/Tehran)
                  </label>
                  <input
                    type="time"
                    dir="ltr"
                    value={schEndTime}
                    onChange={(e) => setSchEndTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  تاریخ‌های مسدود یا تعطیل (اختیاری — با کاما جدا کنید، مثلاً 1405/01/13)
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={schBlockedDates}
                  onChange={(e) => setSchBlockedDates(e.target.value)}
                  placeholder="1405/01/13, 2026-04-02"
                  className="w-full px-3 py-2 text-xs font-mono text-left border border-slate-200 rounded-lg"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={schActive}
                    onChange={(e) => setSchActive(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>این بازه کاری فعال باشد</span>
                </label>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'در حال ذخیره...' : 'ذخیره زمان‌بندی'}</span>
                </button>
              </div>
            </form>
          )}

          {schedules.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
              <Clock className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-800">
                هنوز ساعت کاری هفتگی تعریف نشده است
              </p>
              <p className="text-xs text-slate-500">
                برای محاسبه خودکار ساعت‌های آزاد در تقویم شمسی، روزها و ساعات کاری هر خدمت را
                اضافه کنید.
              </p>
              {services.length === 0 && (
                <p className="text-xs text-amber-700">
                  ابتدا از تب «خدمات نوبت‌دهی» حداقل یک خدمت ایجاد کنید.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {schedules.map((sch) => {
                const svc = serviceMap.get(sch.service_id);
                return (
                  <div
                    key={sch.id}
                    className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-slate-900">
                          {PERSIAN_WEEKDAYS[sch.weekday] || `روز ${sch.weekday}`}
                        </h4>
                        <p className="text-xs text-slate-500 truncate mt-0.5">
                          {svc?.title || 'خدمت نامشخص'}
                        </p>
                      </div>
                      <span
                        className={`text-[11px] font-semibold ${
                          sch.is_active !== false ? 'text-emerald-700' : 'text-slate-400'
                        }`}
                      >
                        {sch.is_active !== false ? 'فعال' : 'غیرفعال'}
                      </span>
                    </div>

                    <div className="text-xs text-slate-700 font-mono tabular-nums" dir="ltr">
                      <div className="text-right">
                        {sch.start_time} – {sch.end_time}
                        {svc ? ` · هر نوبت ${toPersianDigits(svc.duration_minutes)} دقیقه` : ''}
                      </div>
                    </div>

                    {sch.blocked_dates && sch.blocked_dates.length > 0 && (
                      <p className="text-[11px] text-amber-800 truncate tabular-nums">
                        تاریخ‌های مسدود: {sch.blocked_dates.join(' · ')}
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => openEditScheduleForm(sch)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>ویرایش</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyId === sch.id}
                        onClick={() => void handleDeleteSchedule(sch.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>حذف</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---------------- SUBTAB 3: SERVICES ---------------- */}
      {subTab === 'services' && (
        <div className="space-y-4">
          {svcFormOpen && (
            <form
              onSubmit={handleSaveService}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">
                  {editingSvcId ? 'ویرایش خدمت نوبت‌دهی' : 'ایجاد خدمت نوبت‌دهی جدید'}
                </h3>
                <button
                  type="button"
                  onClick={() => setSvcFormOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    عنوان خدمت یا تخصص
                  </label>
                  <input
                    type="text"
                    required
                    value={svcTitle}
                    onChange={(e) => setSvcTitle(e.target.value)}
                    placeholder="مثلاً: مشاوره عمومی و ویزیت"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    مدت هر نوبت (دقیقه)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    dir="ltr"
                    value={svcDuration}
                    onChange={(e) => setSvcDuration(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono text-left border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ظرفیت همزمان در هر ساعت
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    dir="ltr"
                    value={svcCapacity}
                    onChange={(e) => setSvcCapacity(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono text-left border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    هزینه / بیعانه (تومان — ۰ برای رایگان)
                  </label>
                  <input
                    type="number"
                    min={0}
                    dir="ltr"
                    value={svcPrice}
                    onChange={(e) => setSvcPrice(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono text-left border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    توضیحات کوتاه (اختیاری)
                  </label>
                  <input
                    type="text"
                    value={svcDesc}
                    onChange={(e) => setSvcDesc(e.target.value)}
                    placeholder="توضیح مختصر درباره این خدمت..."
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={svcActive}
                    onChange={(e) => setSvcActive(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>در ربات بله قابل رزرو باشد</span>
                </label>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'در حال ذخیره...' : 'ذخیره خدمت'}</span>
                </button>
              </div>
            </form>
          )}

          {services.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
              <Calendar className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-800">
                هنوز هیچ خدمت نوبت‌دهی تعریف نشده است
              </p>
              <p className="text-xs text-slate-500">
                ابتدا خدمات قابل رزرو (مانند ویزیت، مشاوره تلفنی یا تعمیر) را ثبت کنید، سپس ساعات
                کاری آن را مشخص نمایید.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {services.map((svc) => {
                const schCount = schedules.filter((s) => s.service_id === svc.id).length;
                return (
                  <div
                    key={svc.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-bold text-slate-900">{svc.title}</h4>
                        <span
                          className={`text-[11px] font-semibold shrink-0 ${
                            svc.is_active !== false ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          {svc.is_active !== false ? 'فعال' : 'غیرفعال'}
                        </span>
                      </div>
                      {svc.description && (
                        <p className="text-xs text-slate-600 line-clamp-2">{svc.description}</p>
                      )}
                      <div className="text-xs text-slate-500 space-y-1 pt-1 tabular-nums">
                        <p>
                          مدت: {toPersianDigits(svc.duration_minutes)} دقیقه · ظرفیت:{' '}
                          {toPersianDigits(svc.capacity_per_slot)} نفر در هر اسلات
                        </p>
                        <p>
                          هزینه: {svc.price > 0 ? formatPriceToman(svc.price) : 'رایگان'} ·{' '}
                          {toPersianDigits(schCount)} بازه کاری ثبت‌شده
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => openEditServiceForm(svc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>ویرایش</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyId === svc.id}
                        onClick={() => void handleDeleteService(svc.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>حذف</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
