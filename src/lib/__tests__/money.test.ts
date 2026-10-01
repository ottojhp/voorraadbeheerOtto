import { describe, expect, it } from "vitest";
import {
  calcLineTotal,
  calcMargin,
  calcMarginPct,
  formatEuro,
  priceExclVat,
  priceWithVat,
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
