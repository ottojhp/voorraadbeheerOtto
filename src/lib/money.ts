/**
 * Geldlaag (SPEC §3 regel 0, herschreven in v2.0).
 *
 * De opslag is asymmetrisch: de VERKOOPprijs staat inclusief btw in de database
 * (`Part.salePriceIncl`), de INKOOPprijs exclusief (`Part.purchasePriceExcl`).
 * Marge en rapportages rekenen altijd met bedragen exclusief btw, want btw is geen
 * winst — het excl.-bedrag van een verkoopprijs wordt daarom afgeleid met
 * {@link priceExclVat}.
 *
 * Elke functie hier zegt in haar naam of parameternaam met welk soort bedrag ze
 * rekent. `calcMargin(inkoopExcl, verkoopExcl)` mag dus nooit een incl.-bedrag
 * krijgen; dat zou de marge ~21% te hoog maken.
 *
 * Afronden op 2 decimalen gebeurt alleen bij presentatie en bij het afleiden,
 * nooit tussentijds in opslag.
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
 * Marge per stuk in euro's: verkoopprijs excl. btw - inkoopprijs excl. btw.
 * BEIDE bedragen moeten exclusief btw zijn; gebruik {@link priceExclVat} om het
 * excl.-bedrag uit een opgeslagen verkoopprijs af te leiden.
 */
export function calcMargin(inkoopExcl: number, verkoopExcl: number): number {
  return round2(verkoopExcl - inkoopExcl);
}

/**
 * Margepercentage op excl.-basis: (verkoop - inkoop) / verkoop * 100, met beide
 * bedragen exclusief btw. Geeft 0 als de verkoopprijs 0 is, om deling door nul te
 * voorkomen.
 */
export function calcMarginPct(inkoopExcl: number, verkoopExcl: number): number {
  if (verkoopExcl === 0) {
    return 0;
  }
  return round2(((verkoopExcl - inkoopExcl) / verkoopExcl) * 100);
}

/**
 * Regeltotaal: prijs per stuk × aantal, afgerond op centen.
 *
 * Staat hier en niet in een component (T18, SPEC §3 regel 2: één geldlaag, afronden
 * alleen bij presentatie). Het afronden is nodig omdat een prijs per stuk al een
 * bedrag in centen is: `16.52 * 3` levert in binaire floating point
 * 49.559999999999995 op, en dat is precies het soort getal dat via `formatEuro`
 * toevallig goed lijkt maar in een optelling van meerdere regels gaat schuiven.
 *
 * Werkt voor incl.- en excl.-bedragen; welk van de twee je erin stopt bepaalt wat
 * eruit komt. De aanroeper labelt het resultaat dus net zo expliciet als de invoer.
 */
export function calcLineTotal(prijsPerStuk: number, aantal: number): number {
  return round2(prijsPerStuk * aantal);
}

/**
 * Prijs inclusief btw, afgeleid van de prijs exclusief btw en het btw-percentage.
 *
 * Nog nodig voor de INKOOPprijs, die exclusief btw wordt opgeslagen, en voor
 * regeltotalen die uit een excl.-bedrag worden opgebouwd. De verkoopprijs komt
 * sinds datamodel v2 al inclusief btw uit de database en hoeft dus niet meer via
 * deze functie; daar geldt het omgekeerde ({@link priceExclVat}).
 */
export function priceWithVat(
  prijsExclBtw: number,
  btwPercentage: number,
): number {
  return round2(prijsExclBtw * (1 + btwPercentage / 100));
}

/**
 * Prijs exclusief btw, afgeleid van de prijs INCLUSIEF btw en het btw-percentage:
 * `incl / (1 + percentage / 100)`.
 *
 * Dit is het stuurgetal waarmee marge en rapportages rekenen (SPEC §3 regel 0). De
 * uitkomst mag in de orde van een halve cent afwijken van het bedrag dat vóór de
 * omrekening van datamodel v2 was opgeslagen; dat is aanvaard, want het is een
 * stuurgetal en geen bedrag dat iemand betaalt. Precies daarom staat de
 * verkoopprijs nu incl. btw in de database: die kant moet exact blijven.
 *
 * Bij een btw-percentage van 0 is het excl.-bedrag gelijk aan het incl.-bedrag.
 * Een percentage van -100 (onmogelijk: de database eist `vatRate >= 0`) zou een
 * deling door nul geven; die wordt daarom afgevangen met een teruggave van het
 * incl.-bedrag in plaats van `Infinity` op het scherm.
 */
export function priceExclVat(
  prijsInclBtw: number,
  btwPercentage: number,
): number {
  const factor = 1 + btwPercentage / 100;
  if (factor === 0) {
    return round2(prijsInclBtw);
  }
  return round2(prijsInclBtw / factor);
}
