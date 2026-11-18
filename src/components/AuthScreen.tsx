import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CalendarCheck,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShoppingBag,
  User,
  Workflow,
} from 'lucide-react';
import { api, ApiError, type AuthResponse, type HealthResponse } from '../lib/api.ts';

interface AuthScreenProps {
  health: HealthResponse | null;
  onAuthenticated: (auth: AuthResponse) => void;
  onOpenPreviewStudio: () => void;
}

export function AuthScreen({ health, onAuthenticated, onOpenPreviewStudio }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const backendReady = health?.backendConfigured ?? true;

  function switchMode(nextMode: 'login' | 'register') {
    setMode(nextMode);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const auth =
        mode === 'login'
          ? await api.login(email.trim(), password)
          : await api.register({
              email: email.trim(),
              password,
              firstName: firstName.trim(),
              lastName: lastName.trim(),
            });
      onAuthenticated(auth);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('برقراری ارتباط با سرور با خطا مواجه شد. لطفاً دوباره تلاش کنید.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-white">
      {/* Auth Column */}
      <div className="lg:col-span-6 xl:col-span-5 flex flex-col justify-between px-6 py-8 sm:px-12 lg:px-14 bg-white">
        {/* Brand Lockup */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            <span className="text-base font-bold text-slate-900 whitespace-nowrap">بات‌روم</span>
          </div>
          <span className="text-xs font-mono text-slate-400 whitespace-nowrap" dir="ltr">
            app.botroom.ir
          </span>
        </div>

        {/* Form Container */}
        <div className="w-full max-w-md mx-auto my-auto py-10">
          <div className="mb-7">
            <h1 className="text-2xl font-bold text-slate-900 [text-wrap:balance]">
              {mode === 'login' ? 'ورود به پنل کاربری' : 'ایجاد حساب کاربری'}
            </h1>
            <p className="text-sm text-slate-500 mt-1.5 leading-6">
              {mode === 'login'
                ? 'برای مدیریت بازوها، سفارش‌ها و جریان‌های گفتگو وارد شوید.'
                : 'اطلاعات زیر را برای ساخت فضای کاری اختصاصی خود تکمیل کنید.'}
            </p>
          </div>

          <div
            role="tablist"
            aria-label="حالت احراز هویت"
            className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg mb-6"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => switchMode('login')}
              className={`py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ورود به حساب
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => switchMode('register')}
              className={`py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ثبت‌نام
            </button>
          </div>

          {health && !backendReady && (
            <div className="mb-5 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-6 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>
                سرویس احراز هویت در حال حاضر در دسترس نیست. لطفاً دقایقی دیگر مجدداً تلاش کنید.
              </span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-6 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="auth-first-name"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    نام
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="auth-first-name"
                      type="text"
                      required
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="نام"
                      className="w-full pr-9 pl-3 py-2.5 text-sm text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600/20"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="auth-last-name"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    نام خانوادگی
                  </label>
                  <input
                    id="auth-last-name"
                    type="text"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="نام خانوادگی"
                    className="w-full px-3 py-2.5 text-sm text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600/20"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                ایمیل
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  dir="ltr"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.ir"
                  className="w-full pr-9 pl-3 py-2.5 text-sm text-left text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600/20 font-mono"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="auth-password" className="text-xs font-medium text-slate-700">
                  رمز عبور
                </label>
                {mode === 'register' && (
                  <span className="text-[11px] text-slate-400">حداقل ۸ کاراکتر</span>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={mode === 'register' ? 8 : 1}
                  dir="ltr"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pr-9 pl-10 py-2.5 text-sm text-left text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600/20 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
            >
              <span>
                {submitting
                  ? mode === 'login'
                    ? 'در حال ورود...'
                    : 'در حال ایجاد حساب...'
                  : mode === 'login'
                  ? 'ورود به پنل'
                  : 'ساخت حساب کاربری'}
              </span>
              <ArrowLeft className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-200 flex items-center justify-between gap-4 text-xs text-slate-500">
            <span>دسترسی سریع به محیط آزمایشی</span>
            <button
              type="button"
              onClick={onOpenPreviewStudio}
              className="text-emerald-700 hover:text-emerald-800 hover:underline font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              باز کردن شبیه‌ساز جریان
            </button>
          </div>
        </div>

        {/* Quiet Footer */}
        <div className="flex items-center justify-between gap-4 text-xs text-slate-400">
          <span>بات‌روم · پنل مدیریت بازوهای پیام‌رسان بله</span>
        </div>
      </div>

      {/* Workspace Context Panel */}
      <aside className="hidden lg:flex lg:col-span-6 xl:col-span-7 bg-slate-900 text-white p-12 xl:p-16 flex-col justify-between border-r border-slate-800">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>میز کار ابری بات‌روم</span>
          <span>پیام‌رسان بله</span>
        </div>

        <div className="max-w-xl space-y-10 my-auto">
          <div className="space-y-3">
            <h2 className="text-2xl xl:text-3xl font-bold text-white leading-snug [text-wrap:balance]">
              مدیریت متمرکز بازوها، فروش، نوبت‌دهی و ارتباط با مشتریان
            </h2>
            <p className="text-sm text-slate-300 leading-7">
              تمام ابزارهای طراحی جریان گفتگو، فروشگاه درون‌پیام‌رسان، تقویم نوبت‌دهی شمسی و ارسال گروهی در یک پنل یکپارچه آماده استفاده است.
            </p>
          </div>

          <div className="divide-y divide-slate-800 border-y border-slate-800">
            <div className="py-4 flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <Workflow className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">طراح بصری جریان و شبیه‌ساز</h3>
                <p className="text-xs text-slate-400 mt-1 leading-6">
                  طراحی مسیرهای گفتگو با دکمه شیشه‌ای، شرط، فرم‌ساز و تست فوری پیش از انتشار
                </p>
              </div>
            </div>

            <div className="py-4 flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <ShoppingBag className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">کاتالوگ محصولات و مدیریت سفارش</h3>
                <p className="text-xs text-slate-400 mt-1 leading-6">
                  نمایش تعاملی محصولات، سبد خرید درون بله، پیگیری وضعیت و دریافت خروجی سفارش‌ها
                </p>
              </div>
            </div>

            <div className="py-4 flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <CalendarCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">نوبت‌دهی شمسی، CRM و کمپین گروهی</h3>
                <p className="text-xs text-slate-400 mt-1 leading-6">
                  رزرو خودکار با یادآور، برچسب‌گذاری مشتریان، نظرسنجی و ارسال پیام زمان‌بندی‌شده
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>دسترسی اختصاصی هر حساب کاربری به بازوها و داده‌ها</span>
          <span className="font-mono" dir="ltr">
            botroom.ir
          </span>
        </div>
      </aside>
    </div>
  );
}
