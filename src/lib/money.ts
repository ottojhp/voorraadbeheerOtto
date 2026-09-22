/**
 * Geldlaag: alle bedragen in de app zijn EXCLUSIEF btw, tenzij de functienaam
 * anders zegt (zie SPEC.md §3 regel 0). Afronden op 2 decimalen gebeurt alleen
 * bij presentatie, via `round2` / `formatEuro`, nooit tussentijds in opslag.
 */

/**
 * Rondt een bedrag af op 2 decimalen, met correctie voor floating point
 * afrondingsfouten (bv. 19.995 die door binaire representatie als
 * 19.994999... kan worden opgeslagen).
 */
function round2(bedrag: number): number {
  return Math.round((bedrag + Number.EPSILON) * 100) / 100;
}

/**
 * Formatteert een bedrag in euro's volgens Nederlandse conventie,
 * bv. `formatEuro(19.5)` → `"€ 19,50"`.
 */
export function formatEuro(bedrag: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(bedrag);
}

/**
 * Marge per stuk in euro's, exclusief btw: verkoopprijs - inkoopprijs.
 */
export function calcMargin(inkoop: number, verkoop: number): number {
  return round2(verkoop - inkoop);
}

/**
 * Margepercentage exclusief btw: (verkoop - inkoop) / verkoop * 100.
 * Geeft 0 als de verkoopprijs 0 is, om deling door nul te voorkomen.
 */
export function calcMarginPct(inkoop: number, verkoop: number): number {
  if (verkoop === 0) {
    return 0;
  }
  return round2(((verkoop - inkoop) / verkoop) * 100);
}

/**
 * Prijs inclusief btw, afgeleid van de prijs exclusief btw en het
 * btw-percentage. Alleen voor weergave; nooit opslaan (SPEC §3 regel 0).
 */
export function priceWithVat(
  prijsExclBtw: number,
  btwPercentage: number,
): number {
  return round2(prijsExclBtw * (1 + btwPercentage / 100));
}
