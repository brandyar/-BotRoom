# راهنمای دیپلوی روی کولیفای (Coolify)

این پروژه دارای `Dockerfile` چندمرحله‌ای مبتنی بر **Node.js 22 Alpine** است و بدون نیاز به تنظیمات اضافه روی Coolify آماده اجراست.

---

## ۱. تنظیمات ساخت (Build Settings) در Coolify

1. مخزن Git پروژه را در Coolify اضافه کنید.
2. **Build Pack** را روی **`Dockerfile`** قرار دهید (به صورت خودکار فایل `Dockerfile` ریشه پروژه را شناسایی می‌کند).
3. در بخش **Network / Ports Exposes**:
   - پورت کانتینر را **`3000`** قرار دهید.
4. در بخش **Healthcheck** (اختیاری، در Dockerfile نیز تعریف شده است):
   - Path: `/api/health`
   - Port: `3000`

---

## ۲. متغیرهای محیطی (Environment Variables) در Coolify

در تب **Environment Variables** اپلیکیشن در Coolify متغیرهای زیر را ثبت کنید:

| نام متغیر | مقدار نمونه | توضیحات |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | حالت اجرایی تولید (الزامی) |
| `PORT` | `3000` | پورت پیش‌فرض سرور Express |
| `APP_URL` | `https://bot.yourdomain.com` | دامنه نهایی اپ روی Coolify (بدون `/` انتهایی) — برای ثبت وب‌هوک بله ضروری است |
| `BACKEND_URL` | `https://api.yourdomain.com` | آدرس سرور پایگاه داده و احراز هویت (بدون `/` انتهایی) |
| `BACKEND_ADMIN_TOKEN` | `...` | توکن استاتیک ادمین سرور |
| `BACKEND_DEFAULT_ROLE_ID` | `...` | شناسه UUID نقش پیش‌فرض کاربران |
| `REDIS_URL` | *(اختیاری — خالی بگذارید)* | در صورت خالی بودن از صف ناهمگام داخلی استفاده می‌شود |

---

## ۳. نکات مهم شبکه و وب‌هوک پیام‌رسان بله

- **گواهی SSL (HTTPS)**: پیام‌رسان بله برای `setWebhook` آدرس **HTTPS معتبر** نیاز دارد؛ در Coolify دامنه اصلی را با `https://` متصل کنید (Traefik به‌صورت خودکار SSL می‌سازد).
- **اگر سرویس بکند هم روی همین سرور Coolify است**:
  - می‌توانید `BACKEND_URL` را آدرس عمومی `https://...` بگذارید، یا در صورت قرار دادن هر دو سرویس در یک شبکه مشترک Coolify (`coolify` network)، از آدرس داخلی سرویس استفاده کنید.
- **بررسی سلامت پس از دیپلوی**:
  - مسیر `https://your-domain.com/api/health` باید خروجی JSON با `"ok": true` و `"backendConfigured": true` برگرداند.
