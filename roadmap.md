# نقشه راه توسعه پلتفرم بله‌ساز (Roadmap)

این سند نقشه راه فازبه‌فاز برای توسعه کامل قابلیت‌های تجاری، CRM و اتوماسیون بازوی پیام‌رسان بله روی بکند **Directus** و سرور **Express** است.

---

## فاز ۰: هسته اولیه MVP (تکمیل‌شده)

- [x] احراز هویت و چندمستاجری با Directus JWT (`/auth/login`, `/auth/register`, `/users/me`)
- [x] مدیریت بازوها، اعتبارسنجی توکن (`getMe`) و ثبت/حذف وب‌هوک بله (`setWebhook`)
- [x] صف ناهمگام وب‌هوک (`POST /api/webhooks/bale/:secret`) با پردازش پس‌زمینه بدون تایم‌اوت
- [x] موتور اجرای جریان فارسی (`trigger`, `message`, `question`, `condition`, `save_form`) + شبیه‌ساز زنده
- [x] نمایش داده‌های فرم‌های ثبت‌شده با خروجی اکسل فارسی (`CSV + UTF-8 BOM`) و گزارش وب‌هوک‌ها
- [x] آماده‌سازی کامل برای دیپلوی روی Coolify (`Dockerfile`, `.dockerignore`, `COOLIFY_DEPLOY.md`)

---

## فاز ۱: هسته مدیریت مشتریان (CRM) و جمع‌آوری اطلاعات پیشرفته (تکمیل‌شده)

**هدف:** تبدیل کاربران گذرای ربات به مخاطبین ساختاریافته با برچسب، شماره تماس تاییدشده و تاریخچه تعامل.

### ۱.۱. کالکشن جدید در Directus
- **`bot_contacts`**
  - `id` (`UUID`, Primary Key)
  - `bot_id` (`M2O → bots`, On Delete: `Cascade`, Required)
  - `bale_user_id` (`String`, Required)
  - `bale_chat_id` (`String`, Required)
  - `first_name` (`String`), `last_name` (`String`), `bale_username` (`String`)
  - `phone` (`String`)
  - `tags` (`JSON` — آرایه برچسب‌ها مثلاً `["VIP", "مشتری"]`)
  - `custom_fields` (`JSON` — فیلدهای تکمیلی جمع‌آوری‌شده از فرم‌ها)
  - `is_blocked` (`Boolean`, Default: `false`)
  - `last_interaction_at` (`Timestamp`)
  - `date_created`, `date_updated`

### ۱.۲. توسعه موتور جریان و Bale API
- [x] Upsert خودکار پروفایل مخاطب در `bot_contacts` هنگام شروع گفتگو (`/start`) یا تکمیل فرم
- [x] پشتیبانی از دکمه دریافت شماره موبایل تاییدشده بله (`ReplyKeyboardMarkup` با `request_contact: true`)
- [x] افزودن گره اکشن **`tag_contact`** (افزودن/حذف برچسب روی مشتری در میانه جریان)
- [x] افزودن گره اکشن **`update_contact`** (ذخیره خودکار فیلدهای فرم در پروفایل مشتری)

### ۱.۳. رابط کاربری (داشبورد RTL)
- [x] صفحه «مشتریان و مخاطبین» با جستجو، فیلتر برچسب، مشاهده پروفایل و تاریخچه فرم‌ها
- [x] ویرایش دستی برچسب‌ها و خروجی اکسل مخاطبین

---

## فاز ۲: ارتقای حرفه‌ای طراح جریان گفتگو (Visual Flow Studio) (تکمیل‌شده)

**هدف:** تبدیل ادیتور فعلی به یک بوم گراف بصری (Node-Edge Canvas) استاندارد همراه با قالب‌های آماده.

### ۲.۱. بوم بصری تعاملی
- [x] پیاده‌سازی بوم گراف تعاملی (پشتیبانی از Drag & Drop، Zoom/Pan و MiniMap در جهت RTL)
- [x] نمایش اتصالات خطی و انشعابی (Edges) بین دکمه‌های شیشه‌ای، شرط‌ها و گره‌های مقصد
- [x] اعتبارسنجی گراف پیش از انتشار (تشخیص گره‌های رهاشده یا لینک‌های شکسته)

### ۲.۲. قالب‌های آماده و قابلیت‌های پیشرفته
- [x] افزودن گالری قالب‌های آماده (فروشگاهی، کلینیک و نوبت‌دهی، پشتیبانی و نظرسنجی)
- [x] شرط‌گذاری پیشرفته روی تگ‌ها و فیلدهای CRM مشتری (مثلاً مسیر ویژه مشتریان VIP)
- [x] گره «تاخیر / پیام پیگیری» و نسخه‌بندی جریان‌ها در `bot_flows`

---

## فاز ۳: کاتالوگ محصولات و خدمات + ماژول نظرسنجی (تکمیل‌شده)

**هدف:** امکان معرفی محصولات، ثبت سفارش داخل بله و سنجش رضایت مشتریان.

### ۳.۱. کالکشن‌های جدید در Directus
- **`products`**
  - `id` (`UUID`), `bot_id` (`M2O → bots`)
  - `title` (`String`), `description` (`Text`), `category` (`String`)
  - `price` (`Integer` / `BigInteger`), `stock` (`Integer`)
  - `image_url` (`String` یا فایل Directus), `is_active` (`Boolean`)
- **`bot_orders`**
  - `id` (`UUID`), `bot_id` (`M2O → bots`), `contact_id` (`M2O → bot_contacts`)
  - `bale_chat_id` (`String`), `bale_user_name` (`String`)
  - `items` (`JSON`), `total_amount` (`BigInteger`), `status` (`pending | confirmed | cancelled`), `note` (`Text`)
- **`surveys`** و **`survey_responses`**
  - `surveys`: `id`, `bot_id`, `title`, `type` (`rating | multi_choice`), `questions_json` (`JSON`), `allow_multiple` (`Boolean`)
  - `survey_responses`: `id`, `survey_id`, `bot_id`, `contact_id`, `bale_chat_id`, `bale_user_name`, `answers_json` (`JSON`), `score` (`Integer`)

### ۳.۲. توسعه موتور بله و داشبورد
- [x] پشتیبانی از متدهای `sendPhoto` و `editMessageCaption` / `editMessageText` / `editMessageReplyMarkup` برای ورق زدن کاتالوگ بدون شلوغ شدن چت
- [x] گره **`catalog_browser`** (نمایش دسته‌بندی‌ها، صفحه‌بندی قبلی/بعدی، سبد خرید موقت و ثبت در `bot_orders`)
- [x] گره **`survey_node`** (نظرسنجی امتیازی `۱ تا ۵` با شاخه‌بندی روی امتیاز پایین، و نظرسنجی چندسوالی)
- [x] داشبورد مدیریت محصولات، وضعیت سفارش‌ها و نمودار آماری نتایج نظرسنجی

---

## فاز ۴: رزرو و نوبت‌دهی شمسی + ارسال پیام گروهی (Broadcast) (تکمیل‌شده)

**هدف:** اتوماسیون زمان‌بندی نوبت‌ها با یادآور خودکار و اجرای کمپین‌های پیام‌رسانی انبوه ایمن.

### ۴.۱. کالکشن‌های جدید در Directus
- **`booking_services`**
  - `id`, `bot_id`, `title`, `description`, `duration_minutes` (`Integer`), `capacity_per_slot` (`Integer`), `price`, `is_active`
- **`booking_schedules`**
  - `id`, `bot_id`, `service_id`, `weekday` (`0-6`), `start_time`, `end_time`, `blocked_dates` (`JSON`), `is_active`
- **`appointments`**
  - `id`, `bot_id`, `service_id`, `contact_id`, `bale_chat_id`, `bale_user_name`, `customer_phone`, `appointment_at` (`Timestamp`), `jalali_date` (`String`), `status` (`pending | confirmed | cancelled`), `reminder_sent` (`Boolean`), `note`
- **`broadcast_campaigns`**
  - `id`, `bot_id`, `title`, `message_text`, `media_url`, `target_tags` (`JSON`), `status` (`draft | queued | sending | completed | failed`), `total_count`, `sent_count`, `failed_count`, `scheduled_at`

### ۴.۲. توسعه موتور نوبت‌دهی و صف ارسال گروهی
- [x] محاسبه پویا اسلات‌های آزاد به تاریخ شمسی و نمایش به‌صورت دکمه شیشه‌ای (`booking_node`)
- [x] کنترل همزمانی (Atomic lock) برای جلوگیری از رزرو همزمان یک ساعت توسط دو کاربر
- [x] زمان‌بند (Scheduler) بررسی نوبت‌های نزدیک و ارسال یادآور ۲۴ ساعته + دکمه تایید/لغو در بله (`appt:ok:<id>` / `appt:no:<id>`)
- [x] کارگر ارسال گروهی با **Rate Limiter** (کنترل نرخ ارسال ~۱۶ پیام در ثانیه) و بروزرسانی خودکار `is_blocked = true` برای کاربرانی که ربات را مسدود کرده‌اند
- [x] رابط کاربری تقویم نوبت‌ها، ساعات کاری هفتگی و پنل ساخت و گزارش‌گیری کمپین‌های ارسال گروهی

---

## وضعیت فعلی
- **فاز تکمیل‌شده:** **فاز ۴ (رزرو و نوبت‌دهی شمسی + ارسال پیام گروهی)** — تمامی ۴ فاز نقشه راه تکمیل شدند.
