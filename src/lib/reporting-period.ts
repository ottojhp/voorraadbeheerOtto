/**
 * Pure periodelogica voor de rapportagepagina (SPEC §F6, taak T15).
 *
 * Bevat GEEN React en GEEN database-import, met opzet: dit bestand wordt zowel
 * server-side (`page.tsx`, `export/route.ts`, `@/lib/queries/reports`) als
 * rechtstreeks in Vitest gebruikt, zonder gemockte Prisma-client nodig te hebben.
 *
 * ---------------------------------------------------------------------------
 * Tijdzoneconventie (uitleg, want dit is de kritieke aanname van dit bestand)
 * ---------------------------------------------------------------------------
 * De server draait op UTC (`soldAt` in de database is, net als overal elders in de
 * datalaag, een UTC-instant — zie `@/lib/queries/sales.ts`). De winkel staat in
 * Nederland (Europe/Amsterdam, UTC+1 in de winter / UTC+2 in de zomer door DST).
 * "Vandaag" en "dit jaar" voor de periodekeuze moeten de kalenderdag/-jaar zijn
 * zoals de winkel die beleeft, niet de UTC-kalenderdag — anders zou een verkoop van
 * 22:30 Nederlandse tijd (zomertijd) soms nog "gisteren" lijken te zijn (20:30 UTC)
 * of, rond de jaarwisseling, zelfs in het verkeerde jaar vallen.
 *
 * Aanpak: reken NIET met een vaste UTC-offset (die klopt maar de helft van het jaar
 * door zomertijd), maar leid de offset op elk moment af via `Intl.DateTimeFormat`
 * met `timeZone: "Europe/Amsterdam"` — de browser/Node-runtime kent de IANA
 * tijdzonedatabase, dus DST-overgangen (laatste zondag van maart/oktober) worden
 * automatisch goed afgehandeld zonder een tijdzone-library als een dependency toe
 * te voegen (die is hier expliciet niet toegestaan).
 *
 * Grenzen: `from` is het BEGIN van de Amsterdamse kalenderdag (00:00:00.000 lokale
 * tijd, omgerekend naar de bijbehorende UTC-instant) en `to` het EINDE van de
 * Amsterdamse kalenderdag (23:59:59.999 lokale tijd). De query in
 * `@/lib/queries/reports.ts` vergelijkt met `gte: from` EN `lte: to` — dus een
 * gesloten interval aan beide kanten (de opdracht noemt dit "halfopen", maar geeft
 * zelf `gte`/`lte` aan beide zijden; met milliseconde-granulariteit en `to` op
 * 23:59:59.999 is een verkoop van vandaag 16:00 uur zo hoe dan ook gedekt, en het
 * risico van een gesloten interval — een verkoop op exact de grens dubbel meetellen
 * over twee periodes — bestaat hier niet omdat opeenvolgende periodes nooit
 * dezelfde grens delen op millisecondeniveau).
 */

import { APP_TIME_ZONE } from "@/lib/datetime";

// ---------------------------------------------------------------------------
// Kalenderdatum-hulpjes (puur, geen tijdzone-aanname, alleen y/m/d rekenen)
// ---------------------------------------------------------------------------

export interface CalendarDate {
  /** Volledig jaar, bv. `2026`. */
  year: number;
  /** 1-gebaseerde maand, `1`–`12`. */
  month: number;
  /** Dag van de maand, `1`–`31`. */
  day: number;
}

/** `YYYY-MM-DD`, altijd met leidende nullen. */
export function formatIsoDate(date: CalendarDate): string {
  const y = String(date.year).padStart(4, "0");
  const m = String(date.month).padStart(2, "0");
  const d = String(date.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Telt `deltaDays` (mag negatief zijn) op bij een kalenderdatum. Gebruikt
 * `Date.UTC` puur als rekenmachine voor kalenderdata (niet als instant) — dat
 * normaliseert maandgrenzen en schrikkeljaren correct zonder tijdzone-effecten,
 * omdat we consistent de UTC-variant van elke methode gebruiken.
 */
export function addCalendarDays(date: CalendarDate, deltaDays: number): CalendarDate {
  const ms = Date.UTC(date.year, date.month - 1, date.day + deltaDays);
  const asDate = new Date(ms);
  return {
    year: asDate.getUTCFullYear(),
    month: asDate.getUTCMonth() + 1,
    day: asDate.getUTCDate(),
  };
}

/**
 * Parseert een `YYYY-MM-DD`-string naar een `CalendarDate`, of `null` bij een
 * verkeerd formaat óf een datum die niet bestaat (bv. `2026-02-30`). JavaScript's
 * `Date` normaliseert een ongeldige daginvoer stilzwijgend (30 februari wordt 2
 * maart) — daarom wordt hier expliciet teruggecontroleerd of de geparste waarden
 * overeenkomen met de invoer.
 */
export function parseIsoDateParts(value: string | undefined | null): CalendarDate | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  const ms = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(ms);
  const isRealDate =
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day;

  return isRealDate ? { year, month, day } : null;
}

// ---------------------------------------------------------------------------
// Europe/Amsterdam ↔ UTC
// ---------------------------------------------------------------------------

const AMSTERDAM_TZ = APP_TIME_ZONE;

/** Herbruikbare formatter; `Intl.DateTimeFormat` is duur genoeg om niet per call te maken. */
const amsterdamPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: AMSTERDAM_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * Het offset van Europe/Amsterdam ten opzichte van UTC, in minuten, zoals het
 * geldt op het moment `utcInstant` (dus met het juiste zomer-/wintertijdregime).
 * Positief betekent: Amsterdam loopt vóór op UTC (bv. `+120` in de zomer).
 */
function amsterdamOffsetMinutesAt(utcInstant: Date): number {
  const parts = Object.fromEntries(
    amsterdamPartsFormatter
      .formatToParts(utcInstant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asIfUtc - utcInstant.getTime()) / 60_000);
}

/**
 * De Amsterdamse kalenderdag waarin een UTC-instant valt.
 */
export function amsterdamCalendarDateOf(utcInstant: Date): CalendarDate {
  const parts = Object.fromEntries(
    amsterdamPartsFormatter
      .formatToParts(utcInstant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

/**
 * UTC-instant die correspondeert met 00:00:00.000 Amsterdamse lokale tijd op de
 * gegeven kalenderdag.
 *
 * Werkwijze: begin met een gok — dezelfde y/m/d als UTC-middernacht — en corrigeer
 * die met het Amsterdamse offset dat op dát moment geldt. Eén iteratie volstaat:
 * het offset is óf +60 óf +120 minuten, dus de UTC-gok (`00:00 UTC`) valt altijd
 * nog vroeg genoeg op dezelfde Amsterdamse kalenderdag (01:00 of 02:00 lokale
 * tijd) om het juiste DST-regime van díe dag af te lezen — behalve op de paar
 * dagen per jaar dat de klok exact tussen 00:00 en 02:00 Amsterdamse tijd
 * verspringt, wat in Europe/Amsterdam niet voorkomt (de overgang is om 02:00/03:00
 * lokale tijd).
 */
export function startOfAmsterdamDayUtc(date: CalendarDate): Date {
  const guess = new Date(Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0, 0));
  const offsetMinutes = amsterdamOffsetMinutesAt(guess);
  return new Date(guess.getTime() - offsetMinutes * 60_000);
}

/** UTC-instant die correspondeert met 23:59:59.999 Amsterdamse lokale tijd. */
export function endOfAmsterdamDayUtc(date: CalendarDate): Date {
  const nextDayStart = startOfAmsterdamDayUtc(addCalendarDays(date, 1));
  return new Date(nextDayStart.getTime() - 1);
}

// ---------------------------------------------------------------------------
// Periodekeuze
// ---------------------------------------------------------------------------

export type PeriodPreset = "7d" | "30d" | "90d" | "ytd" | "custom";

/**
 * De "vaste" presets, dus zonder `"custom"` — dit is het type dat `presetPeriod`
 * accepteert. Een apart type (in plaats van steeds `Exclude<PeriodPreset, "custom">`
 * te herhalen of, erger, `DEFAULT_PRESET` als het bredere `PeriodPreset` te typeren)
 * zodat TypeScript op de aanroepplekken hieronder kan bewijzen dat `"custom"` er
 * nooit inzit, zonder overal handmatige `as`-casts.
 */
export type FixedPeriodPreset = Exclude<PeriodPreset, "custom">;

const VALID_PRESETS: ReadonlySet<string> = new Set([
  "7d",
  "30d",
  "90d",
  "ytd",
  "custom",
]);

/** Periode waarop teruggevallen wordt bij ontbrekende of ongeldige invoer. */
export const DEFAULT_PRESET: FixedPeriodPreset = "30d";

export const PERIOD_PRESET_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: "7d", label: "Laatste 7 dagen" },
  { value: "30d", label: "Laatste 30 dagen" },
  { value: "90d", label: "Laatste 90 dagen" },
  { value: "ytd", label: "Dit jaar" },
  { value: "custom", label: "Eigen periode" },
];

export interface ReportingPeriodInput {
  /** Ruwe waarde uit de URL (`searchParams.preset`); alles behalve de 5 geldige waarden valt terug op het standaardgedrag. */
  preset?: string;
  /** `YYYY-MM-DD`, alleen gebruikt als `preset === "custom"`. */
  from?: string;
  /** `YYYY-MM-DD`, alleen gebruikt als `preset === "custom"`. */
  to?: string;
  /**
   * "Nu", als UTC-instant. Optioneel injecteerbaar voor deterministische tests
   * rond middernacht/jaarwisseling; standaard `new Date()`.
   */
  now?: Date;
}

export interface ReportingPeriod {
  preset: PeriodPreset;
  /** UTC-instant voor 00:00:00.000 Amsterdamse tijd op de eerste dag van de periode. */
  from: Date;
  /** UTC-instant voor 23:59:59.999 Amsterdamse tijd op de laatste dag van de periode. */
  to: Date;
  /**
   * Nette Nederlandse melding als de invoer ongeldig was en er is teruggevallen op
   * de standaardperiode (`DEFAULT_PRESET`). `null` als de invoer geldig was.
   */
  warning: string | null;
}

function presetPeriod(
  preset: FixedPeriodPreset,
  today: CalendarDate,
): ReportingPeriod {
  let fromDate: CalendarDate;
  switch (preset) {
    case "7d":
      fromDate = addCalendarDays(today, -6);
      break;
    case "30d":
      fromDate = addCalendarDays(today, -29);
      break;
    case "90d":
      fromDate = addCalendarDays(today, -89);
      break;
    case "ytd":
      fromDate = { year: today.year, month: 1, day: 1 };
      break;
  }
  return {
    preset,
    from: startOfAmsterdamDayUtc(fromDate),
    to: endOfAmsterdamDayUtc(today),
    warning: null,
  };
}

const FALLBACK_NOTICE =
  "de standaardperiode (laatste 30 dagen) wordt getoond.";

/**
 * Bepaalt de periode voor de rapportagepagina uit (onbetrouwbare) URL-invoer.
 * Ongeldige invoer — een onbekende preset, een niet-bestaande datum, of een
 * einddatum vóór de begindatum — geeft NOOIT een fout: er wordt teruggevallen op
 * `DEFAULT_PRESET` met een toonbare Nederlandse `warning`.
 */
export function resolveReportingPeriod(
  input: ReportingPeriodInput = {},
): ReportingPeriod {
  const now = input.now ?? new Date();
  const today = amsterdamCalendarDateOf(now);

  const presetRaw = input.preset;

  if (presetRaw === undefined) {
    return presetPeriod(DEFAULT_PRESET, today);
  }

  if (!VALID_PRESETS.has(presetRaw)) {
    return { ...presetPeriod(DEFAULT_PRESET, today), warning: `Onbekende periode "${presetRaw}"; ${FALLBACK_NOTICE}` };
  }

  if (presetRaw !== "custom") {
    return presetPeriod(presetRaw as FixedPeriodPreset, today);
  }

  const fromParts = parseIsoDateParts(input.from);
  const toParts = parseIsoDateParts(input.to);

  if (!fromParts || !toParts) {
    return { ...presetPeriod(DEFAULT_PRESET, today), warning: `Ongeldige datum opgegeven; ${FALLBACK_NOTICE}` };
  }

  const from = startOfAmsterdamDayUtc(fromParts);
  const to = endOfAmsterdamDayUtc(toParts);

  if (from.getTime() > to.getTime()) {
    return {
      ...presetPeriod(DEFAULT_PRESET, today),
      warning: `De einddatum ligt vóór de begindatum; ${FALLBACK_NOTICE}`,
    };
  }

  return { preset: "custom", from, to, warning: null };
}

// ---------------------------------------------------------------------------
// Bucket-enumeratie voor "omzet per dag/week" (SPEC §F6)
// ---------------------------------------------------------------------------

/**
 * Alle Amsterdamse kalenderdagen tussen `from` en `to` (inclusief), als
 * `YYYY-MM-DD`. Gebruikt door `@/lib/queries/reports.ts` om dagen zonder verkoop
 * als `0` te tonen in plaats van ze in de grafiek te laten ontbreken.
 */
export function enumerateDayBuckets(from: Date, to: Date): string[] {
  const start = amsterdamCalendarDateOf(from);
  const end = amsterdamCalendarDateOf(to);
  const days: string[] = [];
  let cursor = start;
  // Harde bovengrens zodat een verkeerd omgedraaide periode nooit een oneindige
  // lus veroorzaakt — een rapportageperiode van >10 jaar is hier niet realistisch.
  let guard = 0;
  while (
    Date.UTC(cursor.year, cursor.month - 1, cursor.day) <=
      Date.UTC(end.year, end.month - 1, end.day) &&
    guard < 3700
  ) {
    days.push(formatIsoDate(cursor));
    cursor = addCalendarDays(cursor, 1);
    guard += 1;
  }
  return days;
}

/** Maandag van de ISO-week waarin `date` valt. */
function isoWeekStart(date: CalendarDate): CalendarDate {
  const asDate = new Date(Date.UTC(date.year, date.month - 1, date.day));
  // getUTCDay(): 0 = zondag .. 6 = zaterdag. ISO-weken beginnen op maandag.
  const isoDayIndex = (asDate.getUTCDay() + 6) % 7; // 0 = maandag .. 6 = zondag
  return addCalendarDays(date, -isoDayIndex);
}

/**
 * Alle week-startdata (maandag, ISO-week) tussen `from` en `to` (inclusief), als
 * `YYYY-MM-DD` van die maandag.
 */
export function enumerateWeekBuckets(from: Date, to: Date): string[] {
  const startWeek = isoWeekStart(amsterdamCalendarDateOf(from));
  const endWeek = isoWeekStart(amsterdamCalendarDateOf(to));
  const weeks: string[] = [];
  let cursor = startWeek;
  let guard = 0;
  while (
    Date.UTC(cursor.year, cursor.month - 1, cursor.day) <=
      Date.UTC(endWeek.year, endWeek.month - 1, endWeek.day) &&
    guard < 530
  ) {
    weeks.push(formatIsoDate(cursor));
    cursor = addCalendarDays(cursor, 7);
    guard += 1;
  }
  return weeks;
}
