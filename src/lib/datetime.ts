/**
 * Gedeelde datum- en tijdopmaak voor de hele app. Pure helpers, geen React en geen
 * database: bruikbaar in server components, client components en Vitest.
 *
 * ### Waarom deze module bestaat
 *
 * De app draait op Vercel en die servers staan op UTC; de winkel staat in Nederland.
 * Een `Intl.DateTimeFormat` / `toLocaleString` zonder `timeZone` gebruikt de tijdzone
 * van het proces: lokaal (Amsterdam) lijkt dat goed, op de server staat elke tijd een
 * of twee uur ernaast (een verkoop van 16:30 toonde als 14:30).
 *
 * REGEL: toon nooit een datum of tijd met `toLocale*String` of een eigen
 * `Intl.DateTimeFormat`. Gebruik de functies hieronder; die hebben de tijdzone vast.
 * `src/lib/__tests__/datetime.test.ts` bewaakt dit, ook statisch.
 */

/** De tijdzone van de winkel. De enige plek in `src/` waar deze string hoort te staan. */
export const APP_TIME_ZONE = "Europe/Amsterdam";

const LOCALE = "nl-NL";

// `Intl.DateTimeFormat` aanmaken is duur; eenmaal per module is genoeg.
const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const compactDateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const dayMonthFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "short",
});

/** Datum + tijd zoals de winkel ze beleeft, bv. `1 okt 2026, 14:05`. Invoer: ISO-string of `Date`. */
export function formatDateTime(value: string | Date): string {
  return dateTimeFormatter.format(new Date(value));
}

/** Korte variant zonder jaar, bv. `01-10, 14:05`; voor smalle lijstjes. */
export function formatCompactDateTime(value: string | Date): string {
  return compactDateTimeFormatter.format(new Date(value));
}

/**
 * Een kalenderdag (zonder tijd) als `22 sep`, bv. voor grafieklabels. De invoer is een
 * kalenderdatum, geen moment: we bouwen er 12:00 UTC van, zodat de dag in Amsterdam
 * (UTC+1/+2) nooit naar een naburige dag kan verspringen.
 */
export function formatCalendarDayMonth(year: number, month: number, day: number): string {
  return dayMonthFormatter.format(new Date(Date.UTC(year, month - 1, day, 12)));
}
