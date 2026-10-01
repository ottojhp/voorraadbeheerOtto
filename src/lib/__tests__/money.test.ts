import { describe, expect, it } from "vitest";
import {
  applyDiscountAmount,
  applyDiscountPct,
  calcDiscountAmount,
  calcDiscountPct,
  calcLineTotal,
  calcMargin,
  calcMarginPct,
  describeSalePricing,
  formatEuro,
  formatPercent,
  priceExclVat,
  priceWithVat,
  readMoneyInput,
  toMoneyInput,
} from "@/lib/money";

describe("formatEuro", () => {
  it("formatteert een bedrag als Nederlandse euronotatie", () => {
    // Intl gebruikt non-breaking spaces tussen symbool en bedrag.
    expect(formatEuro(19.5)).toBe("€ 19,50");
  });

  it("formatteert 0 correct", () => {
    expect(formatEuro(0)).toBe("€ 0,00");
  });

  it("formatteert negatieve bedragen correct", () => {
    expect(formatEuro(-5)).toBe("€ -5,00");
  });

  it("rondt af op 2 decimalen bij weergave", () => {
    expect(formatEuro(19.995)).toBe("€ 20,00");
  });
});

describe("calcMargin", () => {
  it("berekent de marge in euro's", () => {
    expect(calcMargin(10, 15)).toBe(5);
  });

  it("geeft een negatieve marge als inkoop hoger is dan verkoop", () => {
    expect(calcMargin(20, 15)).toBe(-5);
  });

  it("geeft 0 marge bij gelijke prijzen", () => {
    expect(calcMargin(10, 10)).toBe(0);
  });

  it("rondt af op 2 decimalen", () => {
    expect(calcMargin(10.005, 20)).toBe(9.99);
  });
});

describe("calcMarginPct", () => {
  it("berekent het margepercentage", () => {
    expect(calcMarginPct(10, 20)).toBe(50);
  });

  it("geeft 0% en geen NaN/Infinity als de verkoopprijs 0 is", () => {
    const pct = calcMarginPct(10, 0);
    expect(pct).toBe(0);
    expect(Number.isNaN(pct)).toBe(false);
    expect(Number.isFinite(pct)).toBe(true);
  });

  it("geeft 0% bij verkoopprijs 0 en inkoop 0", () => {
    expect(calcMarginPct(0, 0)).toBe(0);
  });

  it("geeft een negatief percentage als inkoop hoger is dan verkoop", () => {
    expect(calcMarginPct(20, 10)).toBe(-100);
  });

  it("rondt af op 2 decimalen (bv. 19.995 scenario)", () => {
    // (19.995 - 10) / 19.995 * 100 = 49.9875 -> 49.99
    expect(calcMarginPct(10, 19.995)).toBe(49.99);
  });
});

describe("priceWithVat", () => {
  it("berekent de prijs inclusief 21% btw", () => {
    expect(priceWithVat(10, 21)).toBe(12.1);
  });

  it("berekent de prijs inclusief 9% btw", () => {
    expect(priceWithVat(10, 9)).toBe(10.9);
  });

  it("rondt correct af op 2 decimalen", () => {
    expect(priceWithVat(19.995, 21)).toBe(24.19);
  });

  it("geeft dezelfde prijs terug bij 0% btw", () => {
    expect(priceWithVat(15, 0)).toBe(15);
  });
});

describe("priceExclVat", () => {
  it("rekent een prijs incl. 21% btw terug naar excl. btw", () => {
    // 12,10 / 1,21 = 10,00
    expect(priceExclVat(12.1, 21)).toBe(10);
  });

  it("rekent een prijs incl. 9% btw terug naar excl. btw", () => {
    expect(priceExclVat(10.9, 9)).toBe(10);
  });

  it("geeft dezelfde prijs terug bij 0% btw", () => {
    expect(priceExclVat(15, 0)).toBe(15);
  });

  it("rondt af op 2 decimalen", () => {
    // 30,19 / 1,21 = 24,95041... → 24,95
    expect(priceExclVat(30.19, 21)).toBe(24.95);
  });

  it("is de reden waarom de verkoopprijs incl. btw wordt opgeslagen", () => {
    // Dit is het voorbeeld uit SPEC §3 regel 0. Een bedrag van €10,00 incl. btw kan
    // niet exact als excl.-bedrag in twee decimalen bewaard worden: het wordt
    // 8,264462... → 8,26, en dat is terug maar €9,99. Sla je het incl.-bedrag op,
    // dan blijft de €10,00 exact en wijkt alleen het STUURGETAL een halve cent af.
    const inclOorspronkelijk = 10;
    const exclAfgeleid = priceExclVat(inclOorspronkelijk, 21);
    expect(exclAfgeleid).toBe(8.26);
    expect(priceWithVat(exclAfgeleid, 21)).toBe(9.99);
    expect(priceWithVat(exclAfgeleid, 21)).not.toBe(inclOorspronkelijk);
  });

  it("bewaart bedragen die de oude aanpak een cent kostten exact", () => {
    // De drie bedragen uit T18: opgeslagen als incl. blijven ze exact, en de
    // afgeleide excl.-waarde is een stuurgetal dat terug binnen een cent ligt.
    for (const incl of [10, 19.99, 24.95]) {
      const excl = priceExclVat(incl, 21);
      expect(Math.abs(priceWithVat(excl, 21) - incl)).toBeLessThanOrEqual(0.01);
    }
  });

  it("valt niet om op Infinity bij een btw-tarief van -100%", () => {
    // Kan niet voorkomen (de database eist vatRate >= 0), maar "€ Infinity" op het
    // scherm is een slechtere uitkomst dan het incl.-bedrag teruggeven.
    expect(Number.isFinite(priceExclVat(10, -100))).toBe(true);
    expect(priceExclVat(10, -100)).toBe(10);
  });
});

describe("calcLineTotal", () => {
  it("vermenigvuldigt de prijs per stuk met het aantal", () => {
    expect(calcLineTotal(24.95, 2)).toBe(49.9);
  });

  it("rondt de floating-point ruis van een prijs in centen weg", () => {
    // 20,65 × 3 is in binaire floating point 61.949999999999996 en 19,99 × 7 is
    // 139.92999999999998; zonder afronden gaan zulke getallen in een optelling van
    // meerdere regels schuiven.
    expect(20.65 * 3).not.toBe(61.95);
    expect(calcLineTotal(20.65, 3)).toBe(61.95);
    expect(19.99 * 7).not.toBe(139.93);
    expect(calcLineTotal(19.99, 7)).toBe(139.93);
  });

  it("geeft 0 bij aantal 0", () => {
    expect(calcLineTotal(19.99, 0)).toBe(0);
  });

  it("werkt even goed voor incl.- als voor excl.-bedragen", () => {
    // Dezelfde regel, twee keer: wat je erin stopt bepaalt wat eruit komt.
    const incl = 19.99;
    const excl = priceExclVat(incl, 21);
    expect(calcLineTotal(incl, 3)).toBe(59.97);
    expect(calcLineTotal(excl, 3)).toBe(49.56);
  });
});

// ---------------------------------------------------------------------------
// Korting (T26)
// ---------------------------------------------------------------------------

describe("formatPercent", () => {
  it("formatteert met één decimaal en een Nederlandse komma", () => {
    expect(formatPercent(10)).toBe("10,0%");
    expect(formatPercent(12.5)).toBe("12,5%");
    expect(formatPercent(0)).toBe("0,0%");
  });

  it("rondt af op één decimaal", () => {
    expect(formatPercent(10.003)).toBe("10,0%");
    expect(formatPercent(24.95)).toBe("25,0%");
  });
});

describe("toMoneyInput", () => {
  it("geeft altijd twee decimalen met een komma", () => {
    expect(toMoneyInput(30.19)).toBe("30,19");
    expect(toMoneyInput(27)).toBe("27,00");
    expect(toMoneyInput(0)).toBe("0,00");
  });
});

describe("readMoneyInput", () => {
  it("accepteert komma én punt als decimaalteken", () => {
    expect(readMoneyInput("12,50", "De prijs")).toEqual({ ok: true, value: 12.5 });
    expect(readMoneyInput("12.50", "De prijs")).toEqual({ ok: true, value: 12.5 });
    expect(readMoneyInput(" 30,19 ", "De prijs")).toEqual({ ok: true, value: 30.19 });
  });

  it("staat 0 toe: iets weggeven mag", () => {
    expect(readMoneyInput("0", "De prijs")).toEqual({ ok: true, value: 0 });
    expect(readMoneyInput("0,00", "De prijs")).toEqual({ ok: true, value: 0 });
  });

  it("weigert een negatief bedrag met een melding die dát zegt", () => {
    const result = readMoneyInput("-5", "De prijs");
    expect(result.ok).toBe(false);
    // Niet "moet een getal zijn": de gebruiker typte een geldig getal, het mag
    // alleen niet negatief zijn.
    expect(result.ok === false && result.error).toBe(
      "De prijs mag niet negatief zijn",
    );
  });

  it("weigert meer dan twee decimalen en onzin", () => {
    expect(readMoneyInput("12,505", "De prijs").ok).toBe(false);
    expect(readMoneyInput("abc", "De prijs").ok).toBe(false);
    expect(readMoneyInput("", "De prijs").ok).toBe(false);
  });

  it("zet het meegegeven label vooraan in elke melding", () => {
    const result = readMoneyInput("abc", "Het kortingsbedrag");
    expect(result.ok === false && result.error).toContain("Het kortingsbedrag");
  });
});

describe("applyDiscountPct", () => {
  it("rondt de nieuwe prijs af op centen", () => {
    // 10% van 30,19 is 27,171 — daar kan niemand mee afrekenen.
    expect(applyDiscountPct(30.19, 10)).toBe(27.17);
    expect(applyDiscountPct(30.19, 5)).toBe(28.68);
    expect(applyDiscountPct(30.19, 15)).toBe(25.66);
  });

  it("laat de prijs ongemoeid bij 0%", () => {
    expect(applyDiscountPct(30.19, 0)).toBe(30.19);
  });

  it("kapt af op 0 in plaats van een negatieve prijs te geven", () => {
    expect(applyDiscountPct(30.19, 100)).toBe(0);
    expect(applyDiscountPct(30.19, 150)).toBe(0);
  });
});

describe("applyDiscountAmount", () => {
  it("trekt het bedrag af en rondt af op centen", () => {
    expect(applyDiscountAmount(30.19, 5)).toBe(25.19);
    expect(applyDiscountAmount(30.19, 0.1)).toBe(30.09);
  });

  it("kapt af op 0 bij een korting groter dan de prijs", () => {
    expect(applyDiscountAmount(30.19, 40)).toBe(0);
  });
});

describe("calcDiscountAmount en calcDiscountPct", () => {
  it("rekent de korting uit het verschil van de twee prijzen", () => {
    expect(calcDiscountAmount(30.19, 27.17)).toBe(3.02);
    expect(calcDiscountPct(30.19, 27.17)).toBe(10);
  });

  it("is consistent: percentage en bedrag horen bij dezelfde afgeronde prijs", () => {
    // Dit is de kern van de eis in T26. De nieuwe prijs wordt afgerond, en het
    // percentage wordt UIT die afgeronde prijs afgeleid. 3,02 / 30,19 = 10,0033%,
    // dus afgerond op twee decimalen 10. Zou het percentage uit het onafgeronde
    // bedrag komen, dan stond er 10,00% naast een bedrag van 3,019.
    const nieuw = applyDiscountPct(30.19, 10);
    const bedrag = calcDiscountAmount(30.19, nieuw);
    const pct = calcDiscountPct(30.19, nieuw);
    expect(nieuw).toBe(27.17);
    expect(bedrag).toBe(3.02);
    expect(formatPercent(pct)).toBe("10,0%");
    // En het bedrag is exact het verschil dat op het scherm staat.
    expect(Number((30.19 - nieuw).toFixed(2))).toBe(bedrag);
  });

  it("geeft een negatief bedrag als er méér dan normaal betaald is", () => {
    expect(calcDiscountAmount(30.19, 35)).toBe(-4.81);
    expect(calcDiscountPct(30.19, 35)).toBeLessThan(0);
  });

  it("geeft 0% bij een normale prijs van 0 in plaats van NaN", () => {
    expect(calcDiscountPct(0, 0)).toBe(0);
    expect(Number.isNaN(calcDiscountPct(0, 0))).toBe(false);
  });
});

describe("describeSalePricing", () => {
  it("rekent een regel met 10% korting volledig door", () => {
    const pricing = describeSalePricing(30.19, 27.17, 21, 2);

    expect(pricing).toEqual({
      vatRate: 21,
      quantity: 2,
      listPriceIncl: 30.19,
      // 30,19 / 1,21 = 24,9504... → 24,95
      listPriceExcl: 24.95,
      paidPriceIncl: 27.17,
      // 27,17 / 1,21 = 22,4545... → 22,45
      paidPriceExcl: 22.45,
      discountPerUnitIncl: 3.02,
      discountPct: 10,
      hasDiscount: true,
      isSurcharge: false,
      lineTotalListIncl: 60.38,
      lineTotalListExcl: 49.9,
      lineTotalPaidIncl: 54.34,
      lineTotalPaidExcl: 44.9,
      discountTotalIncl: 6.04,
      discountTotalExcl: 5,
    });
  });

  it("meldt geen korting als er niets gegeven is", () => {
    const pricing = describeSalePricing(30.19, 30.19, 21, 3);
    expect(pricing.hasDiscount).toBe(false);
    expect(pricing.isSurcharge).toBe(false);
    expect(pricing.discountPerUnitIncl).toBe(0);
    expect(pricing.discountTotalIncl).toBe(0);
    expect(pricing.discountTotalExcl).toBe(0);
    // Zonder korting is het doorgestreepte totaal gelijk aan het echte totaal.
    expect(pricing.lineTotalListIncl).toBe(pricing.lineTotalPaidIncl);
  });

  it("markeert een prijs boven de normale prijs als toeslag", () => {
    const pricing = describeSalePricing(30.19, 35, 21, 1);
    expect(pricing.hasDiscount).toBe(false);
    expect(pricing.isSurcharge).toBe(true);
    expect(pricing.discountPerUnitIncl).toBe(-4.81);
  });

  it("staat een prijs van 0 toe (weggeven) en geeft dan 100% korting", () => {
    const pricing = describeSalePricing(30.19, 0, 21, 1);
    expect(pricing.paidPriceIncl).toBe(0);
    expect(pricing.paidPriceExcl).toBe(0);
    expect(pricing.discountPct).toBe(100);
    expect(pricing.lineTotalPaidIncl).toBe(0);
    expect(pricing.discountTotalIncl).toBe(30.19);
  });

  it("laat het kortingstotaal optellen tot het verschil van de twee regeltotalen", () => {
    // Niet `aantal × korting per stuk`, maar het verschil tussen de twee totalen die
    // ernaast op het scherm staan — anders klopt de optelling op het scherm niet.
    const pricing = describeSalePricing(19.99, 17.99, 9, 7);
    expect(pricing.discountTotalIncl).toBe(
      calcDiscountAmount(pricing.lineTotalListIncl, pricing.lineTotalPaidIncl),
    );
    expect(pricing.discountTotalExcl).toBe(
      calcDiscountAmount(pricing.lineTotalListExcl, pricing.lineTotalPaidExcl),
    );
  });

  it("rekent de excl.-bedragen met het meegegeven btw-tarief, ook bij 9%", () => {
    const pricing = describeSalePricing(10.9, 9.81, 9, 1);
    // 10,90 / 1,09 = 10,00 exact; 9,81 / 1,09 = 9,00 exact.
    expect(pricing.listPriceExcl).toBe(10);
    expect(pricing.paidPriceExcl).toBe(9);
    expect(pricing.discountTotalExcl).toBe(1);
  });
});
