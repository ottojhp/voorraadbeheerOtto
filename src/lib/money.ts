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
 * Geldbedrag → veldwaarde voor een invoerveld, altijd met twee decimalen en een
 * komma als decimaalteken: `30.19` → `"30,19"` (T26).
 *
 * Altijd twee decimalen, ook bij een rond bedrag: zag de gebruiker na het aantikken
 * van een kortingsknop "27" staan, dan lijkt het alsof het veld iets anders bewaart
 * dan de prijs die eronder getoond wordt. Zelfde afweging als
 * `toMoneyDisplayString` in `PartForm`.
 */
export function toMoneyInput(bedrag: number): string {
  return bedrag.toFixed(2).replace(".", ",");
}

/** Uitkomst van {@link readMoneyInput}: een getal, of een Nederlandse foutmelding. */
export type MoneyInputResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Leest een door een mens ingetypt geldbedrag (T26): komma óf punt als
 * decimaalteken, maximaal twee decimalen, niet negatief.
 *
 * Deze ene functie wordt gebruikt door het verkoopscherm (live, terwijl de
 * baliemedewerker typt) ÉN door het Zod-schema op de server
 * (`@/lib/validation/sales`). Daarmee kan de melding die de gebruiker vóór het
 * verzenden ziet niet afwijken van de melding die de server zou geven, en kan een
 * bedrag dat het scherm goedkeurt nooit door de server geweigerd worden (of
 * omgekeerd). Client-side blijft hulp, server-side blijft de beveiliging
 * (SPEC §3 regel 7).
 *
 * Het minteken is in de regex TOEGESTAAN en wordt daarna apart afgekeurd. Anders
 * krijgt "-5" de nietszeggende melding dat het geen getal is, in plaats van de
 * melding die er hoort te staan: een prijs mag niet negatief zijn. Nul mag wel —
 * iets weggeven is toegestaan.
 *
 * @param label Begin van de foutmelding, bv. `"De prijs"`.
 */
export function readMoneyInput(raw: string, label: string): MoneyInputResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, error: `${label} is verplicht` };
  }
  const normalized = trimmed.replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
    return {
      ok: false,
      error: `${label} moet een getal zijn met maximaal 2 decimalen, bv. 12,50`,
    };
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      error: `${label} moet een getal zijn met maximaal 2 decimalen, bv. 12,50`,
    };
  }
  if (value < 0) {
    return { ok: false, error: `${label} mag niet negatief zijn` };
  }
  return { ok: true, value };
}

/**
 * Formatteert een percentage volgens Nederlandse conventie met één decimaal,
 * bv. `formatPercent(10)` → `"10,0%"`.
 *
 * Eén helper, zodat het kortingspercentage in het verkoopscherm er net zo uitziet als
 * het margepercentage in de rapportages.
 */
export function formatPercent(percentage: number): string {
  const formatted = new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(percentage);
  return `${formatted}%`;
}

/**
 * Nieuwe prijs na een kortingspercentage, afgerond op centen (T26).
 *
 * De afronding gebeurt HIER en niet pas bij het tonen, omdat de uitkomst een bedrag
 * is dat de klant werkelijk betaalt en dat zo in de database belandt: 10% van
 * € 30,19 is 27,171, en daar kan niemand mee afrekenen. Alle andere getallen op het
 * scherm (het kortingsbedrag, het kortingspercentage, de marge) worden uit dit
 * AFGERONDE bedrag afgeleid met {@link calcDiscountAmount} en
 * {@link calcDiscountPct}. Zo kan het getoonde percentage niet uit de pas lopen met
 * het getoonde bedrag — de klassieke fout is het bedrag afronden en het percentage
 * uit het onafgeronde getal halen.
 *
 * Een korting van meer dan 100% zou een negatieve prijs geven; die wordt op `0`
 * afgekapt (iets weggeven mag, geld meegeven niet — SPEC §3 regel 0 en de
 * CHECK-constraint op `Sale`).
 */
export function applyDiscountPct(
  normalePrijs: number,
  kortingPercentage: number,
): number {
  const nieuw = round2(normalePrijs * (1 - kortingPercentage / 100));
  return nieuw < 0 ? 0 : nieuw;
}

/**
 * Nieuwe prijs na een vast kortingsbedrag, afgerond op centen en afgekapt op `0`
 * (T26). Zie {@link applyDiscountPct} voor waarom het afronden hier gebeurt.
 */
export function applyDiscountAmount(
  normalePrijs: number,
  kortingBedrag: number,
): number {
  const nieuw = round2(normalePrijs - kortingBedrag);
  return nieuw < 0 ? 0 : nieuw;
}

/**
 * Gegeven korting per stuk: normale prijs − werkelijk betaalde prijs (T26).
 *
 * Beide bedragen moeten van dezelfde soort zijn (allebei incl. of allebei excl.
 * btw); de aanroeper labelt de uitkomst net zo expliciet als de invoer. Negatief als
 * er MEER betaald is dan de normale prijs — dat wordt niet weggepoetst, want dan
 * hoort er een waarschuwing op het scherm te staan en geen 0.
 */
export function calcDiscountAmount(
  normalePrijs: number,
  betaaldePrijs: number,
): number {
  return round2(normalePrijs - betaaldePrijs);
}

/**
 * Gegeven korting als percentage van de normale prijs (T26).
 *
 * Wordt afgeleid uit het AFGERONDE kortingsbedrag
 * ({@link calcDiscountAmount}), zodat percentage en bedrag per constructie bij elkaar
 * horen: wie "10%" aantikt op € 30,19 betaalt € 27,17 en ziet dus € 3,02 korting en
 * 10,0% — niet 10,0% naast een bedrag dat 10,003% is.
 *
 * Geeft `0` als de normale prijs `0` is (geen deling door nul, en 0% korting op iets
 * dat gratis is, is de enige zinnige uitkomst).
 */
export function calcDiscountPct(
  normalePrijs: number,
  betaaldePrijs: number,
): number {
  if (normalePrijs === 0) {
    return 0;
  }
  return round2((calcDiscountAmount(normalePrijs, betaaldePrijs) / normalePrijs) * 100);
}

/**
 * Alle bedragen van één verkoopregel met korting, uit elkaar getrokken (T26).
 * Alleen `number`s, dus veilig voor een client component én voor een DTO.
 */
export interface SalePricing {
  /** Btw-percentage waarmee gerekend is, bv. `21`. */
  vatRate: number;
  quantity: number;
  /** NORMALE prijs per stuk, incl. btw. */
  listPriceIncl: number;
  /** Afgeleid uit {@link listPriceIncl}. */
  listPriceExcl: number;
  /** WERKELIJK BETAALDE prijs per stuk, incl. btw. */
  paidPriceIncl: number;
  /** Afgeleid uit {@link paidPriceIncl}; hiermee rekenen marge en rapportages. */
  paidPriceExcl: number;
  /** Korting per stuk incl. btw; negatief als er méér dan normaal betaald is. */
  discountPerUnitIncl: number;
  /** Korting als percentage van de normale prijs, consistent met het bedrag. */
  discountPct: number;
  /** `true` zodra er korting gegeven is (strikt positief). */
  hasDiscount: boolean;
  /** `true` als de betaalde prijs HOGER is dan de normale prijs. */
  isSurcharge: boolean;
  /** `quantity ×` de normale prijs, incl. resp. excl. btw. */
  lineTotalListIncl: number;
  lineTotalListExcl: number;
  /** `quantity ×` de betaalde prijs: wat er werkelijk afgerekend is. */
  lineTotalPaidIncl: number;
  lineTotalPaidExcl: number;
  /** `quantity × (normaal − betaald)`, incl. resp. excl. btw. */
  discountTotalIncl: number;
  discountTotalExcl: number;
}

/**
 * Rekent één verkoopregel met korting helemaal door (T26).
 *
 * Deze functie staat hier, in de geldlaag, en niet in de datalaag of in het
 * verkoopscherm, omdat beide hem gebruiken: het scherm voor de LIVE weergave terwijl
 * de baliemedewerker een prijs intypt, en `registerSale()`/`listRecentSales()` voor de
 * DTO's die daarna op het scherm komen. Eén definitie betekent dat het bedrag in de
 * live-weergave niet kan afwijken van het bedrag in de bevestiging — dezelfde reden
 * dat `PartForm` de omrekening van de inkoopprijs met dezelfde helper doet als de
 * server.
 *
 * De excl.-bedragen worden PER STUK afgeleid en afgerond vóór de vermenigvuldiging met
 * `quantity`, net als in `getStockValue` en in de rapportagequery's, zodat een totaal
 * op het scherm gelijk blijft aan de som van de regelbedragen (SPEC §3 regel 0: het
 * excl.-bedrag is een stuurgetal en mag een halve cent afwijken).
 */
export function describeSalePricing(
  listPriceIncl: number,
  paidPriceIncl: number,
  vatRate: number,
  quantity: number,
): SalePricing {
  const listPriceExcl = priceExclVat(listPriceIncl, vatRate);
  const paidPriceExcl = priceExclVat(paidPriceIncl, vatRate);
  const discountPerUnitIncl = calcDiscountAmount(listPriceIncl, paidPriceIncl);
  const lineTotalListIncl = calcLineTotal(listPriceIncl, quantity);
  const lineTotalListExcl = calcLineTotal(listPriceExcl, quantity);
  const lineTotalPaidIncl = calcLineTotal(paidPriceIncl, quantity);
  const lineTotalPaidExcl = calcLineTotal(paidPriceExcl, quantity);

  return {
    vatRate,
    quantity,
    listPriceIncl,
    listPriceExcl,
    paidPriceIncl,
    paidPriceExcl,
    discountPerUnitIncl,
    discountPct: calcDiscountPct(listPriceIncl, paidPriceIncl),
    hasDiscount: discountPerUnitIncl > 0,
    isSurcharge: discountPerUnitIncl < 0,
    lineTotalListIncl,
    lineTotalListExcl,
    lineTotalPaidIncl,
    lineTotalPaidExcl,
    // Uit de REGELTOTALEN, niet `quantity × korting per stuk`: zo telt het
    // kortingstotaal per constructie op tot het verschil tussen de twee totalen die
    // ernaast op het scherm staan.
    discountTotalIncl: calcDiscountAmount(lineTotalListIncl, lineTotalPaidIncl),
    discountTotalExcl: calcDiscountAmount(lineTotalListExcl, lineTotalPaidExcl),
  };
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
