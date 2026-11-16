import React, { useState } from 'react';
import { ArrowLeft, Bot, Database, Lock, Mail, User } from 'lucide-react';
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const directusReady = health?.directusConfigured ?? false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const auth =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register({ email, password, firstName, lastName });
      onAuthenticated(auth);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('خطایی در برقراری ارتباط با دایرکتوس رخ داد.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            <span className="text-lg font-bold text-slate-900 whitespace-nowrap">بله‌ساز</span>
          </div>

          <button
            type="button"
            onClick={onOpenPreviewStudio}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Database className="w-3.5 h-3.5 text-emerald-700" />
            <span>راهنمای کالکشن‌های دایرکتوس و شبیه‌ساز جریان</span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-6 space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-medium text-emerald-700">
                پلتفرم ابری ساخت بازوی پیام‌رسان بله · متصل به دایرکتوس
              </p>
              <h1 className="text-3xl lg:text-4xl font-bold text-slate-900 leading-tight [text-wrap:balance]">
                بازوهای هوشمند بله را بدون درگیری با سرور و کدنویسی بسازید
              </h1>
              <p className="text-sm text-slate-600 leading-7 max-w-xl">
                جریان‌های گفتگو، دکمه‌های شیشه‌ای، فرم‌های چندمرحله‌ای و وب‌هوک‌های اختصاصی خود را در یک محیط یکپارچه مدیریت کنید. احراز هویت و ذخیره‌سازی داده‌ها مستقیماً روی بکند دایرکتوس شما انجام می‌شود.
              </p>
            </div>

            <div className="border-t border-slate-200 pt-6 grid grid-cols-3 gap-6">
              <div>
                <p className="text-sm font-semibold text-slate-900">وب‌هوک ناهمگام</p>
                <p className="text-xs text-slate-500 mt-1 leading-5">
                  صف پردازش با Redis بدون افت سرعت و تایم‌اوت بله
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">طراح جریان بومی</p>
                <p className="text-xs text-slate-500 mt-1 leading-5">
                  پشتیبانی از دستورات، دکمه شیشه‌ای، شرط و فرم
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">دیتابیس دایرکتوس</p>
                <p className="text-xs text-slate-500 mt-1 leading-5">
                  جداسازی کامل داده‌های هر کاربر با Role Permissions
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-slate-900">
                  {mode === 'login' ? 'ورود به پنل مدیریت' : 'ایجاد حساب کاربری جدید'}
                </h2>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      mode === 'login'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ورود
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      mode === 'register'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ثبت‌نام
                  </button>
                </div>
              </div>

              {health && !directusReady && (
                <div className="mb-5 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-6">
                  <p className="font-semibold mb-1">اتصال به دایرکتوس هنوز در سرور پیکربندی نشده است</p>
                  <p className="text-amber-800">
                    برای فعال‌سازی ورود و ثبت‌نام واقعی، متغیرهای{' '}
                    <code className="font-mono bg-amber-100 px-1 rounded">DIRECTUS_URL</code> و{' '}
                    <code className="font-mono bg-amber-100 px-1 rounded">DIRECTUS_ADMIN_TOKEN</code>{' '}
                    را در محیط سرور تنظیم کنید. همچنین می‌توانید همین الان از دکمه بالا وارد راهنمای ساختار دایرکتوس و شبیه‌ساز جریان شوید.
                  </p>
                </div>
              )}

              {error && (
                <div className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-6">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        نام
                      </label>
                      <div className="relative">
                        <User className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          required
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="مثلاً علی"
                          className="w-full pr-9 pl-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        نام خانوادگی
                      </label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="مثلاً محمدی"
                        className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    ایمیل حساب دایرکتوس
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="email"
                      required
                      dir="ltr"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.ir"
                      className="w-full pr-9 pl-3 py-2.5 text-sm text-left border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    رمز عبور
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="password"
                      required
                      minLength={mode === 'register' ? 8 : 1}
                      dir="ltr"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pr-9 pl-3 py-2.5 text-sm text-left border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600 font-mono"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>
                    {submitting
                      ? 'در حال ارتباط با دایرکتوس...'
                      : mode === 'login'
                      ? 'ورود با حساب دایرکتوس'
                      : 'ساخت حساب در دایرکتوس و ورود'}
                  </span>
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </form>

              <div className="mt-5 pt-5 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                <span>احراز هویت استاندارد JWT دایرکتوس</span>
                <button
                  type="button"
                  onClick={onOpenPreviewStudio}
                  className="text-emerald-700 hover:underline font-medium cursor-pointer"
                >
                  مشاهده پیش‌نمایش طراح جریان
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 px-6 text-center text-xs text-slate-500">
        بله‌ساز · زیرساخت ابری ساخت بازوی پیام‌رسان بله با بکند دایرکتوس
      </footer>
    </div>
  );
}
