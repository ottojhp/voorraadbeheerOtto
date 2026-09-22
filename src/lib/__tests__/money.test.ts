import { describe, expect, it } from "vitest";
import {
  calcMargin,
  calcMarginPct,
  formatEuro,
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
