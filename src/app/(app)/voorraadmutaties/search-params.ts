/**
 * Pure URL-logica voor `/voorraadmutaties` (T24), zonder `"use client"`.
 *
 * Staat bewust los van `MutationsFilters.tsx` (een client component): een
 * `"use client"`-bestand mag alleen componenten en types exporteren, en een gewone
 * functie die daaruit door een server component wordt aangeroepen laat de pagina bij
 * élk bezoek crashen zonder dat de build of de tests het merken. Dit bestand heeft
 * geen React, importeert geen Prisma-runtime (alleen `import type`) en is daardoor
 * ook zonder database te testen (`src/lib/__tests__/stock-mutations.test.ts`).
 *
 * ALLE filterstatus staat in de URL, zodat de pagina deelbaar en herlaadbaar is:
 *
 * | parameter | waarde                                               | standaard |
 * |-----------|------------------------------------------------------|-----------|
 * | `reason`  | DELIVERY, CORRECTION, COUNT, SALE, WORKSHOP, INITIAL | alle      |
 * | `preset`  | `today`, `7d`, `30d`, `90d`, `ytd`, `custom`         | alles     |
 * | `from`    | `YYYY-MM-DD`, alleen bij `preset=custom`             | —         |
 * | `to`      | `YYYY-MM-DD`, alleen bij `preset=custom`             | —         |
 * | `page`    | 1-gebaseerd paginanummer                             | 1         |
 *
 * Zonder `preset` is er geen periodefilter: het grootboek toont dan alles. Dat wijkt
 * bewust af van `/rapportages` (standaard 30 dagen): een rapportage heeft een periode
 * nodig om iets te kunnen zeggen, een grootboek is er om terug te kunnen zoeken.
 * Ongeldige invoer (onbekende reden, kapotte datum) geeft nooit een fout: het filter
 * valt weg en er komt een toonbare melding, zodat een oude of geknoeide link blijft
 * werken. Periodegrenzen zijn Amsterdamse kalenderdagen (zie `@/lib/reporting-period`).
 */

import {
  STOCK_MUTATION_REASON_OPTIONS,
  type StockMutationReason,
} from "@/lib/labels";
import type { StockMutationFilters } from "@/lib/queries/stock-mutations";
import {
  amsterdamCalendarDateOf,
  endOfAmsterdamDayUtc,
  parseIsoDateParts,
  resolveReportingPeriod,
  startOfAmsterdamDayUtc,
  type FixedPeriodPreset,
} from "@/lib/reporting-period";

import {
  normalizeSearchParams,
  type RawSearchParams,
} from "../onderdelen/search-params";

export { normalizeSearchParams, type RawSearchParams };

/** Periodekeuzes van dit scherm; "" (geen keuze) betekent "alles". */
export type MutationPreset = "today" | FixedPeriodPreset | "custom";

export const MUTATION_PRESET_OPTIONS: {
  value: MutationPreset | "";
  label: string;
}[] = [
  { value: "", label: "Alles" },
  { value: "today", label: "Vandaag" },
  { value: "7d", label: "Laatste 7 dagen" },
  { value: "30d", label: "Laatste 30 dagen" },
  { value: "90d", label: "Laatste 90 dagen" },
  { value: "ytd", label: "Dit jaar" },
  { value: "custom", label: "Eigen periode" },
];

const VALID_REASONS: ReadonlySet<string> = new Set(STOCK_MUTATION_REASON_OPTIONS);
const FIXED_PRESETS: ReadonlySet<string> = new Set(["7d", "30d", "90d", "ytd"]);

export interface ParsedMutationParams {
  /** Filters voor `listStockMutations` (reden en periode). */
  filters: StockMutationFilters;
  /** 1-gebaseerd, al hersteld naar een positief geheel getal. */
  page: number;
  /** De geldige periodekeuze, of `null` als er geen periodefilter gekozen is. */
  preset: MutationPreset | null;
  /** `true` zodra er een reden- of periodefilter actief is. */
  hasFilter: boolean;
  /** Nederlandse melding als een deel van de invoer ongeldig was, anders `null`. */
  warning: string | null;
}

/**
 * Leest de filters uit genormaliseerde `searchParams` (`normalizeSearchParams`).
 * `now` is injecteerbaar zodat "vandaag" en "laatste 7 dagen" deterministisch te
 * testen zijn rond middernacht.
 */
export function parseMutationSearchParams(
  params: Record<string, string>,
  now: Date = new Date(),
): ParsedMutationParams {
  const warnings: string[] = [];
  const filters: StockMutationFilters = {};

  // --- reden --------------------------------------------------------------
  if (params.reason !== undefined) {
    if (VALID_REASONS.has(params.reason)) {
      filters.reason = params.reason as StockMutationReason;
    } else {
      warnings.push(
        `Onbekende reden "${params.reason}"; alle redenen worden getoond.`,
      );
    }
  }

  // --- periode ------------------------------------------------------------
  let preset: MutationPreset | null = null;
  const presetRaw = params.preset;

  if (presetRaw === "today") {
    const today = amsterdamCalendarDateOf(now);
    filters.from = startOfAmsterdamDayUtc(today);
    filters.to = endOfAmsterdamDayUtc(today);
    preset = "today";
  } else if (presetRaw !== undefined && FIXED_PRESETS.has(presetRaw)) {
    const period = resolveReportingPeriod({ preset: presetRaw, now });
    filters.from = period.from;
    filters.to = period.to;
    preset = presetRaw as FixedPeriodPreset;
  } else if (presetRaw === "custom") {
    preset = "custom";
    const fromParts = parseIsoDateParts(params.from);
    const toParts = parseIsoDateParts(params.to);
    const fromBad = params.from !== undefined && fromParts === null;
    const toBad = params.to !== undefined && toParts === null;

    if (fromBad || toBad) {
      warnings.push(
        "Ongeldige datum opgegeven; er wordt niet op periode gefilterd.",
      );
    } else if (
      fromParts &&
      toParts &&
      startOfAmsterdamDayUtc(fromParts) > endOfAmsterdamDayUtc(toParts)
    ) {
      warnings.push(
        "De einddatum ligt vóór de begindatum; er wordt niet op periode gefilterd.",
      );
    } else {
      // Eén kant mag ontbreken: "vanaf 1 september" of "tot en met 15 september".
      if (fromParts) filters.from = startOfAmsterdamDayUtc(fromParts);
      if (toParts) filters.to = endOfAmsterdamDayUtc(toParts);
    }
  } else if (presetRaw !== undefined) {
    warnings.push(
      `Onbekende periode "${presetRaw}"; er wordt niet op periode gefilterd.`,
    );
  }

  // --- pagina -------------------------------------------------------------
  const pageNumber = Number(params.page);
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1;

  return {
    filters,
    page,
    preset,
    hasFilter: Boolean(filters.reason || filters.from || filters.to),
    warning: warnings.length > 0 ? warnings.join(" ") : null,
  };
}

/**
 * Bouwt een querystring die de huidige filters behoudt en `overrides` toepast.
 * `null`/`undefined`/lege strings verwijderen die parameter. Het paginanummer wordt
 * bij elke filterwijziging gewist (anders blijft "pagina 3" staan terwijl de
 * resultaten onder het nieuwe filter een heel andere set zijn); geef `page`
 * expliciet mee om dat te omzeilen (paginering-links).
 */
export function buildMutationsQuery(
  current: Record<string, string>,
  overrides: Record<string, string | number | null | undefined>,
): string {
  const merged: Record<string, string | number | null | undefined> = {
    ...current,
    ...overrides,
  };
  if (!("page" in overrides)) {
    merged.page = undefined;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    // Pagina 1 is de standaard en hoort niet in de URL.
    if (key === "page" && Number(value) === 1) {
      continue;
    }
    params.set(key, String(value));
  }

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
