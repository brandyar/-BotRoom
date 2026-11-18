const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toPersianDigits(input: string | number): string {
  const str = String(input);
  return str.replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit);
}

export function normalizePersianText(input: string): string {
  let result = input.trim();
  // Normalize Arabic Yeh and Kaf to Persian equivalents
  result = result.replace(/\u064a/g, '\u06cc').replace(/\u0643/g, '\u06a9');
  // Convert Persian & Arabic digits to ASCII digits for consistent validation
  for (let i = 0; i < 10; i++) {
    result = result.replaceAll(PERSIAN_DIGITS[i], String(i));
    result = result.replaceAll(ARABIC_DIGITS[i], String(i));
  }
  return result;
}

export function formatJalaliDateTime(isoDate?: string | null): string {
  if (!isoDate) return '—';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '—';

  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toLocaleString('fa-IR');
  }
}

export function formatJalaliDate(isoDate?: string | null): string {
  if (!isoDate) return '—';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '—';

  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  } catch {
    return date.toLocaleDateString('fa-IR');
  }
}

export function formatPriceToman(amount: number | string | null | undefined): string {
  const num = Number(amount || 0);
  if (Number.isNaN(num)) return '۰ تومان';
  return `${num.toLocaleString('fa-IR')} تومان`;
}

export const PERSIAN_WEEKDAYS = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنج‌شنبه',
  'جمعه',
] as const;

const EN_WEEKDAY_TO_PERSIAN_INDEX: Record<string, number> = {
  Sat: 0,
  Sun: 1,
  Mon: 2,
  Tue: 3,
  Wed: 4,
  Thu: 5,
  Fri: 6,
};

export function getTehranIsoDate(date: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value || '2026';
    const m = parts.find((p) => p.type === 'month')?.value || '01';
    const d = parts.find((p) => p.type === 'day')?.value || '01';
    return `${y}-${m}-${d}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

export function buildTehranDateFromIsoAndTime(isoDate: string, timeHHMM: string): Date {
  const cleanTime = /^\d{2}:\d{2}$/.test(timeHHMM.trim()) ? timeHHMM.trim() : '09:00';
  return new Date(`${isoDate}T${cleanTime}:00+03:30`);
}

export function getPersianWeekdayIndex(date: Date): number {
  try {
    const short = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran',
      weekday: 'short',
    }).format(date);
    if (short in EN_WEEKDAY_TO_PERSIAN_INDEX) {
      return EN_WEEKDAY_TO_PERSIAN_INDEX[short];
    }
  } catch {
    // fallback below
  }
  const tehranOffsetMs = 3.5 * 60 * 60 * 1000;
  const shifted = new Date(date.getTime() + tehranOffsetMs);
  return (shifted.getUTCDay() + 1) % 7;
}

export function getJalaliPartsTehran(date: Date): {
  yearAscii: string;
  monthAscii: string;
  dayAscii: string;
  slashAscii: string;
  slashPersian: string;
  weekdayName: string;
  shortLabel: string;
  timePersian: string;
} {
  const weekdayIdx = getPersianWeekdayIndex(date);
  const weekdayName = PERSIAN_WEEKDAYS[weekdayIdx] || 'شنبه';

  let yearAscii = '';
  let monthAscii = '';
  let dayAscii = '';
  let monthName = '';
  let dayPersian = '';
  let timePersian = '';

  try {
    const numericParts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    yearAscii = (numericParts.find((p) => p.type === 'year')?.value || '').replace(/\D/g, '');
    monthAscii = (numericParts.find((p) => p.type === 'month')?.value || '').padStart(2, '0');
    dayAscii = (numericParts.find((p) => p.type === 'day')?.value || '').padStart(2, '0');

    const persianParts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    monthName = persianParts.find((p) => p.type === 'month')?.value || '';
    dayPersian = persianParts.find((p) => p.type === 'day')?.value || toPersianDigits(dayAscii);
    const hourP = persianParts.find((p) => p.type === 'hour')?.value || '۰۰';
    const minP = persianParts.find((p) => p.type === 'minute')?.value || '۰۰';
    timePersian = `${hourP}:${minP}`;
  } catch {
    const iso = getTehranIsoDate(date);
    [yearAscii, monthAscii, dayAscii] = iso.split('-');
    monthName = toPersianDigits(monthAscii);
    dayPersian = toPersianDigits(dayAscii);
    timePersian = toPersianDigits('09:00');
  }

  const slashAscii = `${yearAscii}/${monthAscii}/${dayAscii}`;
  const slashPersian = toPersianDigits(slashAscii);
  const shortLabel = `${weekdayName} ${dayPersian} ${monthName}`.trim();

  return {
    yearAscii,
    monthAscii,
    dayAscii,
    slashAscii,
    slashPersian,
    weekdayName,
    shortLabel,
    timePersian,
  };
}


