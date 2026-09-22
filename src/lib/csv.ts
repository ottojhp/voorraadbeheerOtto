/**
 * Pure CSV-hulplaag voor de rapportage-export (SPEC §F6, taak T15).
 *
 * Nederlands/Excel-conventie in plaats van de RFC 4180-standaard (komma +
 * punt-decimaal): Excel-NL opent een CSV alleen correct in kolommen, met
 * getallen als getallen (niet als tekst), als de volgende drie dingen kloppen:
 *
 * 1. **Scheidingsteken `;`** — Excel-NL gebruikt de komma al als decimaalteken,
 *    dus het kolomscheidingsteken moet iets anders zijn. Excel leidt dit bij het
 *    openen van een `.csv` af uit de "lijstscheidingsteken"-instelling van de
 *    Windows/macOS-regio "Nederlands", die standaard `;` is.
 * 2. **Decimaalteken `,`** — een getal als `12.50` zou Excel-NL als tekst
 *    inlezen (of, erger, als "12,50" met een punt als duizendtal-scheiding
 *    misinterpreteren); `12,50` leest het als het getal 12,5.
 * 3. **UTF-8 BOM** (`﻿`) vooraan het bestand — zonder BOM neemt Excel op
 *    Windows aan dat een `.csv` in het systeem-ANSI-codepage staat, en toont het
 *    "€" en accenten (bv. "café") als rommelvinkjes. Met de BOM herkent Excel
 *    UTF-8 en toont het alles correct. Andere tools (Numbers, Google Sheets,
 *    een teksteditor) negeren de BOM probleemloos.
 *
 * Regeleinden zijn `\r\n` (CRLF), zoals RFC 4180 voorschrijft en wat Excel
 * verwacht; dit bestand bevat verder GEEN React en GEEN database-import, zodat
 * het zonder gemockte Prisma-client in Vitest getest kan worden.
 */

/** Vooraan elk geëxporteerd bestand, zodat Excel-NL het als UTF-8 herkent. */
export const CSV_BOM = "﻿";

/** Kolomscheidingsteken (Nederlandse Excel-conventie, zie boven). */
const SEPARATOR = ";";

/**
 * Quote en escape één CSV-veld volgens RFC 4180: een waarde die het
 * scheidingsteken, een aanhalingsteken of een regeleinde bevat wordt
 * omgeven door aanhalingstekens, met elk aanhalingsteken erin verdubbeld.
 * Een waarde zonder van die drie blijft ongewijzigd (leesbaarder, en niet
 * verplicht door de standaard).
 */
export function csvField(value: string): string {
  const needsQuoting =
    value.includes(SEPARATOR) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");

  if (!needsQuoting) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Formatteert een getal volgens de Nederlandse decimaalconventie: altijd 2
 * decimalen, komma als scheidingsteken, geen duizendtal-scheiding (die zou
 * met `;` als kolomscheiding verwarrend zijn). `NaN`/`Infinity` (bv. een
 * onverwachte lege deling) vallen terug op `"0,00"` in plaats van "NaN" in
 * het bestand te zetten.
 */
export function csvNumber(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toFixed(2).replace(".", ",");
}

/** Eén cel: tekst blijft tekst, een getal gaat via `csvNumber`. */
export type CsvCell = string | number;

/**
 * Bouwt een volledig CSV-document: BOM, header, datarijen — elke cel
 * gequote waar nodig, regels gescheiden door CRLF, en een afsluitende
 * regeleinde (gangbaar voor CSV-bestanden).
 */
export function buildCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((row) =>
    row
      .map((cell) => csvField(typeof cell === "number" ? csvNumber(cell) : cell))
      .join(SEPARATOR),
  );
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

/**
 * Bestandsnaam voor de export, met de periode erin zodat twee downloads van
 * verschillende periodes niet dezelfde bestandsnaam delen. `from`/`to` zijn
 * `YYYY-MM-DD`-strings (zie `formatIsoDate` in `@/lib/reporting-period`).
 */
export function csvFilename(prefix: string, from: string, to: string): string {
  return `${prefix}_${from}_${to}.csv`;
}

/** Waarde voor de `Content-Disposition`-header bij een CSV-download. */
export function contentDispositionAttachment(filename: string): string {
  // `encodeURIComponent` dekt spaties en niet-ASCII tekens af (RFC 5987,
  // `filename*=UTF-8''...`); `filename=` erbij als fallback voor oudere clients.
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
