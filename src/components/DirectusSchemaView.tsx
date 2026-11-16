import React, { useState } from 'react';
import { Check, Copy, Database, KeyRound, ShieldCheck } from 'lucide-react';

interface FieldSpec {
  key: string;
  type: string;
  interfaceType: string;
  notes: string;
}

interface CollectionSpec {
  name: string;
  persianTitle: string;
  description: string;
  fields: FieldSpec[];
  permissionRule: string;
}

const COLLECTIONS: CollectionSpec[] = [
  {
    name: 'bots',
    persianTitle: 'بازوها (Bots)',
    description: 'نگهداری اطلاعات بازوهای بله، توکن ربات و وضعیت وب‌هوک هر کاربر.',
    permissionRule: '{ "user_created": { "_eq": "$CURRENT_USER" } }',
    fields: [
      { key: 'id', type: 'UUID (Primary Key)', interfaceType: 'Generated UUID', notes: 'کلید اصلی خودکار' },
      { key: 'name', type: 'String', interfaceType: 'Input (Required)', notes: 'نام نمایشی بازو' },
      { key: 'bale_username', type: 'String', interfaceType: 'Input', notes: 'نام کاربری بازو در بله (مثلاً @my_bot)' },
      { key: 'bot_token', type: 'String', interfaceType: 'Input (Required)', notes: 'توکن دریافتی از @BotFather بله' },
      { key: 'webhook_secret', type: 'String', interfaceType: 'Input (Unique, Required)', notes: 'کلید امنیتی مسیر وب‌هوک' },
      { key: 'webhook_status', type: 'String', interfaceType: 'Dropdown (active, inactive, error)', notes: 'مقدار پیش‌فرض: inactive' },
      { key: 'is_active', type: 'Boolean', interfaceType: 'Toggle', notes: 'مقدار پیش‌فرض: true' },
      { key: 'user_created', type: 'UUID (System)', interfaceType: 'M2O → directus_users', notes: 'فیلد سیستمی دایرکتوس (تیک User Created)' },
      { key: 'date_created', type: 'Timestamp (System)', interfaceType: 'Datetime', notes: 'فیلد سیستمی زمان ایجاد' },
      { key: 'date_updated', type: 'Timestamp (System)', interfaceType: 'Datetime', notes: 'فیلد سیستمی زمان بروزرسانی' },
    ],
  },
  {
    name: 'bot_flows',
    persianTitle: 'جریان‌های گفتگو (Bot Flows)',
    description: 'ذخیره ساختار گراف و گره‌های گفتگوی هر بازو در قالب JSON استاندارد.',
    permissionRule: '{ "bot_id": { "user_created": { "_eq": "$CURRENT_USER" } } }',
    fields: [
      { key: 'id', type: 'UUID (Primary Key)', interfaceType: 'Generated UUID', notes: 'کلید اصلی خودکار' },
      { key: 'bot_id', type: 'M2O (UUID)', interfaceType: 'Many-to-One → bots', notes: 'On Delete: Cascade (الزامی)' },
      { key: 'name', type: 'String', interfaceType: 'Input (Required)', notes: 'نام جریان گفتگو' },
      { key: 'version', type: 'Integer', interfaceType: 'Input', notes: 'مقدار پیش‌فرض: 1' },
      { key: 'is_published', type: 'Boolean', interfaceType: 'Toggle', notes: 'مقدار پیش‌فرض: true' },
      { key: 'flow_json', type: 'JSON', interfaceType: 'Code (JSON)', notes: 'ساختار کامل گره‌ها، دکمه‌ها و شرط‌ها' },
      { key: 'user_created', type: 'UUID (System)', interfaceType: 'M2O → directus_users', notes: 'فیلد سیستمی مالک رکورد' },
      { key: 'date_created', type: 'Timestamp (System)', interfaceType: 'Datetime', notes: 'فیلد سیستمی' },
      { key: 'date_updated', type: 'Timestamp (System)', interfaceType: 'Datetime', notes: 'فیلد سیستمی' },
    ],
  },
  {
    name: 'bot_sessions',
    persianTitle: 'نشست‌های کاربران بله (Sessions)',
    description: 'نگهداری وضعیت فعلی هر کاربر پیام‌رسان بله در ماشین وضعیت (همگام با کش Redis).',
    permissionRule: '{ "bot_id": { "user_created": { "_eq": "$CURRENT_USER" } } }',
    fields: [
      { key: 'id', type: 'UUID (Primary Key)', interfaceType: 'Generated UUID', notes: 'کلید اصلی' },
      { key: 'bot_id', type: 'M2O (UUID)', interfaceType: 'Many-to-One → bots', notes: 'On Delete: Cascade' },
      { key: 'bale_chat_id', type: 'String', interfaceType: 'Input (Required)', notes: 'شناسه چت کاربر در بله' },
      { key: 'bale_user_id', type: 'String', interfaceType: 'Input (Required)', notes: 'شناسه یکتای کاربر در بله' },
      { key: 'bale_user_name', type: 'String', interfaceType: 'Input', notes: 'نام نمایشی کاربر' },
      { key: 'current_node_id', type: 'String', interfaceType: 'Input', notes: 'گره فعلی کاربر در جریان' },
      { key: 'awaiting_field_key', type: 'String', interfaceType: 'Input', notes: 'کلید فیلدی که منتظر پاسخ آن هستیم' },
      { key: 'context_data', type: 'JSON', interfaceType: 'Code (JSON)', notes: 'مقادیر جمع‌آوری‌شده در طول گفتگو' },
      { key: 'last_interaction_at', type: 'Timestamp', interfaceType: 'Datetime', notes: 'زمان آخرین پیام کاربر' },
      { key: 'date_created', type: 'Timestamp (System)', interfaceType: 'Datetime', notes: 'فیلد سیستمی' },
    ],
  },
  {
    name: 'collected_form_data',
    persianTitle: 'داده‌های فرم‌های ثبت‌شده (Collected Forms)',
    description: 'ذخیره اطلاعات فرم‌های تکمیل‌شده توسط کاربران در پایان گره save_form.',
    permissionRule: '{ "bot_id": { "user_created": { "_eq": "$CURRENT_USER" } } }',
    fields: [
      { key: 'id', type: 'UUID (Primary Key)', interfaceType: 'Generated UUID', notes: 'کلید اصلی' },
      { key: 'bot_id', type: 'M2O (UUID)', interfaceType: 'Many-to-One → bots', notes: 'On Delete: Cascade' },
      { key: 'flow_id', type: 'M2O (UUID)', interfaceType: 'Many-to-One → bot_flows', notes: 'On Delete: Set Null (اختیاری)' },
      { key: 'bale_chat_id', type: 'String', interfaceType: 'Input (Required)', notes: 'شناسه چت در بله' },
      { key: 'bale_user_id', type: 'String', interfaceType: 'Input (Required)', notes: 'شناسه کاربر بله' },
      { key: 'bale_user_name', type: 'String', interfaceType: 'Input', notes: 'نام کاربر در بله' },
      { key: 'form_title', type: 'String', interfaceType: 'Input', notes: 'عنوان فرم یا مرحله ثبت' },
      { key: 'payload', type: 'JSON', interfaceType: 'Code (JSON)', notes: 'پاسخ‌های فرم به صورت کلید-مقدار' },
      { key: 'date_created', type: 'Timestamp (System)', interfaceType: 'Datetime', notes: 'فیلد سیستمی زمان ثبت' },
    ],
  },
  {
    name: 'webhook_logs',
    persianTitle: 'گزارش وب‌هوک‌ها (Webhook Logs)',
    description: 'ثبت رویدادهای ورودی بله، تاخیر پردازش صف و خطاهای احتمالی موتور اجرا.',
    permissionRule: '{ "bot_id": { "user_created": { "_eq": "$CURRENT_USER" } } }',
    fields: [
      { key: 'id', type: 'UUID (Primary Key)', interfaceType: 'Generated UUID', notes: 'کلید اصلی' },
      { key: 'bot_id', type: 'M2O (UUID)', interfaceType: 'Many-to-One → bots', notes: 'On Delete: Cascade' },
      { key: 'update_id', type: 'String', interfaceType: 'Input', notes: 'شناسه آپدیت ارسالی بله' },
      { key: 'event_type', type: 'String', interfaceType: 'Input (Required)', notes: 'message | callback_query | error | system' },
      { key: 'bale_chat_id', type: 'String', interfaceType: 'Input', notes: 'شناسه چت' },
      { key: 'incoming_text', type: 'Text', interfaceType: 'Textarea', notes: 'متن پیام یا callback_data ورودی' },
      { key: 'matched_node_id', type: 'String', interfaceType: 'Input', notes: 'شناسه گره اجراشده' },
      { key: 'status', type: 'String', interfaceType: 'Input (Required)', notes: 'queued | processed | failed' },
      { key: 'latency_ms', type: 'Integer', interfaceType: 'Input', notes: 'زمان پردازش بر حسب میلی‌ثانیه' },
      { key: 'error_message', type: 'Text', interfaceType: 'Textarea', notes: 'متن خطا در صورت شکست' },
      { key: 'date_created', type: 'Timestamp (System)', interfaceType: 'Datetime', notes: 'فیلد سیستمی' },
    ],
  },
];

export function DirectusSchemaView() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copyText(key: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  }

  return (
    <div className="space-y-8">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              معماری اتصال به دایرکتوس و احراز هویت کاربران
            </h2>
            <p className="text-sm text-slate-600 mt-1 leading-6">
              برای راه‌اندازی کامل بکند روی Directus، ۵ کالکشن زیر را با کلید اصلی{' '}
              <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">UUID</code>{' '}
              ایجاد کرده و متغیرهای محیطی سرور را مقداردهی کنید.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-200">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <KeyRound className="w-4 h-4 text-emerald-700" />
              <span>۱. متغیرهای محیطی (.env)</span>
            </div>
            <p className="text-xs text-slate-600 leading-5">
              مقادیر <code className="font-mono">DIRECTUS_URL</code>،{' '}
              <code className="font-mono">DIRECTUS_ADMIN_TOKEN</code> و{' '}
              <code className="font-mono">DIRECTUS_DEFAULT_ROLE_ID</code> را تنظیم کنید.
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <ShieldCheck className="w-4 h-4 text-emerald-700" />
              <span>۲. نقش کاربر (BotBuilderUser)</span>
            </div>
            <p className="text-xs text-slate-600 leading-5">
              برای کاربران ثبت‌نامی، دسترسی Read/Update/Delete را با فیلتر{' '}
              <code className="font-mono">$CURRENT_USER</code> محدود کنید تا داده‌های هر کاربر ایزوله بماند.
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <Database className="w-4 h-4 text-emerald-700" />
              <span>۳. کارگر وب‌هوک (Admin Token)</span>
            </div>
            <p className="text-xs text-slate-600 leading-5">
              درخواست‌های ورودی پیام‌رسان بله در صف ناهمگام قرار گرفته و با توکن سرور در کالکشن‌ها ثبت می‌شوند.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {COLLECTIONS.map((col, idx) => (
          <section key={col.name} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-slate-50/70">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold text-slate-500 tabular-nums">
                  0{idx + 1}.
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">{col.persianTitle}</h3>
                    <span className="text-xs text-slate-400">·</span>
                    <code className="text-xs font-mono font-semibold text-emerald-800" dir="ltr">
                      {col.name}
                    </code>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{col.description}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => copyText(col.name, col.permissionRule)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                {copiedKey === col.name ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                    <span>قانون دسترسی کپی شد</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500" />
                    <span>کپی Rule دسترسی نقش</span>
                  </>
                )}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 bg-white">
                    <th className="py-2.5 px-6">نام فیلد (Key)</th>
                    <th className="py-2.5 px-4">نوع در دیتابیس (Type)</th>
                    <th className="py-2.5 px-4">رابط دایرکتوس (Interface)</th>
                    <th className="py-2.5 px-6">توضیحات و تنظیمات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {col.fields.map((field) => (
                    <tr key={field.key} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-6 font-mono font-semibold text-slate-900" dir="ltr">
                        <div className="text-right">{field.key}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-700">{field.type}</td>
                      <td className="py-2.5 px-4 text-slate-700">{field.interfaceType}</td>
                      <td className="py-2.5 px-6 text-slate-600">{field.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-4 text-xs">
              <span className="text-slate-500 font-medium shrink-0">فیلتر دسترسی نقش کاربر:</span>
              <code className="font-mono text-slate-700 truncate" dir="ltr">
                {col.permissionRule}
              </code>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
