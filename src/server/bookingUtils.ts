import type {
  AppointmentRecord,
  AvailableBookingDay,
  AvailableBookingSlot,
  BookingScheduleRecord,
  BookingServiceRecord,
} from '../types/bot.ts';
import {
  addDaysToIsoDate,
  buildTehranDateFromIsoAndTime,
  getJalaliPartsTehran,
  getPersianWeekdayIndex,
  getTehranIsoDate,
  normalizePersianText,
  toPersianDigits,
} from '../utils/jalali.ts';

function parseTimeToMinutes(hhmm: string): number | null {
  const normalized = normalizePersianText(hhmm || '');
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function minutesToHHMM(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isDateBlocked(
  blockedDates: string[],
  isoDate: string,
  jalaliSlashAscii: string
): boolean {
  if (!Array.isArray(blockedDates) || blockedDates.length === 0) return false;
  const jalaliHyphen = jalaliSlashAscii.replaceAll('/', '-');
  const isoSlash = isoDate.replaceAll('-', '/');
  for (const raw of blockedDates) {
    const clean = normalizePersianText(String(raw || ''));
    if (
      clean === isoDate ||
      clean === isoSlash ||
      clean === jalaliSlashAscii ||
      clean === jalaliHyphen
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Computes available Jalali booking days and time slots in Asia/Tehran timezone,
 * factoring in weekday schedules, blocked dates, past time buffer, and existing non-cancelled appointments.
 */
export function computeAvailableBookingDays(params: {
  service: BookingServiceRecord;
  schedules: BookingScheduleRecord[];
  appointments: AppointmentRecord[];
  daysAhead?: number;
  now?: Date;
}): AvailableBookingDay[] {
  const { service, schedules, appointments, now = new Date() } = params;
  if (!service.is_active) return [];

  const daysAhead = Math.min(Math.max(Number(params.daysAhead || 7), 1), 21);
  const duration = Math.max(Number(service.duration_minutes || 30), 5);
  const capacity = Math.max(Number(service.capacity_per_slot || 1), 1);

  const serviceSchedules = schedules.filter(
    (s) => s.service_id === service.id && s.is_active !== false
  );
  if (serviceSchedules.length === 0) return [];

  const activeAppointments = appointments.filter(
    (a) => a.service_id === service.id && a.status !== 'cancelled'
  );

  const todayIso = getTehranIsoDate(now);
  const minBookableMs = now.getTime() + 15 * 60 * 1000;
  const resultDays: AvailableBookingDay[] = [];

  for (let offset = 0; offset < daysAhead; offset += 1) {
    const isoDate = addDaysToIsoDate(todayIso, offset);
    const noonRef = buildTehranDateFromIsoAndTime(isoDate, '12:00');
    const weekday = getPersianWeekdayIndex(noonRef);
    const jalaliParts = getJalaliPartsTehran(noonRef);

    const daySchedules = serviceSchedules.filter((s) => Number(s.weekday) === weekday);
    if (daySchedules.length === 0) continue;

    const seenSlotTimes = new Set<string>();
    const daySlots: AvailableBookingSlot[] = [];

    for (const sched of daySchedules) {
      if (isDateBlocked(sched.blocked_dates || [], isoDate, jalaliParts.slashAscii)) {
        continue;
      }

      const startMin = parseTimeToMinutes(sched.start_time);
      const endMin = parseTimeToMinutes(sched.end_time);
      if (startMin === null || endMin === null || endMin <= startMin) continue;

      for (let t = startMin; t + duration <= endMin; t += duration) {
        const hhmm = minutesToHHMM(t);
        if (seenSlotTimes.has(hhmm)) continue;

        const slotDate = buildTehranDateFromIsoAndTime(isoDate, hhmm);
        if (slotDate.getTime() <= minBookableMs) continue;

        const slotMs = slotDate.getTime();
        const bookedCount = activeAppointments.filter((a) => {
          const apptMs = new Date(a.appointment_at).getTime();
          return !Number.isNaN(apptMs) && Math.abs(apptMs - slotMs) < 60 * 1000;
        }).length;

        const remaining = capacity - bookedCount;
        if (remaining > 0) {
          seenSlotTimes.add(hhmm);
          daySlots.push({
            isoAt: slotDate.toISOString(),
            timeCode: hhmm.replace(':', ''),
            timeLabel: toPersianDigits(hhmm),
            jalaliDateTime: `${jalaliParts.shortLabel} (${jalaliParts.slashPersian}) - ساعت ${toPersianDigits(hhmm)}`,
            remainingCapacity: remaining,
            totalCapacity: capacity,
          });
        }
      }
    }

    daySlots.sort((a, b) => new Date(a.isoAt).getTime() - new Date(b.isoAt).getTime());

    if (daySlots.length > 0) {
      resultDays.push({
        dayOffset: offset,
        isoDate,
        jalaliDateSlash: jalaliParts.slashPersian,
        shortLabel: jalaliParts.shortLabel,
        weekdayLabel: jalaliParts.weekdayName,
        slots: daySlots,
      });
    }
  }

  return resultDays;
}
