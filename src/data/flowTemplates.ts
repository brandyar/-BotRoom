import type { FlowDefinition } from '../types/bot.ts';
import { autoLayoutFlow } from '../utils/flowValidator.ts';

export interface FlowTemplateItem {
  id: string;
  title: string;
  category: string;
  description: string;
  highlights: string[];
  flow: FlowDefinition;
}

const RAW_TEMPLATES: FlowTemplateItem[] = [
  {
    id: 'catalog_shop',
    title: 'کاتالوگ محصولات و سبد خرید بله',
    category: 'فروشگاه',
    description:
      'مرورگر تعاملی محصولات با ورق‌زدن عکس بدون شلوغ شدن چت، فیلتر دسته‌بندی، سبد خرید و ثبت سفارش در bot_orders.',
    highlights: ['ورق‌زدن کاتالوگ درون‌بله', 'سبد خرید و تغییر تعداد', 'ثبت خودکار سفارش'],
    flow: {
      startNodeId: 'cat_start',
      fallbackText: 'برای مشاهده کاتالوگ محصولات دستور /start را ارسال کنید.',
      nodes: [
        {
          id: 'cat_start',
          type: 'trigger',
          title: 'شروع فروشگاه (/start)',
          triggerPattern: '/start, کاتالوگ, محصولات',
          nextNodeId: 'cat_welcome',
        },
        {
          id: 'cat_welcome',
          type: 'message',
          title: 'خوش‌آمدگویی فروشگاه',
          messageText:
            'سلام {{user.first_name}} عزیز!\nبه فروشگاه آنلاین ما در پیام‌رسان بله خوش آمدید. برای مشاهده محصولات و افزودن به سبد خرید دکمه زیر را لمس کنید:',
          inlineButtons: [
            { id: 'cat_open_btn', text: '🛍 مشاهده کاتالوگ محصولات', targetNodeId: 'cat_browser' },
          ],
        },
        {
          id: 'cat_browser',
          type: 'catalog_browser',
          title: 'مرورگر کاتالوگ و سبد خرید',
          catalogConfig: {
            categoryFilter: 'all',
            allowCart: true,
            emptyText: 'در حال حاضر محصول فعالی ثبت نشده است. از بخش «کاتالوگ و سفارش‌ها» محصول اضافه کنید.',
            checkoutConfirmText: '✅ سفارش شما با موفقیت ثبت شد! برای هماهنگی ارسال شماره تماس خود را ثبت کنید:',
          },
          nextNodeId: 'cat_ask_phone',
        },
        {
          id: 'cat_ask_phone',
          type: 'question',
          title: 'دریافت شماره تماس سفارش',
          messageText: 'لطفاً شماره موبایل خود را جهت هماهنگی ارسال سفارش تایید کنید:',
          fieldKey: 'phone',
          fieldLabel: 'شماره تماس',
          inputType: 'phone',
          requestContact: true,
          requestContactButtonText: 'ارسال شماره موبایل من',
          validationErrorText: 'شماره موبایل معتبر ایران وارد کنید.',
          nextNodeId: 'cat_tag_buyer',
        },
        {
          id: 'cat_tag_buyer',
          type: 'tag_contact',
          title: 'برچسب خریدار کاتالوگ',
          tagConfig: {
            action: 'add',
            tags: ['خریدار کاتالوگ'],
          },
          nextNodeId: 'cat_thanks',
        },
        {
          id: 'cat_thanks',
          type: 'message',
          title: 'تایید نهایی ارسال',
          messageText:
            'سپاسگزاریم {{user.first_name}}!\nسفارش شماره {{form.order_id}} با مبلغ {{form.order_total}} تومان برای شما ثبت و شماره {{form.phone}} جهت هماهنگی پیک ذخیره شد.',
        },
      ],
    },
  },
  {
    id: 'store_order',
    title: 'فروشگاه و ثبت سفارش محصول',
    category: 'فروشگاه',
    description:
      'معرفی محصولات پرطرفدار، بررسی تگ مشتری VIP برای تخفیف اختصاصی، دریافت شماره تماس تاییدشده و ثبت سفارش.',
    highlights: ['بررسی تگ VIP', 'درخواست شماره تماس بله', 'ثبت فرم و پروفایل CRM'],
    flow: {
      startNodeId: 'store_start',
      fallbackText: 'برای مشاهده منوی فروشگاه و ثبت سفارش عبارت /start را ارسال کنید.',
      nodes: [
        {
          id: 'store_start',
          type: 'trigger',
          title: 'شروع فروشگاه (/start)',
          triggerPattern: '/start, خرید, سفارش',
          nextNodeId: 'store_vip_check',
        },
        {
          id: 'store_vip_check',
          type: 'condition',
          title: 'تشخیص مشتری VIP در CRM',
          condition: {
            sourceKey: 'contact.tags',
            operator: 'contains',
            value: 'VIP',
            trueNodeId: 'store_vip_welcome',
            falseNodeId: 'store_welcome',
          },
        },
        {
          id: 'store_vip_welcome',
          type: 'message',
          title: 'خوش‌آمدگویی ویژه VIP',
          messageText:
            'سلام {{user.first_name}} عزیز!\nبه عنوان مشتری VIP، روی تمام سفارش‌های امروز ۱۰٪ تخفیف ویژه دارید.\nکدام محصول را انتخاب می‌کنید؟',
          inlineButtons: [
            { id: 'v_p1', text: 'پکیج حرفه‌ای کسب‌وکار', targetNodeId: 'store_ask_name' },
            { id: 'v_p2', text: 'اشتراک سالانه پشتیبانی', targetNodeId: 'store_ask_name' },
          ],
        },
        {
          id: 'store_welcome',
          type: 'message',
          title: 'منوی اصلی فروشگاه',
          messageText:
            'سلام {{user.first_name}}! به فروشگاه ما خوش آمدید.\nلطفاً محصول یا خدمت مورد نظر خود را انتخاب کنید:',
          inlineButtons: [
            { id: 's_p1', text: 'پکیج حرفه‌ای کسب‌وکار', targetNodeId: 'store_ask_name' },
            { id: 's_p2', text: 'اشتراک سالانه پشتیبانی', targetNodeId: 'store_ask_name' },
            { id: 's_info', text: 'شرایط ارسال و گارانتی', targetNodeId: 'store_shipping_info' },
          ],
        },
        {
          id: 'store_shipping_info',
          type: 'message',
          title: 'شرایط ارسال و گارانتی',
          messageText:
            'ارسال در تهران زیر ۲۴ ساعت و به سراسر کشور ظرف ۴۸ ساعت انجام می‌شود. تمامی محصولات دارای ۷ روز ضمانت بازگشت هستند.',
          inlineButtons: [
            { id: 's_go_order', text: 'ثبت سفارش فوری', targetNodeId: 'store_ask_name' },
          ],
        },
        {
          id: 'store_ask_name',
          type: 'question',
          title: 'نام گیرنده سفارش',
          messageText: 'لطفاً نام و نام خانوادگی تحویل‌گیرنده را وارد کنید:',
          fieldKey: 'customer_name',
          fieldLabel: 'نام خریدار',
          inputType: 'text',
          validationErrorText: 'لطفاً نام کامل را وارد کنید.',
          nextNodeId: 'store_ask_phone',
        },
        {
          id: 'store_ask_phone',
          type: 'question',
          title: 'دریافت شماره موبایل تاییدشده',
          messageText:
            'سپاسگزارم {{form.customer_name}}.\nلطفاً شماره موبایل خود را با دکمه زیر ارسال کنید تا پیامک پیگیری برای شما ارسال شود:',
          fieldKey: 'phone',
          fieldLabel: 'شماره تماس',
          inputType: 'phone',
          requestContact: true,
          requestContactButtonText: 'ارسال شماره موبایل من',
          validationErrorText: 'شماره موبایل معتبر ایران (با شروع 09) وارد کنید.',
          nextNodeId: 'store_ask_address',
        },
        {
          id: 'store_ask_address',
          type: 'question',
          title: 'دریافت آدرس ارسال',
          messageText: 'لطفاً شهر و آدرس دقیق ارسال سفارش را بنویسید:',
          fieldKey: 'address',
          fieldLabel: 'آدرس',
          inputType: 'text',
          validationErrorText: 'آدرس نمی‌تواند خالی باشد.',
          nextNodeId: 'store_tag_buyer',
        },
        {
          id: 'store_tag_buyer',
          type: 'tag_contact',
          title: 'برچسب‌گذاری خریدار',
          tagConfig: {
            action: 'add',
            tags: ['متقاضی خرید', 'ثبت سفارش'],
          },
          nextNodeId: 'store_update_crm',
        },
        {
          id: 'store_update_crm',
          type: 'update_contact',
          title: 'بروزرسانی پروفایل CRM',
          contactFieldMappings: [
            { sessionKey: 'customer_name', targetField: 'first_name' },
            { sessionKey: 'phone', targetField: 'phone' },
            { sessionKey: 'address', targetField: 'custom', customKey: 'shipping_address' },
          ],
          nextNodeId: 'store_save',
        },
        {
          id: 'store_save',
          type: 'save_form',
          title: 'ثبت نهایی سفارش',
          formTitle: 'سفارش جدید فروشگاه',
          messageText:
            'سفارش شما با موفقیت ثبت شد!\nنام: {{form.customer_name}}\nموبایل: {{form.phone}}\nآدرس: {{form.address}}\nکارشناسان فروش جهت هماهنگی پرداخت و ارسال با شما تماس می‌گیرند.',
        },
      ],
    },
  },
  {
    id: 'clinic_booking',
    title: 'کلینیک و رزرو نوبت شمسی',
    category: 'نوبت‌دهی',
    description:
      'نمایش خودکار خدمات کلینیک و ساعت‌های آزاد به تاریخ شمسی، جلوگیری از رزرو همزمان، ذخیره در CRM و ارسال یادآور ۲۴ ساعته.',
    highlights: ['تقویم نوبت‌دهی شمسی', 'کنترل ظرفیت اسلات', 'ذخیره خودکار در CRM'],
    flow: {
      startNodeId: 'clinic_start',
      fallbackText: 'برای رزرو نوبت کلینیک دستور /start را ارسال کنید.',
      nodes: [
        {
          id: 'clinic_start',
          type: 'trigger',
          title: 'شروع نوبت‌دهی (/start)',
          triggerPattern: '/start, نوبت, رزرو',
          nextNodeId: 'clinic_booking',
        },
        {
          id: 'clinic_booking',
          type: 'booking_node',
          title: 'انتخاب خدمت و نوبت شمسی',
          bookingConfig: {
            daysAhead: 7,
            defaultStatus: 'confirmed',
            introText:
              'سلام {{user.first_name}} عزیز!\nبه سامانه نوبت‌دهی آنلاین کلینیک خوش آمدید. لطفاً خدمت مورد نظر را انتخاب کنید:',
            confirmText: '✅ نوبت شما با موفقیت در سیستم ثبت شد!',
            emptySlotsText:
              'در ۷ روز آینده زمان آزادی برای این خدمت یافت نشد. لطفاً زمان دیگری تلاش کنید.',
          },
          nextNodeId: 'clinic_phone',
        },
        {
          id: 'clinic_phone',
          type: 'question',
          title: 'شماره تماس هماهنگی',
          messageText:
            'نوبت «{{form.appointment_service}}» برای «{{form.appointment_date}}» ثبت شد.\nجهت ارسال پیام یادآوری، شماره موبایل خود را ارسال کنید:',
          fieldKey: 'phone',
          fieldLabel: 'شماره تماس',
          inputType: 'phone',
          requestContact: true,
          requestContactButtonText: 'ارسال شماره موبایل من',
          validationErrorText: 'شماره موبایل معتبر وارد کنید.',
          nextNodeId: 'clinic_tag',
        },
        {
          id: 'clinic_tag',
          type: 'tag_contact',
          title: 'برچسب‌گذاری نوبت در CRM',
          tagConfig: {
            action: 'add',
            tags: ['نوبت رزروشده'],
          },
          nextNodeId: 'clinic_update',
        },
        {
          id: 'clinic_update',
          type: 'update_contact',
          title: 'ذخیره جزئیات نوبت در CRM',
          contactFieldMappings: [
            { sessionKey: 'phone', targetField: 'phone' },
            { sessionKey: 'appointment_service', targetField: 'custom', customKey: 'booked_service' },
            { sessionKey: 'appointment_date', targetField: 'custom', customKey: 'booked_date' },
          ],
          nextNodeId: 'clinic_delay_followup',
        },
        {
          id: 'clinic_delay_followup',
          type: 'delay',
          title: 'پیام تایید نهایی پذیرش',
          delayConfig: {
            delaySeconds: 15,
            followUpText:
              'یادآوری پذیرش: نوبت {{form.appointment_service}} شما برای {{form.appointment_date}} قطعی است. ۲۴ ساعت پیش از نوبت مجدداً یادآوری ارسال خواهد شد.',
            cancelIfReplied: false,
          },
        },
      ],
    },
  },
  {
    id: 'support_vip',
    title: 'پشتیبانی فنی و ارجاع هوشمند',
    category: 'پشتیبانی',
    description:
      'تفکیک خودکار مشتریان VIP از کاربران عادی بر اساس برچسب‌های CRM و ثبت تیکت پشتیبانی با اولویت‌بندی.',
    highlights: ['انشعاب بر اساس تگ CRM', 'دریافت شرح خطا', 'ثبت تیکت پشتیبانی'],
    flow: {
      startNodeId: 'sup_start',
      fallbackText: 'برای ارتباط با واحد پشتیبانی عبارت /start را ارسال کنید.',
      nodes: [
        {
          id: 'sup_start',
          type: 'trigger',
          title: 'شروع پشتیبانی (/start)',
          triggerPattern: '/start, پشتیبانی, تیکت',
          nextNodeId: 'sup_vip_branch',
        },
        {
          id: 'sup_vip_branch',
          type: 'condition',
          title: 'بررسی سطح پشتیبانی مشتری',
          condition: {
            sourceKey: 'contact.tags',
            operator: 'contains',
            value: 'VIP',
            trueNodeId: 'sup_vip_msg',
            falseNodeId: 'sup_std_msg',
          },
        },
        {
          id: 'sup_vip_msg',
          type: 'message',
          title: 'مسیر پاسخگویی فوری VIP',
          messageText:
            'سلام {{user.first_name}} عزیز!\nحساب شما دارای پشتیبانی اولویت‌دار VIP است. شرح مشکل خود را بنویسید تا مستقیماً به کارشناس ارشد ارجاع شود.',
          nextNodeId: 'sup_ask_issue',
        },
        {
          id: 'sup_std_msg',
          type: 'message',
          title: 'شروع ثبت تیکت پشتیبانی',
          messageText:
            'سلام {{user.first_name}}!\nبرای ثبت تیکت پشتیبانی، لطفاً شرح مشکل یا سوال خود را ارسال کنید.',
          nextNodeId: 'sup_ask_issue',
        },
        {
          id: 'sup_ask_issue',
          type: 'question',
          title: 'دریافت شرح مشکل',
          messageText: 'لطفاً جزئیات مشکل یا پیام خود را در یک پیام بنویسید:',
          fieldKey: 'issue_description',
          fieldLabel: 'شرح تیکت',
          inputType: 'text',
          validationErrorText: 'لطفاً شرح مشکل را وارد کنید.',
          nextNodeId: 'sup_ask_phone',
        },
        {
          id: 'sup_ask_phone',
          type: 'question',
          title: 'شماره تماس پاسخگویی',
          messageText: 'در صورت نیاز به تماس تلفنی، شماره موبایل خود را ارسال کنید:',
          fieldKey: 'phone',
          fieldLabel: 'موبایل',
          inputType: 'phone',
          requestContact: true,
          requestContactButtonText: 'ارسال شماره موبایل',
          validationErrorText: 'فرمت شماره موبایل صحیح نیست.',
          nextNodeId: 'sup_tag_ticket',
        },
        {
          id: 'sup_tag_ticket',
          type: 'tag_contact',
          title: 'افزودن برچسب تیکت باز',
          tagConfig: {
            action: 'add',
            tags: ['تیکت باز'],
          },
          nextNodeId: 'sup_save',
        },
        {
          id: 'sup_save',
          type: 'save_form',
          title: 'ثبت نهایی تیکت',
          formTitle: 'تیکت پشتیبانی فنی',
          messageText:
            'تیکت شما ثبت شد.\nخلاصه: {{form.issue_description}}\nتیم فنی در کوتاه‌ترین زمان به شما پاسخ می‌دهد.',
        },
      ],
    },
  },
  {
    id: 'csat_survey',
    title: 'نظرسنجی رضایت مشتری (CSAT)',
    category: 'نظرسنجی',
    description:
      'سنجش رضایت امتیازی ۱ تا ۵ ستاره با ذخیره خودکار در آمار نظرسنجی و انشعاب خودکار امتیازهای پایین به مسیر پیگیری مدیر.',
    highlights: ['امتیازدهی ۱ تا ۵ ستاره', 'شاخه خودکار امتیاز پایین', 'برچسب‌گذاری CRM'],
    flow: {
      startNodeId: 'csat_start',
      fallbackText: 'برای شرکت در نظرسنجی عبارت /start را ارسال کنید.',
      nodes: [
        {
          id: 'csat_start',
          type: 'trigger',
          title: 'شروع نظرسنجی (/start)',
          triggerPattern: '/start, نظرسنجی',
          nextNodeId: 'csat_survey_node',
        },
        {
          id: 'csat_survey_node',
          type: 'survey_node',
          title: 'نظرسنجی امتیازی ۱ تا ۵',
          surveyConfig: {
            surveyType: 'rating',
            questionText:
              'سلام {{user.first_name}} عزیز!\nچقدر از کیفیت خدمات و پاسخگویی ما رضایت داشتید؟',
            lowScoreThreshold: 3,
            lowScoreNodeId: 'csat_tag_low',
            thankYouText: 'سپاسگزاریم! نظر شما ثبت شد.',
          },
          nextNodeId: 'csat_tag_high',
        },
        {
          id: 'csat_tag_low',
          type: 'tag_contact',
          title: 'برچسب نیازمند پیگیری',
          tagConfig: {
            action: 'add',
            tags: ['نیازمند پیگیری', 'ناراضی'],
          },
          nextNodeId: 'csat_low_feedback',
        },
        {
          id: 'csat_low_feedback',
          type: 'question',
          title: 'دریافت علت نارضایتی',
          messageText:
            'از اینکه تجربه ایده‌آلی نداشتید عذرخواهی می‌کنیم. لطفاً بنویسید چه بخشی را می‌توانیم بهتر کنیم تا مدیر پشتیبانی پیگیری کند:',
          fieldKey: 'improvement_note',
          fieldLabel: 'پیشنهاد بهبود',
          inputType: 'text',
          validationErrorText: 'لطفاً نظر خود را بنویسید.',
          nextNodeId: 'csat_save',
        },
        {
          id: 'csat_tag_high',
          type: 'tag_contact',
          title: 'برچسب مشتری راضی',
          tagConfig: {
            action: 'add',
            tags: ['مشتری راضی'],
          },
          nextNodeId: 'csat_high_thanks',
        },
        {
          id: 'csat_high_thanks',
          type: 'message',
          title: 'تشکر از امتیاز عالی',
          messageText:
            'بسیار خرسندیم {{user.first_name}} عزیز! امتیاز {{form.survey_score}} از ۵ شما ثبت شد و باعث دلگرمی تیم ماست.',
        },
        {
          id: 'csat_save',
          type: 'save_form',
          title: 'ثبت گزارش پیگیری',
          formTitle: 'گزارش پیگیری نظرسنجی',
          messageText:
            'بازخورد شما (امتیاز {{form.survey_score}} از ۵) با موفقیت ثبت شد و به مدیر پشتیبانی ارجاع گردید.',
        },
      ],
    },
  },
];

export const FLOW_TEMPLATES: FlowTemplateItem[] = RAW_TEMPLATES.map((tpl) => ({
  ...tpl,
  flow: autoLayoutFlow(tpl.flow),
}));
