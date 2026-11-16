# راهنمای ساخت کالکشن‌ها و تنظیمات دایرکتوس (Directus Schema Guide)

این پروژه از **Directus** به عنوان بکند اصلی، پایگاه‌داده و سیستم احراز هویت کاربران استفاده می‌کند.

---

## ۱. تنظیمات اولیه احراز هویت کاربران (Role & Registration)

1. در پنل مدیریت دایرکتوس به مسیر **Settings → Roles & Permissions** بروید.
2. یک نقش جدید با نام `BotBuilderUser` (یا نام دلخواه) بسازید.
3. **UUID** این نقش را از نوار آدرس مرورگر کپی کرده و در متغیر محیطی `DIRECTUS_DEFAULT_ROLE_ID` قرار دهید.
4. یک **Static Token** برای کاربر ادمین بسازید (در پروفایل کاربر ادمین → Token) و در `DIRECTUS_ADMIN_TOKEN` قرار دهید. (سرور Express از این توکن برای ثبت‌نام کاربران جدید و پردازش وب‌هوک‌های ورودی پیام‌رسان بله استفاده می‌کند.)

---

## ۲. کالکشن‌ها و فیلدهای مورد نیاز (۵ کالکشن)

در **Settings → Data Model** کالکشن‌های زیر را با **Primary Key از نوع Generated UUID** و فعال‌سازی فیلدهای سیستمی (`user_created`, `date_created`, `date_updated`) ایجاد کنید:

### الف) کالکشن `bots` (اطلاعات بازوها)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `name` | `String` | Required — نام نمایشی بازو |
| `bale_username` | `String` | Optional — نام کاربری بازو در بله (مثلاً `@my_bot`) |
| `bot_token` | `String` | Required — توکن دریافتی از `@BotFather` بله |
| `webhook_secret` | `String` | Required, Unique — کلید امنیتی مسیر وب‌هوک |
| `webhook_status` | `String` | Default: `inactive` (`active`, `inactive`, `error`) |
| `is_active` | `Boolean` | Default: `true` |
| `user_created` | `UUID` (System) | M2O → `directus_users` |
| `date_created` | `Timestamp` (System) | On Create |
| `date_updated` | `Timestamp` (System) | On Update |

### ب) کالکشن `bot_flows` (جریان‌های گفتگو)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`) |
| `name` | `String` | Required — نام سناریوی گفتگو |
| `version` | `Integer` | Default: `1` |
| `is_published` | `Boolean` | Default: `true` |
| `flow_json` | `JSON` | Required — درخت گره‌ها و دکمه‌های جریان |
| `user_created` | `UUID` (System) | M2O → `directus_users` |
| `date_created` | `Timestamp` (System) | On Create |
| `date_updated` | `Timestamp` (System) | On Update |

### ج) کالکشن `bot_sessions` (وضعیت مکالمه کاربران بله)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`) |
| `bale_chat_id` | `String` | Required — شناسه چت در بله |
| `bale_user_id` | `String` | Required — شناسه کاربری در بله |
| `bale_user_name` | `String` | Optional — نام نمایشی کاربر |
| `current_node_id` | `String` | Optional — شناسه گره فعلی در ماشین وضعیت |
| `awaiting_field_key` | `String` | Optional — فیلدی که بازو منتظر دریافت آن است |
| `context_data` | `JSON` | Default: `{}` — داده‌های موقت نشست |
| `last_interaction_at` | `Timestamp` | زمان آخرین تعامل کاربر |
| `date_created` | `Timestamp` (System) | On Create |

### د) کالکشن `collected_form_data` (داده‌های فرم‌های جمع‌آوری‌شده)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`) |
| `flow_id` | `M2O` (`UUID`) | Related Collection: `bot_flows` (On Delete: `Set Null`) |
| `bale_chat_id` | `String` | Required |
| `bale_user_id` | `String` | Required |
| `bale_user_name` | `String` | Optional |
| `form_title` | `String` | Optional — عنوان فرم |
| `payload` | `JSON` | Required — کلید/مقدارهای ثبت‌شده توسط کاربر |
| `date_created` | `Timestamp` (System) | On Create |

### هـ) کالکشن `webhook_logs` (گزارش صف و وب‌هوک‌ها)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`) |
| `update_id` | `String` | Optional — شناسه آپدیت بله |
| `event_type` | `String` | `message` \| `callback_query` \| `error` \| `system` |
| `bale_chat_id` | `String` | Optional |
| `incoming_text` | `Text` | Optional |
| `matched_node_id` | `String` | Optional |
| `status` | `String` | `queued` \| `processed` \| `failed` |
| `latency_ms` | `Integer` | Optional |
| `error_message` | `Text` | Optional |
| `date_created` | `Timestamp` (System) | On Create |

---

## ۳. دسترسی‌های نقش `BotBuilderUser` (Permissions)

برای جداسازی داده‌های هر کاربر SaaS (Multi-Tenancy):

- **`bots`**:
  - `Create`: All
  - `Read` / `Update` / `Delete`: Custom Rule → `{ "user_created": { "_eq": "$CURRENT_USER" } }`
- **`bot_flows`**:
  - `Create`: All
  - `Read` / `Update` / `Delete`: Custom Rule → `{ "bot_id": { "user_created": { "_eq": "$CURRENT_USER" } } }`
- **`bot_sessions`**, **`collected_form_data`**, **`webhook_logs`**:
  - `Read` (و در صورت نیاز `Delete`): Custom Rule → `{ "bot_id": { "user_created": { "_eq": "$CURRENT_USER" } } }`
  - (درج رکورد در این ۳ کالکشن توسط کارگر وب‌هوک سرور با استفاده از `DIRECTUS_ADMIN_TOKEN` انجام می‌شود.)
- **`directus_users`**:
  - `Read` / `Update`: Self (`{ "id": { "_eq": "$CURRENT_USER" } }`)
