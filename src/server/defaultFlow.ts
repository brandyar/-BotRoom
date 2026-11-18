import type { FlowDefinition } from '../types/bot.ts';
import { autoLayoutFlow } from '../utils/flowValidator.ts';

const RAW_DEFAULT_FLOW: FlowDefinition = {
  startNodeId: 'node_start',
  fallbackText: 'متوجه پیام شما نشدم. لطفاً برای شروع مجدد عبارت /start را ارسال کنید یا از دکمه‌های زیر استفاده نمایید.',
  nodes: [
    {
      id: 'node_start',
      type: 'trigger',
      title: 'شروع گفتگو (/start)',
      triggerPattern: '/start',
      nextNodeId: 'node_welcome',
    },
    {
      id: 'node_welcome',
      type: 'message',
      title: 'پیام خوش‌آمدگویی و منو',
      messageText: 'سلام {{user.first_name}} عزیز!\nبه بازوی هوشمند پشتیبانی و ثبت سفارش خوش آمدید.\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:',
      inlineButtons: [
        { id: 'btn_order', text: 'ثبت درخواست مشاوره و سفارش', targetNodeId: 'node_ask_name' },
        { id: 'btn_hours', text: 'ساعات پاسخگویی و آدرس', targetNodeId: 'node_info' },
      ],
    },
    {
      id: 'node_info',
      type: 'message',
      title: 'اطلاعات تماس و ساعات کاری',
      messageText: 'پاسخگویی از شنبه تا چهارشنبه ساعت ۹ الی ۱۷ انجام می‌شود.\nبرای بازگشت به منوی اصلی /start را ارسال کنید.',
      inlineButtons: [
        { id: 'btn_back_start', text: 'شروع ثبت درخواست', targetNodeId: 'node_ask_name' },
      ],
    },
    {
      id: 'node_ask_name',
      type: 'question',
      title: 'دریافت نام و نام خانوادگی',
      messageText: 'لطفاً نام و نام خانوادگی خود را وارد کنید:',
      fieldKey: 'full_name',
      fieldLabel: 'نام و نام خانوادگی',
      inputType: 'text',
      validationErrorText: 'لطفاً نام معتبر (حداقل ۲ حرف) وارد کنید.',
      nextNodeId: 'node_ask_phone',
    },
    {
      id: 'node_ask_phone',
      type: 'question',
      title: 'دریافت شماره موبایل',
      messageText: 'سپاسگزارم {{form.full_name}}.\nلطفاً شماره موبایل خود را وارد کنید یا روی دکمه ارسال شماره کلیک نمایید:',
      fieldKey: 'phone',
      fieldLabel: 'شماره تماس',
      inputType: 'phone',
      requestContact: true,
      requestContactButtonText: 'ارسال شماره موبایل من',
      validationErrorText: 'فرمت شماره موبایل صحیح نیست. لطفاً شماره ۱۱ رقمی با شروع 09 وارد کنید.',
      nextNodeId: 'node_ask_topic',
    },
    {
      id: 'node_ask_topic',
      type: 'question',
      title: 'انتخاب موضوع درخواست',
      messageText: 'موضوع درخواست خود را انتخاب یا تایپ کنید:',
      fieldKey: 'topic',
      fieldLabel: 'موضوع درخواست',
      inputType: 'choice',
      inlineButtons: [
        { id: 'topic_sales', text: 'خرید و استعلام قیمت', targetNodeId: 'node_tag_lead' },
        { id: 'topic_support', text: 'پشتیبانی فنی', targetNodeId: 'node_tag_lead' },
      ],
      nextNodeId: 'node_tag_lead',
    },
    {
      id: 'node_tag_lead',
      type: 'tag_contact',
      title: 'برچسب‌گذاری مشتری در CRM',
      tagConfig: {
        action: 'add',
        tags: ['سرنخ جدید', 'ثبت فرم'],
      },
      nextNodeId: 'node_update_crm',
    },
    {
      id: 'node_update_crm',
      type: 'update_contact',
      title: 'به‌روزرسانی پروفایل مشتری',
      contactFieldMappings: [
        { sessionKey: 'full_name', targetField: 'first_name' },
        { sessionKey: 'phone', targetField: 'phone' },
        { sessionKey: 'topic', targetField: 'custom', customKey: 'last_topic' },
      ],
      nextNodeId: 'node_save',
    },
    {
      id: 'node_save',
      type: 'save_form',
      title: 'ثبت نهایی در دایرکتوس',
      formTitle: 'فرم درخواست مشاوره',
      messageText: 'درخواست شما با موفقیت ثبت شد!\nنام: {{form.full_name}}\nتماس: {{form.phone}}\nموضوع: {{form.topic}}\nهمکاران ما به‌زودی با شما تماس می‌گیرند.',
    },
  ],
};

export const DEFAULT_PERSIAN_FLOW: FlowDefinition = autoLayoutFlow(RAW_DEFAULT_FLOW);
