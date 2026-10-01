/**
 * Tests voor de dashboard-datalaag (`src/lib/queries/dashboard.ts`), SPEC §F1 / T14.
 *
 * Er is in deze omgeving geen database, dus alles draait tegen een gemockte
 * Prisma-client (`vi.mock("@/lib/db")`), net als `sales.test.ts` en
 * `reports.test.ts`. Focus:
 *
 * - De conversie van ruwe `$queryRaw`-waarden (string/Decimal/null/undefined) naar
 *   `number`, inclusief het geval "lege database" → 0, nooit `NaN`.
 * - De lage-voorraadconditie: dashboard en voorraadoverzicht (`@/lib/queries/parts`)
 *   mogen nooit een verschillend aantal tonen, dus we bewijzen dat `dashboard.ts`
 *   exact dezelfde `where` gebruikt als `buildPartWhere({ lowStockOnly: true })`
 *   (die zelf, inclusief het randgeval `minStock = 0`, al in `parts.test.ts` getest
 *   wordt — hier wordt alleen de hergebruik-garantie bewezen, niet de conditie
 *   opnieuw).
 * - De sortering op grootste tekort.
 * - De bestsellerberekening: som per onderdeel, top N, aflopend.
 * - Een volledig lege database levert overal nette nulwaarden/lege lijsten op, nooit
 *   een crash of `NaN`.
 */

import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => {
  // Stand-in voor `prisma.part.fields.minStock`, de field reference die
  // `buildPartWhere({ lowStockOnly: true })` in `@/lib/queries/parts` gebruikt om
  // `stockQuantity` met de kolom `minStock` te vergelijken (zie parts.test.ts). Zonder
  // deze marker zou `buildPartWhere` hier op `undefined` crashen.
  const minStockFieldRef = { __fieldRef: "Part.minStock" };
  const prismaMock = {
    $queryRaw: vi.fn(),
    part: {
      aggregate: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      fields: { minStock: minStockFieldRef },
    },
    sale: { groupBy: vi.fn(), findMany: vi.fn() },
  };
  return { prismaMock };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock, default: prismaMock }));

import { buildPartWhere } from "@/lib/queries/parts";
import {
  getDashboardData,
  getDashboardTotals,
  getStockValue,
  listBestsellers,
  listLowStockParts,
  periodStart,
  rankBestsellers,
  rawNumericToNumber,
  readStockValueRows,
  sortByShortage,
  type BestsellerGroupRow,
} from "@/lib/queries/dashboard";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// rawNumericToNumber
// ---------------------------------------------------------------------------

describe("rawNumericToNumber", () => {
  it("zet null en undefined om naar 0 (lege database: SUM over nul rijen is NULL)", () => {
    expect(rawNumericToNumber(null)).toBe(0);
    expect(rawNumericToNumber(undefined)).toBe(0);
  });

  it("laat een eindig getal ongemoeid", () => {
    expect(rawNumericToNumber(42)).toBe(42);
    expect(rawNumericToNumber(0)).toBe(0);
  });

  it("vangt NaN en Infinity op als 0 in plaats van ze door te laten", () => {
    expect(rawNumericToNumber(NaN)).toBe(0);
    expect(rawNumericToNumber(Infinity)).toBe(0);
  });

  it("parset een numerieke string", () => {
    expect(rawNumericToNumber("1234.50")).toBe(1234.5);
  });

  it("een niet-numerieke string geeft 0, geen NaN", () => {
    expect(rawNumericToNumber("niet een getal")).toBe(0);
  });

  it("zet een bigint om (bv. een COUNT)", () => {
    expect(rawNumericToNumber(BigInt(7))).toBe(7);
  });

  it("gebruikt .toNumber() op een Decimal-achtig object", () => {
    expect(rawNumericToNumber(new Prisma.Decimal("99.99"))).toBe(99.99);
  });
});

// ---------------------------------------------------------------------------
// readStockValueRows
// ---------------------------------------------------------------------------

describe("readStockValueRows", () => {
  it("een lege rijenset (lege database) geeft overal 0, geen NaN", () => {
    expect(readStockValueRows([])).toEqual({
      stockValuePurchaseExcl: 0,
      stockValueSaleExcl: 0,
      stockValueSaleIncl: 0,
    });
  });

  it("leest de eerste rij en converteert alle drie de sommen", () => {
    const result = readStockValueRows([
      {
        purchaseValue: "150.00",
        saleValue: new Prisma.Decimal("299.50"),
        saleValueIncl: new Prisma.Decimal("362.40"),
      },
    ]);
    expect(result).toEqual({
      stockValuePurchaseExcl: 150,
      stockValueSaleExcl: 299.5,
      stockValueSaleIncl: 362.4,
    });
  });

  it("een ontbrekende incl.-som geeft 0, nooit NaN", () => {
    const result = readStockValueRows([
      { purchaseValue: "150.00", saleValue: "299.50" },
    ]);
    expect(result.stockValueSaleIncl) .toBe(0);
    expect(Number.isNaN(result.stockValueSaleIncl)).toBe(false);
  });

  it("een niet-array resultaat geeft ook nette nullen", () => {
    expect(readStockValueRows(undefined)).toEqual({
      stockValuePurchaseExcl: 0,
      stockValueSaleExcl: 0,
      stockValueSaleIncl: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// getStockValue — tegen de gemockte $queryRaw
// ---------------------------------------------------------------------------

describe("getStockValue", () => {
  it("lege database: $queryRaw geeft geen rijen, resultaat is overal 0", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    const result = await getStockValue();
    expect(result).toEqual({
      stockValuePurchaseExcl: 0,
      stockValueSaleExcl: 0,
      stockValueSaleIncl: 0,
    });
  });

  it("converteert het ruwe queryresultaat (string/Decimal) naar number", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      {
        purchaseValue: "1000.00",
        saleValue: new Prisma.Decimal("1999.98"),
        saleValueIncl: new Prisma.Decimal("2419.98"),
      },
    ]);
    const result = await getStockValue();
    expect(result).toEqual({
      stockValuePurchaseExcl: 1000,
      stockValueSaleExcl: 1999.98,
      stockValueSaleIncl: 2419.98,
    });
  });

  it("vraagt de verkoopwaarde zowel incl. als excl. btw op in één query", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    await getStockValue();
    // Prisma tagged template: het eerste argument is de array met SQL-fragmenten.
    const sql = (prismaMock.$queryRaw.mock.calls[0][0] as unknown as string[]).join(
      "?",
    );
    // Het excl.-bedrag wordt teruggerekend, het incl.-bedrag rechtstreeks gesommeerd.
    expect(sql).toContain('ROUND("salePriceIncl" / (1 + "vatRate" / 100), 2)');
    expect(sql).toContain('SUM("stockQuantity" * "salePriceIncl")');
    // De inkoopwaarde blijft excl. btw: geen omrekening op die kolom.
    expect(sql).toContain('SUM("stockQuantity" * "purchasePriceExcl")');
  });
});

// ---------------------------------------------------------------------------
// sortByShortage
// ---------------------------------------------------------------------------

describe("sortByShortage", () => {
  it("sorteert aflopend op grootste tekort (minStock - stockQuantity)", () => {
    const rows = [
      { id: "1", name: "Klein tekort", stockQuantity: 4, minStock: 5 },
      { id: "2", name: "Groot tekort", stockQuantity: 0, minStock: 10 },
      { id: "3", name: "Middelgroot tekort", stockQuantity: 2, minStock: 7 },
    ];
    expect(sortByShortage(rows).map((r) => r.id)).toEqual(["2", "3", "1"]);
  });

  it("bij gelijk tekort: alfabetisch op naam als tiebreaker", () => {
    const rows = [
      { id: "1", name: "Zaagblad", stockQuantity: 0, minStock: 5 },
      { id: "2", name: "Accu", stockQuantity: 0, minStock: 5 },
    ];
    expect(sortByShortage(rows).map((r) => r.name)).toEqual(["Accu", "Zaagblad"]);
  });

  it("muteert de input-array niet", () => {
    const rows = [
      { id: "1", name: "A", stockQuantity: 0, minStock: 1 },
      { id: "2", name: "B", stockQuantity: 0, minStock: 5 },
    ];
    const original = [...rows];
    sortByShortage(rows);
    expect(rows).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// rankBestsellers
// ---------------------------------------------------------------------------

describe("rankBestsellers", () => {
  it("telt rijen met hetzelfde partId op", () => {
    const rows: BestsellerGroupRow[] = [
      { partId: "p1", _sum: { quantity: 3 } },
      { partId: "p1", _sum: { quantity: 2 } },
      { partId: "p2", _sum: { quantity: 1 } },
    ];
    const ranked = rankBestsellers(rows);
    expect(ranked).toEqual([
      { partId: "p1", quantitySold: 5 },
      { partId: "p2", quantitySold: 1 },
    ]);
  });

  it("sorteert aflopend op aantal stuks en snijdt op de limiet af", () => {
    const rows: BestsellerGroupRow[] = [
      { partId: "p1", _sum: { quantity: 1 } },
      { partId: "p2", _sum: { quantity: 5 } },
      { partId: "p3", _sum: { quantity: 3 } },
      { partId: "p4", _sum: { quantity: 9 } },
    ];
    expect(rankBestsellers(rows, 2).map((r) => r.partId)).toEqual(["p4", "p2"]);
  });

  it("een null-som telt als 0, geen NaN", () => {
    const rows: BestsellerGroupRow[] = [{ partId: "p1", _sum: { quantity: null } }];
    expect(rankBestsellers(rows)).toEqual([{ partId: "p1", quantitySold: 0 }]);
  });

  it("lege rijenset geeft een lege lijst", () => {
    expect(rankBestsellers([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getDashboardTotals — consistentie met het voorraadoverzicht
// ---------------------------------------------------------------------------

describe("getDashboardTotals", () => {
  it("lege database geeft overal 0, nooit NaN", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    prismaMock.part.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { stockQuantity: null },
    });
    prismaMock.part.count.mockResolvedValueOnce(0);

    const totals = await getDashboardTotals();

    expect(totals).toEqual({
      stockValuePurchaseExcl: 0,
      stockValueSaleExcl: 0,
      stockValueSaleIncl: 0,
      uniquePartCount: 0,
      totalStockQuantity: 0,
      lowStockCount: 0,
    });
    for (const value of Object.values(totals)) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  it("gebruikt voor de lage-voorraadtelling exact dezelfde where als het voorraadoverzicht", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    prismaMock.part.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { stockQuantity: null },
    });
    prismaMock.part.count.mockResolvedValueOnce(3);

    await getDashboardTotals();

    expect(prismaMock.part.count).toHaveBeenCalledWith({
      where: buildPartWhere({ lowStockOnly: true }),
    });
  });

  it("archivering: aggregate en count worden met archivedAt: null (via de standaard-where) aangeroepen", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    prismaMock.part.aggregate.mockResolvedValueOnce({
      _count: { _all: 2 },
      _sum: { stockQuantity: 10 },
    });
    prismaMock.part.count.mockResolvedValueOnce(1);

    await getDashboardTotals();

    expect(prismaMock.part.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null } }),
    );
  });
});

// ---------------------------------------------------------------------------
// listLowStockParts
// ---------------------------------------------------------------------------

describe("listLowStockParts", () => {
  it("gebruikt dezelfde where als buildPartWhere({ lowStockOnly: true })", async () => {
    prismaMock.part.findMany.mockResolvedValueOnce([]);
    await listLowStockParts();
    expect(prismaMock.part.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: buildPartWhere({ lowStockOnly: true }) }),
    );
  });

  it("sorteert op grootste tekort en mapt leverancier/merk naar null als die ontbreken", async () => {
    prismaMock.part.findMany.mockResolvedValueOnce([
      {
        id: "1",
        name: "Klein tekort",
        sku: "SKU-1",
        stockQuantity: 4,
        minStock: 5,
        brand: null,
        supplier: { name: "Leverancier X" },
      },
      {
        id: "2",
        name: "Groot tekort",
        sku: "SKU-2",
        stockQuantity: 0,
        minStock: 10,
        brand: { name: "Merk Y" },
        supplier: null,
      },
    ]);

    const result = await listLowStockParts();

    expect(result.map((r) => r.id)).toEqual(["2", "1"]);
    expect(result[0]).toMatchObject({
      shortage: 10,
      supplierName: null,
      brandName: "Merk Y",
    });
    expect(result[1]).toMatchObject({ shortage: 1, supplierName: "Leverancier X" });
  });

  it("lege database geeft een lege lijst, geen crash", async () => {
    prismaMock.part.findMany.mockResolvedValueOnce([]);
    expect(await listLowStockParts()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listBestsellers
// ---------------------------------------------------------------------------

describe("listBestsellers", () => {
  it("lege database: geen verkopen, geen part.findMany-aanroep, lege lijst", async () => {
    prismaMock.sale.groupBy.mockResolvedValueOnce([]);
    const result = await listBestsellers(null);
    expect(result).toEqual([]);
    expect(prismaMock.part.findMany).not.toHaveBeenCalled();
  });

  it("verrijkt de top-N met naam, sku, merk en archiefstatus", async () => {
    prismaMock.sale.groupBy.mockResolvedValueOnce([
      { partId: "p1", _sum: { quantity: 8 } },
      { partId: "p2", _sum: { quantity: 3 } },
    ]);
    prismaMock.part.findMany.mockResolvedValueOnce([
      { id: "p1", name: "Remblok", sku: "RB-1", archivedAt: null, brand: { name: "Merk A" } },
      {
        id: "p2",
        name: "Oud onderdeel",
        sku: "OU-1",
        archivedAt: new Date("2026-01-01T00:00:00.000Z"),
        brand: null,
      },
    ]);

    const result = await listBestsellers(null);

    expect(result).toEqual([
      {
        partId: "p1",
        name: "Remblok",
        sku: "RB-1",
        brandName: "Merk A",
        quantitySold: 8,
        isArchived: false,
      },
      {
        partId: "p2",
        name: "Oud onderdeel",
        sku: "OU-1",
        brandName: null,
        quantitySold: 3,
        isArchived: true,
      },
    ]);
  });

  it("filtert op soldAt >= since wanneer een periode is opgegeven", async () => {
    prismaMock.sale.groupBy.mockResolvedValueOnce([]);
    const since = new Date("2026-08-23T00:00:00.000Z");

    await listBestsellers(since);

    expect(prismaMock.sale.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { soldAt: { gte: since } } }),
    );
  });
});

// ---------------------------------------------------------------------------
// periodStart
// ---------------------------------------------------------------------------

describe("periodStart", () => {
  it("gaat het gevraagde aantal dagen terug vanaf `now`", () => {
    const now = new Date("2026-09-22T14:00:00.000Z");
    const start = periodStart(30, now);
    expect(start.toISOString()).toBe("2026-08-23T14:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// getDashboardData — volledig lege database, end-to-end
// ---------------------------------------------------------------------------

describe("getDashboardData", () => {
  it("een volledig lege database geeft nette nulwaarden en lege lijsten, geen crash", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.part.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { stockQuantity: null },
    });
    prismaMock.part.count.mockResolvedValue(0);
    prismaMock.part.findMany.mockResolvedValue([]);
    prismaMock.sale.groupBy.mockResolvedValue([]);
    prismaMock.sale.findMany.mockResolvedValue([]);

    const data = await getDashboardData(new Date("2026-09-22T14:00:00.000Z"));

    expect(data.totals).toEqual({
      stockValuePurchaseExcl: 0,
      stockValueSaleExcl: 0,
      stockValueSaleIncl: 0,
      uniquePartCount: 0,
      totalStockQuantity: 0,
      lowStockCount: 0,
    });
    expect(data.lowStockParts).toEqual([]);
    expect(data.bestsellersLast30Days).toEqual([]);
    expect(data.bestsellersAllTime).toEqual([]);
    expect(data.recentSales).toEqual([]);
    expect(data.bestsellerPeriodStart).toBe("2026-08-23T14:00:00.000Z");
  });
});
