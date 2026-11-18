import type { AppointmentRecord, BroadcastCampaignRecord } from '../types/bot.ts';
import { dispatchBaleOutgoingPayload, sendBaleMessage } from './baleApi.ts';
import {
  getBotAsAdmin,
  getCampaignAsAdmin,
  getBackendConfig,
  listBookingServicesAsAdmin,
  listBotContactsAsAdmin,
  listDueReminderAppointmentsAsAdmin,
  listDueScheduledCampaignsAsAdmin,
  markContactBlockedAsAdmin,
  updateAppointmentAsAdmin,
  updateCampaignAsAdmin,
} from './backend.ts';

const activeCampaignIds = new Set<string>();
let reminderSweepRunning = false;
let schedulerStarted = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function interpolateBroadcastText(
  template: string,
  contact: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
  }
): string {
  return template
    .replaceAll('{{user.first_name}}', contact.first_name || 'کاربر گرامی')
    .replaceAll('{{user.last_name}}', contact.last_name || '')
    .replaceAll('{{user.phone}}', contact.phone || '');
}

function isBaleBlockedError(errorCode?: number, description?: string): boolean {
  if (errorCode === 403) return true;
  if (!description) return false;
  return /blocked|deactivated|chat not found|bot was blocked|forbidden/i.test(description);
}

/**
 * Finds appointments in the next 24h where reminder_sent == false and sends a Bale reminder with Confirm / Cancel buttons.
 */
export async function runAppointmentReminderSweep(botId?: string): Promise<{
  checked: number;
  sent: number;
  failed: number;
}> {
  const cfg = getBackendConfig();
  if (!cfg.isConfigured || !cfg.hasAdminToken) {
    return { checked: 0, sent: 0, failed: 0 };
  }
  if (reminderSweepRunning) {
    return { checked: 0, sent: 0, failed: 0 };
  }

  reminderSweepRunning = true;
  let checked = 0;
  let sent = 0;
  let failed = 0;

  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const due = await listDueReminderAppointmentsAsAdmin(
      now.toISOString(),
      in24h.toISOString(),
      botId
    );
    checked = due.length;

    const botCache = new Map<string, Awaited<ReturnType<typeof getBotAsAdmin>>>();
    const serviceTitleCache = new Map<string, string>();

    for (const appt of due) {
      try {
        let bot = botCache.get(appt.bot_id);
        if (bot === undefined) {
          bot = await getBotAsAdmin(appt.bot_id);
          botCache.set(appt.bot_id, bot);
        }
        if (!bot || !bot.is_active || !bot.bot_token) {
          failed += 1;
          continue;
        }

        let serviceTitle = serviceTitleCache.get(appt.service_id);
        if (!serviceTitle) {
          const services = await listBookingServicesAsAdmin(appt.bot_id).catch(() => []);
          for (const s of services) {
            serviceTitleCache.set(s.id, s.title);
          }
          serviceTitle = serviceTitleCache.get(appt.service_id) || 'نوبت رزروشده';
        }

        const msgText = [
          `⏰ یادآور نوبت شما`,
          ``,
          `خدمت: ${serviceTitle}`,
          `زمان: ${appt.jalali_date}`,
          ``,
          `لطفاً حضور خود را تایید یا در صورت نیاز لغو کنید:`,
        ].join('\n');

        const res = await sendBaleMessage(bot.bot_token, {
          chat_id: appt.bale_chat_id,
          text: msgText,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ تایید حضور', callback_data: `appt:ok:${appt.id}` },
                { text: '❌ لغو نوبت', callback_data: `appt:no:${appt.id}` },
              ],
            ],
          },
        });

        if (res.ok) {
          await updateAppointmentAsAdmin(appt.id, { reminder_sent: true });
          sent += 1;
        } else {
          failed += 1;
        }

        // Gentle pacing (20 msgs/sec ceiling)
        await sleep(55);
      } catch (err) {
        console.error('Failed sending appointment reminder:', appt.id, err);
        failed += 1;
      }
    }
  } finally {
    reminderSweepRunning = false;
  }

  return { checked, sent, failed };
}

/**
 * Executes a broadcast campaign in the background with a 16-17 msg/s rate limiter and 403 auto-block handling.
 */
export async function executeBroadcastCampaign(
  campaignId: string
): Promise<BroadcastCampaignRecord | null> {
  if (activeCampaignIds.has(campaignId)) {
    return getCampaignAsAdmin(campaignId);
  }

  activeCampaignIds.add(campaignId);

  try {
    const campaign = await getCampaignAsAdmin(campaignId);
    if (!campaign) return null;

    const bot = await getBotAsAdmin(campaign.bot_id);
    if (!bot || !bot.bot_token) {
      return await updateCampaignAsAdmin(campaignId, { status: 'failed' });
    }

    const allContacts = await listBotContactsAsAdmin(campaign.bot_id);
    const targetTags = (campaign.target_tags || []).map((t) => t.trim()).filter(Boolean);

    const targets = allContacts.filter((c) => {
      if (c.is_blocked) return false;
      if (!c.bale_chat_id) return false;
      if (targetTags.length === 0) return true;
      return targetTags.some((tag) => c.tags.includes(tag));
    });

    await updateCampaignAsAdmin(campaignId, {
      status: 'sending',
      total_count: targets.length,
      sent_count: 0,
      failed_count: 0,
    });

    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < targets.length; i += 1) {
      const contact = targets[i];
      const text = interpolateBroadcastText(campaign.message_text, contact);

      const res = await dispatchBaleOutgoingPayload(bot.bot_token, {
        chat_id: contact.bale_chat_id,
        text,
        ...(campaign.media_url ? { photo_url: campaign.media_url } : {}),
      });

      if (res.ok) {
        sentCount += 1;
      } else {
        failedCount += 1;
        if (isBaleBlockedError(res.error_code, res.description)) {
          await markContactBlockedAsAdmin(contact.id).catch(() => undefined);
        }
      }

      if ((i + 1) % 20 === 0 && i + 1 < targets.length) {
        await updateCampaignAsAdmin(campaignId, {
          sent_count: sentCount,
          failed_count: failedCount,
        }).catch(() => undefined);
      }

      // Rate limit to ~16.6 messages per second (60ms interval) to protect Bale API quota
      await sleep(60);
    }

    return await updateCampaignAsAdmin(campaignId, {
      status: 'completed',
      total_count: targets.length,
      sent_count: sentCount,
      failed_count: failedCount,
    });
  } catch (err) {
    console.error('Broadcast campaign worker failed:', campaignId, err);
    await updateCampaignAsAdmin(campaignId, { status: 'failed' }).catch(() => undefined);
    return null;
  } finally {
    activeCampaignIds.delete(campaignId);
  }
}

export async function runDueScheduledCampaigns(): Promise<number> {
  const cfg = getBackendConfig();
  if (!cfg.isConfigured || !cfg.hasAdminToken) return 0;

  try {
    const due = await listDueScheduledCampaignsAsAdmin(new Date().toISOString());
    for (const campaign of due) {
      if (!activeCampaignIds.has(campaign.id)) {
        void executeBroadcastCampaign(campaign.id);
      }
    }
    return due.length;
  } catch {
    return 0;
  }
}

export function startPhase4Schedulers(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const timer = setInterval(() => {
    void runAppointmentReminderSweep().catch(() => undefined);
    void runDueScheduledCampaigns().catch(() => undefined);
  }, 60 * 1000);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

export type { AppointmentRecord };
