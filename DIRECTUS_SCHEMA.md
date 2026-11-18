# راهنمای ساخت کالکشن‌ها و تنظیمات دایرکتوس (Directus Schema Guide)

این پروژه از **Directus** به عنوان بکند اصلی، پایگاه‌داده و سیستم احراز هویت کاربران استفاده می‌کند.

---

## ۱. تنظیمات اولیه احراز هویت کاربران (Role & Registration)

1. در پنل مدیریت دایرکتوس به مسیر **Settings → Roles & Permissions** بروید.
2. یک نقش جدید با نام `BotBuilderUser` (یا نام دلخواه) بسازید.
3. **UUID** این نقش را از نوار آدرس مرورگر کپی کرده و در متغیر محیطی `DIRECTUS_DEFAULT_ROLE_ID` قرار دهید.
4. یک **Static Token** برای کاربر ادمین بسازید (در پروفایل کاربر ادمین → Token) و در `DIRECTUS_ADMIN_TOKEN` قرار دهید. (سرور Express از این توکن برای ثبت‌نام کاربران جدید و پردازش وب‌هوک‌های ورودی پیام‌رسان بله استفاده می‌کند.)

---

## ۲. کالکشن‌ها و فیلدهای مورد نیاز (۱۴ کالکشن)

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

### و) کالکشن `bot_contacts` (مشتریان و مخاطبین CRM — فاز ۱)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`, Required) |
| `bale_user_id` | `String` | Required — شناسه یکتای کاربر در بله |
| `bale_chat_id` | `String` | Required — شناسه چت در بله |
| `first_name` | `String` | Optional — نام کاربر |
| `last_name` | `String` | Optional — نام خانوادگی کاربر |
| `bale_username` | `String` | Optional — نام کاربری بله |
| `phone` | `String` | Optional — شماره موبایل نرمال‌شده (`09...`) |
| `tags` | `JSON` | Default: `[]` — آرایه برچسب‌ها (مثلاً `["VIP"]`) |
| `custom_fields` | `JSON` | Default: `{}` — فیلدهای تکمیلی CRM |
| `is_blocked` | `Boolean` | Default: `false` |
| `last_interaction_at` | `Timestamp` | زمان آخرین تعامل کاربر |
| `date_created` | `Timestamp` (System) | On Create |
| `date_updated` | `Timestamp` (System) | On Update |

### ز) کالکشن `products` (محصولات و خدمات کاتالوگ — فاز ۳)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`, Required) |
| `title` | `String` | Required — نام محصول یا خدمت |
| `description` | `Text` | Optional — توضیحات محصول |
| `category` | `String` | Optional — دسته‌بندی محصول |
| `price` | `BigInteger` / `Integer` | Required — قیمت به تومان |
| `stock` | `Integer` | Optional — موجودی انبار (خالی = نامحدود) |
| `image_url` | `String` | Optional — لینک تصویر برای `sendPhoto` |
| `is_active` | `Boolean` | Default: `true` |
| `date_created` | `Timestamp` (System) | On Create |
| `date_updated` | `Timestamp` (System) | On Update |

### ح) کالکشن `bot_orders` (سفارش‌های ثبت‌شده در بله — فاز ۳)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`, Required) |
| `contact_id` | `M2O` (`UUID`) | Related Collection: `bot_contacts` (On Delete: `Set Null`, Optional) |
| `bale_chat_id` | `String` | Optional — شناسه چت سفارش‌دهنده |
| `bale_user_name` | `String` | Optional — نام نمایشی سفارش‌دهنده |
| `items` | `JSON` | Required — آرایه اقلام سفارش |
| `total_amount` | `BigInteger` / `Integer` | Required — جمع کل سفارش (تومان) |
| `status` | `String` | Default: `pending` (`pending` \| `confirmed` \| `cancelled`) |
| `note` | `Text` | Optional — توضیحات یا یادداشت اپراتور |
| `date_created` | `Timestamp` (System) | On Create |
| `date_updated` | `Timestamp` (System) | On Update |

### ط) کالکشن `surveys` (نظرسنجی‌ها — فاز ۳)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`, Required) |
| `title` | `String` | Required — عنوان نظرسنجی |
| `type` | `String` | Default: `rating` (`rating` \| `multi_choice`) |
| `questions_json` | `JSON` | Optional — آرایه سوالات نظرسنجی |
| `allow_multiple` | `Boolean` | Default: `true` — امکان شرکت مجدد کاربر |
| `date_created` | `Timestamp` (System) | On Create |
| `date_updated` | `Timestamp` (System) | On Update |

### ی) کالکشن `survey_responses` (پاسخ‌های نظرسنجی — فاز ۳)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `survey_id` | `M2O` (`UUID`) | Related Collection: `surveys` (On Delete: `Cascade`, Required) |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`, Required) |
| `contact_id` | `M2O` (`UUID`) | Related Collection: `bot_contacts` (On Delete: `Set Null`, Optional) |
| `bale_chat_id` | `String` | Optional — شناسه چت کاربر |
| `bale_user_name` | `String` | Optional — نام کاربر |
| `answers_json` | `JSON` | Required — پاسخ‌های کاربر |
| `score` | `Integer` | Optional — امتیاز عددی ۱ تا ۵ |
| `date_created` | `Timestamp` (System) | On Create |

### ک) کالکشن `booking_services` (خدمات نوبت‌دهی — فاز ۴)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`, Required) |
| `title` | `String` | Required — عنوان خدمت نوبت‌دهی |
| `description` | `Text` | Optional — توضیحات خدمت |
| `duration_minutes` | `Integer` | Default: `30` — مدت هر نوبت به دقیقه |
| `capacity_per_slot` | `Integer` | Default: `1` — ظرفیت پذیرش همزمان در هر اسلات |
| `price` | `BigInteger` / `Integer` | Default: `0` — هزینه به تومان |
| `is_active` | `Boolean` | Default: `true` |
| `date_created` | `Timestamp` (System) | On Create |
| `date_updated` | `Timestamp` (System) | On Update |

### ل) کالکشن `booking_schedules` (ساعات کاری هفتگی — فاز ۴)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`, Required) |
| `service_id` | `M2O` (`UUID`) | Related Collection: `booking_services` (On Delete: `Cascade`, Required) |
| `weekday` | `Integer` | Required — روز هفته: `0`=شنبه تا `6`=جمعه |
| `start_time` | `String` | Required — ساعت شروع ۲۴ ساعته (مثلاً `09:00`) |
| `end_time` | `String` | Required — ساعت پایان ۲۴ ساعته (مثلاً `13:00`) |
| `blocked_dates` | `JSON` | Default: `[]` — تاریخ‌های تعطیل/مسدود (`1405/01/13` یا `2026-04-02`) |
| `is_active` | `Boolean` | Default: `true` |
| `date_created` | `Timestamp` (System) | On Create |
| `date_updated` | `Timestamp` (System) | On Update |

### م) کالکشن `appointments` (نوبت‌های رزروشده — فاز ۴)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`, Required) |
| `service_id` | `M2O` (`UUID`) | Related Collection: `booking_services` (On Delete: `Cascade`, Required) |
| `contact_id` | `M2O` (`bot_contacts.id`) | Related Collection: `bot_contacts` (On Delete: `Set Null`, Optional) |
| `bale_chat_id` | `String` | Required — شناسه چت مراجع در بله |
| `bale_user_name` | `String` | Optional — نام نمایشی مراجع |
| `customer_phone` | `String` | Optional — شماره موبایل مراجع |
| `appointment_at` | `Timestamp` | Required — زمان دقیق نوبت |
| `jalali_date` | `String` | Required — تاریخ و ساعت نمایشی شمسی |
| `status` | `String` | Default: `confirmed` (`pending` \| `confirmed` \| `cancelled`) |
| `reminder_sent` | `Boolean` | Default: `false` — فلگ ارسال یادآور ۲۴ ساعته |
| `note` | `Text` | Optional — یادداشت |
| `date_created` | `Timestamp` (System) | On Create |
| `date_updated` | `Timestamp` (System) | On Update |

### ن) کالکشن `broadcast_campaigns` (کمپین‌های ارسال گروهی — فاز ۴)
| نام فیلد (Key) | نوع (Type) | تنظیمات و توضیحات |
| :--- | :--- | :--- |
| `id` | `UUID` (Primary Key) | Auto-generated UUID |
| `bot_id` | `M2O` (`UUID`) | Related Collection: `bots` (On Delete: `Cascade`, Required) |
| `title` | `String` | Required — عنوان کمپین |
| `message_text` | `Text` | Required — متن پیام با پشتیبانی از `{{user.first_name}}` |
| `media_url` | `String` | Optional — لینک تصویر برای `sendPhoto` |
| `target_tags` | `JSON` | Default: `[]` — آرایه برچسب‌های CRM هدف |
| `status` | `String` | Default: `draft` (`draft` \| `queued` \| `sending` \| `completed` \| `failed`) |
| `total_count` | `Integer` | Default: `0` — تعداد کل مخاطبین هدف |
| `sent_count` | `Integer` | Default: `0` — تعداد پیام موفق |
| `failed_count` | `Integer` | Default: `0` — تعداد خطا یا بلاک‌شده |
| `scheduled_at` | `Timestamp` | Optional — زمان‌بندی ارسال آینده |
| `date_created` | `Timestamp` (System) | On Create |
| `date_updated` | `Timestamp` (System) | On Update |

---

## ۳. دسترسی‌های نقش `BotBuilderUser` (Permissions / Access Policies)

> **نکته مهم درباره نسخه‌های جدید دایرکتوس (Directus v11+):**
> در نسخه‌های جدید دایرکتوس، دسترسی‌ها در مسیر **Settings → Access Policies** (سیاست متصل به نقش `BotBuilderUser`) تنظیم می‌شوند؛ در نسخه‌های قدیمی‌تر این بخش در **Settings → Roles & Permissions → BotBuilderUser** قرار دارد.
> هنگام افزودن هر کالکشن جدید (به‌خصوص کالکشن‌های فاز ۴: `booking_services`، `booking_schedules`، `appointments` و `broadcast_campaigns`) مطمئن شوید:
> 1. هر ۴ کالکشن به **Policy متصل به نقش `BotBuilderUser`** اضافه شده باشند.
> 2. در بخش **Field Permissions** (یا هنگام انتخاب Custom Rule)، دسترسی به **همه فیلدها (All Fields / `*`)** مجاز باشد.
> 3. فیلد `bot_id` در همه کالکشن‌ها به صورت **Many-to-One (M2O)** به `bots` متصل باشد (نه String/UUID ساده) و نقش کاربر روی `bots` حداقل دسترسی `Read` به فیلدهای `id` و `user_created` را داشته باشد.

برای جداسازی داده‌های هر کاربر SaaS (Multi-Tenancy):

- **`bots`**:
  - `Create`: All
  - `Read` / `Update` / `Delete`: Custom Rule → `{ "user_created": { "_eq": "$CURRENT_USER" } }`
- **`bot_flows`**:
  - `Create`: All
  - `Read` / `Update` / `Delete`: Custom Rule → `{ "bot_id": { "user_created": { "_eq": "$CURRENT_USER" } } }`
- **`bot_contacts`**:
  - `Read` / `Update` / `Delete`: Custom Rule → `{ "bot_id": { "user_created": { "_eq": "$CURRENT_USER" } } }`
  - (درج/به‌روزرسانی خودکار هنگام پیام کاربر توسط سرور با `DIRECTUS_ADMIN_TOKEN` انجام می‌شود.)
- **`products`**, **`surveys`**, **`booking_services`**, **`booking_schedules`**, **`broadcast_campaigns`**:
  - `Create`: All
  - `Read` / `Update` / `Delete`: Custom Rule → `{ "bot_id": { "user_created": { "_eq": "$CURRENT_USER" } } }`
- **`bot_orders`**, **`appointments`**:
  - `Read` / `Update` / `Delete`: Custom Rule → `{ "bot_id": { "user_created": { "_eq": "$CURRENT_USER" } } }`
  - (ثبت رکورد جدید از پیام‌رسان بله توسط سرور با `DIRECTUS_ADMIN_TOKEN` انجام می‌شود.)
- **`survey_responses`**:
  - `Read` / `Delete`: Custom Rule → `{ "bot_id": { "user_created": { "_eq": "$CURRENT_USER" } } }`
  - (ثبت پاسخ جدید از پیام‌رسان بله توسط سرور با `DIRECTUS_ADMIN_TOKEN` انجام می‌شود.)
- **`bot_sessions`**, **`collected_form_data`**, **`webhook_logs`**:
  - `Read` (و در صورت نیاز `Delete`): Custom Rule → `{ "bot_id": { "user_created": { "_eq": "$CURRENT_USER" } } }`
  - (درج رکورد در این ۳ کالکشن توسط کارگر وب‌هوک سرور با استفاده از `DIRECTUS_ADMIN_TOKEN` انجام می‌شود.)
- **`directus_users`**:
  - `Read` / `Update`: Self (`{ "id": { "_eq": "$CURRENT_USER" } }`)
