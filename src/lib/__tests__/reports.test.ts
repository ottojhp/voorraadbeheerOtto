/**
 * Tests voor de rapportage-bouwstenen (SPEC §F6, taak T15):
 *
 * - `@/lib/reporting-period`: periodeafbakening per preset, dag-grenzen,
 *   tijdzoneconversie (zomer-/wintertijd), eigen datumbereik en terugval bij
 *   ongeldige invoer.
 * - `@/lib/csv`: quoting, decimaalkomma, BOM.
 * - `@/lib/queries/reports`: margeberekening uit de (al historische) rij-waarden,
 *   omzet 0 → margepercentage 0 zonder NaN, en dat filterwaarden als
 *   queryparameter meegaan (nooit als tekst in de SQL zelf, ter voorkoming van
 *   SQL-injectie).
 *
 * Er is in deze omgeving geen database; `@/lib/queries/reports` wordt getest tegen
 * een gemockte Prisma-client (`vi.mock("@/lib/db")`), net als
 * `src/lib/__tests__/sales.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";

import {
  buildCsv,
  contentDispositionAttachment,
  csvField,
  csvFilename,
  csvNumber,
  CSV_BOM,
} from "@/lib/csv";
import {
  DEFAULT_PRESET,
  addCalendarDays,
  enumerateDayBuckets,
  enumerateWeekBuckets,
  endOfAmsterdamDayUtc,
  resolveReportingPeriod,
  startOfAmsterdamDayUtc,
} from "@/lib/reporting-period";
import {
  getBestsellers,
  getChannelBreakdown,
  getReportSummary,
  getRevenueByBrand,
  summaryRowToDto,
} from "@/lib/queries/reports";

// ---------------------------------------------------------------------------
// Gemockte Prisma-client, voor de tests tegen @/lib/queries/reports hieronder.
// `vi.mock` wordt door Vitest naar de top van het bestand gehesen, vóór alle
// imports hierboven — hetzelfde patroon als `src/lib/__tests__/sales.test.ts`.
// ---------------------------------------------------------------------------

const { prismaMock } = vi.hoisted(() => {
  const prismaMock = {
    $queryRaw: vi.fn(),
    part: { aggregate: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    sale: { findMany: vi.fn() },
  };
  return { prismaMock };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock, default: prismaMock }));

// ---------------------------------------------------------------------------
// reporting-period.ts — tijdzoneconversie
// ---------------------------------------------------------------------------

describe("startOfAmsterdamDayUtc / endOfAmsterdamDayUtc", () => {
  it("rekent lokale middernacht om naar UTC in de zomer (CEST, UTC+2)", () => {
    const start = startOfAmsterdamDayUtc({ year: 2026, month: 7, day: 1 });
    expect(start.toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });

  it("rekent lokale middernacht om naar UTC in de winter (CET, UTC+1)", () => {
    const start = startOfAmsterdamDayUtc({ year: 2026, month: 1, day: 15 });
    expect(start.toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("het einde van de dag is 23:59:59.999 lokale tijd, omgerekend naar UTC", () => {
    const end = endOfAmsterdamDayUtc({ year: 2026, month: 7, day: 1 });
    expect(end.toISOString()).toBe("2026-07-01T21:59:59.999Z");
  });

  it("een verkoop om 23:59:59.999 lokale tijd valt nog wél binnen de dag, 00:00:00.000 de volgende dag niet meer", () => {
    const end = endOfAmsterdamDayUtc({ year: 2026, month: 9, day: 22 });
    const nextDayStart = startOfAmsterdamDayUtc({ year: 2026, month: 9, day: 23 });
    expect(end.getTime()).toBeLessThan(nextDayStart.getTime());
    expect(nextDayStart.getTime() - end.getTime()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resolveReportingPeriod — presets en dag-grenzen
// ---------------------------------------------------------------------------

describe("resolveReportingPeriod — presets", () => {
  // Dinsdag 22 september 2026, 16:00 Amsterdamse tijd (14:00 UTC, nog zomertijd) —
  // dus een verkoop "vandaag om 16:00" zoals de opdracht als voorbeeld noemt.
  const now = new Date("2026-09-22T14:00:00.000Z");
  const today = { year: 2026, month: 9, day: 22 };

  it("7d: van 6 dagen terug tot en met vandaag", () => {
    const period = resolveReportingPeriod({ preset: "7d", now });
    expect(period.preset).toBe("7d");
    expect(period.warning).toBeNull();
    expect(period.from.getTime()).toBe(
      startOfAmsterdamDayUtc(addCalendarDays(today, -6)).getTime(),
    );
    expect(period.to.getTime()).toBe(endOfAmsterdamDayUtc(today).getTime());
  });

  it("30d: van 29 dagen terug tot en met vandaag", () => {
    const period = resolveReportingPeriod({ preset: "30d", now });
    expect(period.from.getTime()).toBe(
      startOfAmsterdamDayUtc(addCalendarDays(today, -29)).getTime(),
    );
    expect(period.to.getTime()).toBe(endOfAmsterdamDayUtc(today).getTime());
  });

  it("90d: van 89 dagen terug tot en met vandaag", () => {
    const period = resolveReportingPeriod({ preset: "90d", now });
    expect(period.from.getTime()).toBe(
      startOfAmsterdamDayUtc(addCalendarDays(today, -89)).getTime(),
    );
  });

  it("ytd: van 1 januari van dit jaar tot en met vandaag", () => {
    const period = resolveReportingPeriod({ preset: "ytd", now });
    expect(period.from.getTime()).toBe(
      startOfAmsterdamDayUtc({ year: 2026, month: 1, day: 1 }).getTime(),
    );
    expect(period.to.getTime()).toBe(endOfAmsterdamDayUtc(today).getTime());
  });

  it("geen preset opgegeven valt terug op de standaardperiode zonder waarschuwing", () => {
    const period = resolveReportingPeriod({ now });
    expect(period.preset).toBe(DEFAULT_PRESET);
    expect(period.warning).toBeNull();
  });
});

describe("resolveReportingPeriod — eigen datumbereik", () => {
  it("geldig van/tot geeft precies die grenzen", () => {
    const period = resolveReportingPeriod({ preset: "custom", from: "2026-01-01", to: "2026-01-31" });
    expect(period.preset).toBe("custom");
    expect(period.warning).toBeNull();
    expect(period.from.getTime()).toBe(
      startOfAmsterdamDayUtc({ year: 2026, month: 1, day: 1 }).getTime(),
    );
    expect(period.to.getTime()).toBe(
      endOfAmsterdamDayUtc({ year: 2026, month: 1, day: 31 }).getTime(),
    );
  });

  it("van en tot dezelfde dag geeft een geldige periode van precies die dag", () => {
    const period = resolveReportingPeriod({ preset: "custom", from: "2026-03-10", to: "2026-03-10" });
    expect(period.warning).toBeNull();
    expect(period.from.getTime()).toBeLessThan(period.to.getTime());
  });
});

describe("resolveReportingPeriod — ongeldige invoer", () => {
  const now = new Date("2026-09-22T14:00:00.000Z");

  it("onbekende preset valt terug op de standaardperiode met een melding", () => {
    const period = resolveReportingPeriod({ preset: "onzin", now });
    expect(period.preset).toBe(DEFAULT_PRESET);
    expect(period.warning).toContain("onzin");
  });

  it("custom zonder van/tot valt terug op de standaardperiode met een melding", () => {
    const period = resolveReportingPeriod({ preset: "custom", now });
    expect(period.preset).toBe(DEFAULT_PRESET);
    expect(period.warning).not.toBeNull();
  });

  it("custom met een niet-bestaande datum (30 februari) valt terug met een melding", () => {
    const period = resolveReportingPeriod({
      preset: "custom",
      from: "2026-02-30",
      to: "2026-03-01",
      now,
    });
    expect(period.preset).toBe(DEFAULT_PRESET);
    expect(period.warning).not.toBeNull();
  });

  it("custom met tot vóór van valt terug met een melding", () => {
    const period = resolveReportingPeriod({
      preset: "custom",
      from: "2026-03-10",
      to: "2026-03-01",
      now,
    });
    expect(period.preset).toBe(DEFAULT_PRESET);
    expect(period.warning).toContain("vóór");
  });
});

// ---------------------------------------------------------------------------
// enumerateDayBuckets / enumerateWeekBuckets
// ---------------------------------------------------------------------------

describe("enumerateDayBuckets / enumerateWeekBuckets", () => {
  it("geeft elke kalenderdag tussen from en to, inclusief beide grenzen", () => {
    const from = startOfAmsterdamDayUtc({ year: 2026, month: 9, day: 20 });
    const to = endOfAmsterdamDayUtc({ year: 2026, month: 9, day: 22 });
    expect(enumerateDayBuckets(from, to)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
  });

  it("geeft elke ISO-weekmaandag tussen from en to", () => {
    // Maandag 14 t/m zondag 27 september 2026 beslaat twee ISO-weken.
    const from = startOfAmsterdamDayUtc({ year: 2026, month: 9, day: 14 });
    const to = endOfAmsterdamDayUtc({ year: 2026, month: 9, day: 27 });
    expect(enumerateWeekBuckets(from, to)).toEqual(["2026-09-14", "2026-09-21"]);
  });
});

// ---------------------------------------------------------------------------
// csv.ts
// ---------------------------------------------------------------------------

describe("csvField", () => {
  it("laat een gewone waarde ongewijzigd", () => {
    expect(csvField("Remblokken")).toBe("Remblokken");
  });

  it("quote een waarde met het scheidingsteken (;)", () => {
    expect(csvField("Vespa; Sprint")).toBe('"Vespa; Sprint"');
  });

  it("quote en verdubbelt aanhalingstekens", () => {
    expect(csvField('24" velg')).toBe('"24"" velg"');
  });

  it("quote een waarde met een regeleinde", () => {
    expect(csvField("regel1\nregel2")).toBe('"regel1\nregel2"');
  });
});

describe("csvNumber", () => {
  it("gebruikt een komma als decimaalteken met 2 decimalen", () => {
    expect(csvNumber(1234.5)).toBe("1234,50");
  });

  it("werkt voor negatieve bedragen", () => {
    expect(csvNumber(-12.3)).toBe("-12,30");
  });

  it("valt terug op 0,00 bij NaN in plaats van de tekst 'NaN' te schrijven", () => {
    expect(csvNumber(Number.NaN)).toBe("0,00");
  });
});

describe("buildCsv", () => {
  it("begint met een UTF-8 BOM", () => {
    const csv = buildCsv(["Kolom"], [["waarde"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
  });

  it("scheidt kolommen met puntkomma en rijen met CRLF", () => {
    const csv = buildCsv(["Naam", "Omzet"], [["Filter", 12.5]]);
    expect(csv).toBe(`${CSV_BOM}Naam;Omzet\r\nFilter;12,50\r\n`);
  });

  it("quote een cel die het scheidingsteken bevat", () => {
    const csv = buildCsv(["Naam"], [["Vespa; Sprint"]]);
    expect(csv).toContain('"Vespa; Sprint"');
  });
});

describe("csvFilename / contentDispositionAttachment", () => {
  it("bevat de periode in de bestandsnaam", () => {
    expect(csvFilename("bestsellers", "2026-09-01", "2026-09-22")).toBe(
      "bestsellers_2026-09-01_2026-09-22.csv",
    );
  });

  it("zet de bestandsnaam correct in de Content-Disposition-header", () => {
    const header = contentDispositionAttachment("bestsellers_2026-09-01_2026-09-22.csv");
    expect(header).toContain('filename="bestsellers_2026-09-01_2026-09-22.csv"');
    expect(header).toContain("attachment");
  });
});

// ---------------------------------------------------------------------------
// @/lib/queries/reports — summaryRowToDto (pure DTO-mapping)
// ---------------------------------------------------------------------------

describe("summaryRowToDto", () => {
  it("berekent margepercentage uit omzet en marge (Postgres numeric komt als string/bigint binnen)", () => {
    const dto = summaryRowToDto({
      revenue: "200.00",
      margin: "50.00",
      itemsSold: "10",
      transactionCount: BigInt(4),
    });
    expect(dto.revenue).toBe(200);
    expect(dto.margin).toBe(50);
    expect(dto.marginPct).toBe(25);
    expect(dto.itemsSold).toBe(10);
    expect(dto.transactionCount).toBe(4);
  });

  it("geeft margepercentage 0 bij omzet 0, nooit NaN", () => {
    const dto = summaryRowToDto({ revenue: 0, margin: 0, itemsSold: 0, transactionCount: 0 });
    expect(dto.marginPct).toBe(0);
    expect(Number.isNaN(dto.marginPct)).toBe(false);
  });

  it("valt terug op nullen bij een ontbrekende rij (lege periode)", () => {
    const dto = summaryRowToDto(undefined);
    expect(dto).toEqual({
      revenue: 0,
      revenueIncl: 0,
      margin: 0,
      marginPct: 0,
      itemsSold: 0,
      transactionCount: 0,
      // T26: ook de kortingstotalen vallen terug op 0 en nooit op NaN.
      discountTotalIncl: 0,
      discountTotalExcl: 0,
    });
  });

  it("neemt de bruto-omzet incl. btw over zonder er marge mee te berekenen (T18)", () => {
    // 121,00 incl. btw bij 21% is 100,00 excl. De marge en het margepercentage
    // MOETEN op de excl.-omzet gebaseerd blijven: zou `revenueIncl` meegerekend
    // worden, dan kwam het percentage op 24,8% uit in plaats van 30%.
    const dto = summaryRowToDto({
      revenue: "100.00",
      revenueIncl: "121.00",
      margin: "30.00",
      itemsSold: "4",
      transactionCount: BigInt(2),
    });
    expect(dto.revenue).toBe(100);
    expect(dto.revenueIncl).toBe(121);
    expect(dto.margin).toBe(30);
    expect(dto.marginPct).toBe(30);
  });

  it("geeft bruto-omzet 0 als de incl.-kolom ontbreekt, nooit NaN", () => {
    const dto = summaryRowToDto({
      revenue: "100.00",
      margin: "30.00",
      itemsSold: "4",
      transactionCount: BigInt(2),
    });
    expect(dto.revenueIncl).toBe(0);
    expect(Number.isNaN(dto.revenueIncl)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// @/lib/queries/reports — tegen de gemockte Prisma-client
// ---------------------------------------------------------------------------

describe("getReportSummary (gemockt)", () => {
  it("geeft filterwaarden als queryparameter mee, nooit als tekst in de SQL zelf", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      {
        revenue: "300.00",
        revenueIncl: "363.00",
        margin: "75.00",
        itemsSold: "6",
        transactionCount: BigInt(3),
        discountTotalIncl: "12.10",
        discountTotalExcl: "10.00",
      },
    ]);

    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-09-30T23:59:59.999Z");

    const dto = await getReportSummary({ from, to, channel: "COUNTER", category: "HELMET" });

    expect(dto).toEqual({
      revenue: 300,
      revenueIncl: 363,
      margin: 75,
      marginPct: 25,
      itemsSold: 6,
      transactionCount: 3,
      // T26: de kortingstotalen komen één-op-één uit de query mee; er wordt niets
      // van afgeleid en de omzet wordt er niet mee gecorrigeerd (die is al de
      // BETAALDE omzet).
      discountTotalIncl: 12.1,
      discountTotalExcl: 10,
    });

    // `$queryRaw` is aangeroepen als tagged template: (strings, ...values). De
    // enige interpolatie in de buitenste template is `${where}` — een
    // `Prisma.Sql`-object dat `buildWhereSql` opbouwde met `Prisma.sql`/`Prisma.join`.
    // Dát object draagt zijn eigen `strings`/`values`: de filterwaarden moeten daar
    // in `values` staan (gebonden parameters), en NOOIT letterlijk in een van de
    // SQL-tekstfragmenten (dat zou betekenen dat ze in de queryTEKST zelf zijn
    // geplakt, oftewel string-interpolatie — precies wat SQL-injectie mogelijk zou
    // maken).
    type SqlFragment = { strings: string[]; values: unknown[] };

    const [outerStrings, ...interpolated] = prismaMock.$queryRaw.mock
      .calls[0] as [TemplateStringsArray, ...SqlFragment[]];

    // Sinds datamodel v2 interpoleert de query meerdere `Prisma.Sql`-fragmenten: het
    // afgeleide excl.-bedrag (twee keer) en als laatste de WHERE-clause. De
    // WHERE-clause is dus het LAATSTE fragment, niet meer het eerste.
    const where = interpolated[interpolated.length - 1];

    // De volledige SQL-tekst: het buitenste template plus de tekstfragmenten van
    // alles wat erin geïnterpoleerd is. Filterwaarden mogen in geen van deze
    // fragmenten voorkomen — staan ze er wel in, dan zijn ze in de queryTEKST
    // geplakt in plaats van als gebonden parameter meegegeven (SQL-injectie).
    const allSqlText = [
      outerStrings.join(""),
      ...interpolated.map((fragment) => fragment.strings.join("")),
    ].join("");

    // Omzet en marge rekenen op EXCL.-basis: de historisch vastgelegde incl.-prijs
    // wordt in SQL teruggerekend met het btw-tarief van dat moment (SPEC §3 regel 0).
    expect(allSqlText).toContain(
      'ROUND(s."salePriceInclAtSale" / (1 + s."vatRateAtSale" / 100), 2)',
    );
    expect(allSqlText).toContain('s."purchasePriceExclAtSale"');
    // De oude, incl.-vergelijking mag niet meer voorkomen: die zou de marge met de
    // btw erin berekenen.
    expect(allSqlText).not.toContain('s."salePriceInclAtSale" - ');

    // De bruto-omzet incl. btw (T18) wordt rechtstreeks uit de opgeslagen
    // incl.-prijs gesommeerd — niet teruggerekend en weer omhoog gerekend, want dan
    // zou er een afrondingscent in sluipen in een bedrag dat werkelijk betaald is.
    expect(allSqlText).toContain(
      'SUM(s.quantity * s."salePriceInclAtSale"), 0) AS "revenueIncl"',
    );

    expect(allSqlText).not.toContain("COUNTER");
    expect(allSqlText).not.toContain("HELMET");
    expect(where.values).toContain("COUNTER");
    expect(where.values).toContain("HELMET");
    expect(where.values).toContain(from);
    expect(where.values).toContain(to);
  });
});

describe("korting in de rapportages (T26)", () => {
  type SqlFragment = { strings: string[]; values: unknown[] };

  function isSqlFragment(value: unknown): value is SqlFragment {
    return (
      typeof value === "object" &&
      value !== null &&
      Array.isArray((value as SqlFragment).strings)
    );
  }

  /**
   * Bouwt de SQL van een `$queryRaw`-aanroep weer op zoals Postgres hem te zien
   * krijgt: de tekstfragmenten mét de geïnterpoleerde `Prisma.Sql`-stukken op hun
   * eigen plek, en elke gebonden parameter als `?`.
   *
   * Nodig omdat `strings.join("")` van alleen het buitenste template de ingevoegde
   * expressies WEGLAAT — dan lijkt `SUM(s.quantity * )` in de tekst te staan en kan
   * er niet op gecontroleerd worden welke prijs er gesommeerd wordt. Juist dát is
   * hier de vraag: betaalde prijs of normale prijs.
   */
  function renderSql(strings: readonly string[], values: unknown[]): string {
    return strings
      .map((text, index) => {
        if (index >= values.length) {
          return text;
        }
        const value = values[index];
        return (
          text +
          (isSqlFragment(value)
            ? renderSql(value.strings, value.values)
            : "?")
        );
      })
      .join("");
  }

  /** De volledige SQL-tekst van de LAATSTE `$queryRaw`-aanroep. */
  function lastSqlText(): string {
    const call = prismaMock.$queryRaw.mock.calls.at(-1) as
      | [TemplateStringsArray, ...unknown[]]
      | undefined;
    expect(call).toBeDefined();
    const [strings, ...values] = call!;
    return renderSql(strings, values);
  }

  const from = new Date("2026-09-01T00:00:00.000Z");
  const to = new Date("2026-09-30T23:59:59.999Z");

  it("rekent omzet en marge met de BETAALDE prijs, niet met de normale prijs", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    await getReportSummary({ from, to });

    const sql = lastSqlText();

    // Omzet incl., omzet excl. en de marge staan allemaal op `salePriceInclAtSale`,
    // en dat veld is sinds T26 de WERKELIJK BETAALDE prijs. Een korting verlaagt dus
    // de omzet en de marge, zoals het hoort.
    expect(sql).toContain(
      'SUM(s.quantity * s."salePriceInclAtSale"), 0) AS "revenueIncl"',
    );
    expect(sql).toContain(
      'SUM(s.quantity * ROUND(s."salePriceInclAtSale" / (1 + s."vatRateAtSale" / 100), 2)), 0) AS "revenue"',
    );
    expect(sql).toContain(
      'SUM(s.quantity * (ROUND(s."salePriceInclAtSale" / (1 + s."vatRateAtSale" / 100), 2) - s."purchasePriceExclAtSale")), 0) AS "margin"',
    );

    // De normale prijs komt in de omzet- en margekolommen NIET voor. Dit is de
    // assertie die zou breken als iemand de rapportage ooit op de normale prijs laat
    // rekenen: dan zou een korting onzichtbaar blijven in de omzet.
    const omzetEnMarge = sql.slice(0, sql.indexOf('AS "discountTotalIncl"'));
    expect(omzetEnMarge).toContain('"salePriceInclAtSale"');
    expect(
      omzetEnMarge.slice(0, omzetEnMarge.indexOf('AS "transactionCount"')),
    ).not.toContain('"listPriceInclAtSale"');
  });

  it("berekent de gegeven korting als Σ aantal × (normaal − betaald)", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    await getReportSummary({ from, to });

    const sql = lastSqlText();

    // Incl. btw: een exacte som van twee opgeslagen bedragen.
    expect(sql).toContain(
      'SUM(s.quantity * (s."listPriceInclAtSale" - s."salePriceInclAtSale")), 0) AS "discountTotalIncl"',
    );
    // Excl. btw: elke prijs APART teruggerekend en dan afgetrokken, met hetzelfde
    // ROUND als de omzet — anders telt de korting excl. niet op tot het verschil
    // tussen de omzet met en zonder korting.
    expect(sql).toContain(
      'SUM(s.quantity * (ROUND(s."listPriceInclAtSale" / (1 + s."vatRateAtSale" / 100), 2) - ROUND(s."salePriceInclAtSale" / (1 + s."vatRateAtSale" / 100), 2))), 0) AS "discountTotalExcl"',
    );
  });

  it("laat de bestsellers volledig op de betaalde prijs rekenen", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    await getBestsellers({ from, to });

    const sql = lastSqlText();
    expect(sql).toContain('s."salePriceInclAtSale"');
    // Geen enkele verwijzing naar de normale prijs: stuks, omzet en marge per
    // onderdeel gaan over wat er werkelijk binnenkwam.
    expect(sql).not.toContain('"listPriceInclAtSale"');
  });

  it("geeft de korting ook per kanaal mee, uit dezelfde expressie", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      {
        channel: "COUNTER",
        revenue: "300.00",
        revenueIncl: "363.00",
        margin: "75.00",
        itemsSold: "6",
        transactionCount: BigInt(3),
        discountTotalIncl: "12.10",
        discountTotalExcl: "10.00",
      },
    ]);

    const rows = await getChannelBreakdown({ from, to });
    const counter = rows.find((row) => row.channel === "COUNTER");
    const workshop = rows.find((row) => row.channel === "WORKSHOP");

    expect(counter?.discountTotalIncl).toBe(12.1);
    expect(counter?.discountTotalExcl).toBe(10);
    // Een kanaal zonder verkopen in de periode komt er met nullen bij, niet met NaN.
    expect(workshop?.discountTotalIncl).toBe(0);
  });
});

describe("getBestsellers (gemockt)", () => {
  it("markeert een gearchiveerd onderdeel en zet de rauwe getallen om naar number", async () => {
    const archivedAt = new Date("2026-05-01T00:00:00.000Z");
    prismaMock.$queryRaw.mockResolvedValueOnce([
      {
        partId: "part-1",
        name: "Remblok voor",
        sku: "RB-001",
        brandName: "Vespa",
        archivedAt,
        quantitySold: "12",
        revenue: "180.00",
        margin: "60.00",
      },
    ]);

    const rows = await getBestsellers({
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-30T23:59:59.999Z"),
    });

    expect(rows).toEqual([
      {
        partId: "part-1",
        name: "Remblok voor",
        sku: "RB-001",
        brandName: "Vespa",
        isArchived: true,
        quantitySold: 12,
        revenue: 180,
        margin: 60,
      },
    ]);
  });
});

describe("getRevenueByBrand (gemockt)", () => {
  it("labelt een ontbrekend merk als 'Zonder merk'", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { brandId: null, brandName: null, revenue: "40.00", margin: "10.00", itemsSold: "2" },
    ]);

    const rows = await getRevenueByBrand({
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-30T23:59:59.999Z"),
    });

    expect(rows).toEqual([
      { brandId: null, brandName: "Zonder merk", revenue: 40, margin: 10, itemsSold: 2 },
    ]);
  });
});
