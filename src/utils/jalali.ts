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
