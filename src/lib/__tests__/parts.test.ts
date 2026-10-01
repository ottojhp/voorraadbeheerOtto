/**
 * Tests voor de datalaag onderdelen (`src/lib/queries/parts.ts`).
 *
 * Er is in deze omgeving geen database, dus alles hier is puur: de DTO-mapper en de
 * opbouw van `where`/`orderBy`/paginering worden direct getest, en de queryfuncties
 * draaien tegen een gemockte Prisma-client. Er zijn bewust geen integratietests.
 */

import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPartOrderBy,
  buildPartWhere,
  countUnbrandedParts,
  findPartByBarcode,
  getPartById,
  isLowStock,
  listParts,
  normalizePagination,
  searchPartsForSale,
  toPartDTO,
  type PartRecord,
} from "@/lib/queries/parts";

// ---------------------------------------------------------------------------
// Gemockte Prisma-client
// ---------------------------------------------------------------------------

/**
 * `vi.hoisted` omdat `vi.mock` naar de top van het bestand wordt gehesen en dus geen
 * gewone modulevariabelen mag aanraken. `minStockFieldRef` is een herkenbare stand-in
 * voor `prisma.part.fields.minStock`, zodat we kunnen bewijzen dat de
 * lage-voorraadvergelijking echt via een field reference loopt.
 */
const { minStockFieldRef, prismaMock } = vi.hoisted(() => {
  const minStockFieldRef = { __fieldRef: "Part.minStock" };

  return {
    minStockFieldRef,
    prismaMock: {
      part: {
        fields: { minStock: minStockFieldRef },
        findMany: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock, default: prismaMock }));

// ---------------------------------------------------------------------------
// Testdata
// ---------------------------------------------------------------------------

const basePart: PartRecord = {
  id: "part_1",
  name: "Remblokset voor",
  brandId: "brand_1",
  brand: { id: "brand_1", name: "Vespa" },
  category: "SCOOTER_PART",
  sku: "REM-001",
  barcode: "8712345678901",
  supplierArticleNumber: "PIA-4T-8412",
  purchasePriceExcl: new Prisma.Decimal("12.50"),
  // INCL. btw (datamodel v2): 30,19 incl. is 24,95 excl. bij 21%.
  salePriceIncl: new Prisma.Decimal("30.19"),
  vatRate: new Prisma.Decimal("21.00"),
  stockQuantity: 8,
  minStock: 4,
  supplierId: "sup_1",
  supplier: { id: "sup_1", name: "Tweewieler Groothandel" },
  description: "Set van twee blokken",
  fitsModels: "Vespa Primavera 2016-2021, Sprint 125",
  location: "A3-02",
  archivedAt: null,
  createdAt: new Date("2026-01-15T10:30:00.000Z"),
  updatedAt: new Date("2026-02-01T08:00:00.000Z"),
};

function makePart(overrides: Partial<PartRecord> = {}): PartRecord {
  return { ...basePart, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// DTO-mapper
// ---------------------------------------------------------------------------

describe("toPartDTO", () => {
  it("zet Decimal om naar number en Date naar ISO-string", () => {
    const dto = toPartDTO(makePart());

    expect(dto.purchasePriceExcl).toBe(12.5);
    expect(dto.salePriceIncl).toBe(30.19);
    expect(dto.vatRate).toBe(21);
    expect(typeof dto.purchasePriceExcl).toBe("number");
    expect(typeof dto.salePriceIncl).toBe("number");
    expect(typeof dto.vatRate).toBe("number");

    expect(dto.createdAt).toBe("2026-01-15T10:30:00.000Z");
    expect(dto.updatedAt).toBe("2026-02-01T08:00:00.000Z");
    expect(dto.archivedAt).toBeNull();
  });

  it("bevat geen Decimal- of Date-objecten meer (SPEC §3 regel 1)", () => {
    const dto = toPartDTO(makePart());

    for (const [key, value] of Object.entries(dto)) {
      expect(value instanceof Date, `${key} mag geen Date zijn`).toBe(false);
      expect(
        value instanceof Prisma.Decimal,
        `${key} mag geen Decimal zijn`,
      ).toBe(false);
    }

    // Serialiseerbaar richting een client component.
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it("mapt merk en leverancier naar id + naam", () => {
    const dto = toPartDTO(makePart());

    expect(dto.brand).toEqual({ id: "brand_1", name: "Vespa" });
    expect(dto.supplier).toEqual({
      id: "sup_1",
      name: "Tweewieler Groothandel",
    });
  });

  it("geeft null voor een universeel onderdeel zonder merk", () => {
    const dto = toPartDTO(makePart({ brandId: null, brand: null }));

    expect(dto.brand).toBeNull();
  });

  it("geeft null voor een onderdeel zonder leverancier", () => {
    const dto = toPartDTO(makePart({ supplierId: null, supplier: null }));

    expect(dto.supplier).toBeNull();
  });

  it("berekent marge en margepercentage excl. btw", () => {
    const dto = toPartDTO(makePart());

    // 24,95 - 12,50 = 12,45; 12,45 / 24,95 * 100 = 49,8997... → 49,9
    expect(dto.margin).toBe(12.45);
    expect(dto.marginPct).toBe(49.9);
  });

  it("geeft 0% marge bij verkoopprijs 0 in plaats van NaN of Infinity", () => {
    const dto = toPartDTO(
      makePart({
        purchasePriceExcl: new Prisma.Decimal("5.00"),
        salePriceIncl: new Prisma.Decimal("0.00"),
      }),
    );

    expect(dto.margin).toBe(-5);
    expect(dto.marginPct).toBe(0);
    expect(Number.isFinite(dto.marginPct)).toBe(true);
  });

  it("leidt de verkoopprijs excl. 21% btw af uit het opgeslagen incl.-bedrag", () => {
    const dto = toPartDTO(
      makePart({
        salePriceIncl: new Prisma.Decimal("30.19"),
        vatRate: new Prisma.Decimal("21.00"),
      }),
    );

    // 30,19 / 1,21 = 24,9504... → 24,95
    expect(dto.salePriceExcl).toBe(24.95);
    // Het opgeslagen incl.-bedrag blijft onaangeroerd: dat is wat de klant betaalt.
    expect(dto.salePriceIncl).toBe(30.19);
  });

  it("leidt de verkoopprijs excl. 9% btw af", () => {
    const dto = toPartDTO(
      makePart({
        salePriceIncl: new Prisma.Decimal("109.00"),
        vatRate: new Prisma.Decimal("9.00"),
      }),
    );

    expect(dto.salePriceExcl).toBe(100);
  });

  it("rekent de marge op EXCL.-basis, niet op het opgeslagen incl.-bedrag", () => {
    // Zou de marge uit het incl.-bedrag komen (30,19 - 12,50 = 17,69), dan stond er
    // ~42% te veel winst in het overzicht. Dit is precies de fout die de hernoeming
    // van de velden moet voorkomen (SPEC §3 regel 0).
    const dto = toPartDTO(makePart());

    expect(dto.margin).toBe(12.45);
    expect(dto.margin).not.toBe(17.69);
  });

  it("markeert gearchiveerde onderdelen met een ISO-string", () => {
    const dto = toPartDTO(
      makePart({ archivedAt: new Date("2026-03-01T12:00:00.000Z") }),
    );

    expect(dto.archivedAt).toBe("2026-03-01T12:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Lage voorraad
// ---------------------------------------------------------------------------

describe("isLowStock", () => {
  it("is waar als de voorraad onder de drempel ligt", () => {
    expect(isLowStock(2, 5)).toBe(true);
  });

  it("is waar als de voorraad precies gelijk is aan de drempel", () => {
    expect(isLowStock(5, 5)).toBe(true);
  });

  it("is onwaar als de voorraad boven de drempel ligt", () => {
    expect(isLowStock(6, 5)).toBe(false);
  });

  it("is NOOIT waar als er geen drempel is ingesteld (minStock = 0)", () => {
    expect(isLowStock(0, 0)).toBe(false);
    expect(isLowStock(10, 0)).toBe(false);
    expect(isLowStock(-1, 0)).toBe(false);
  });

  it("zit ook zo in de DTO", () => {
    expect(
      toPartDTO(makePart({ stockQuantity: 1, minStock: 4 })).isLowStock,
    ).toBe(true);
    expect(
      toPartDTO(makePart({ stockQuantity: 4, minStock: 4 })).isLowStock,
    ).toBe(true);
    expect(
      toPartDTO(makePart({ stockQuantity: 5, minStock: 4 })).isLowStock,
    ).toBe(false);
    expect(
      toPartDTO(makePart({ stockQuantity: 0, minStock: 0 })).isLowStock,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// where-clause
// ---------------------------------------------------------------------------

describe("buildPartWhere", () => {
  it("sluit gearchiveerde onderdelen standaard uit", () => {
    expect(buildPartWhere({})).toEqual({ archivedAt: null });
  });

  it("neemt gearchiveerde onderdelen mee als daar expliciet om gevraagd wordt", () => {
    expect(buildPartWhere({ includeArchived: true })).toEqual({});
  });

  it("zoekt case-insensitive op naam, sku, barcode, leveranciersnummer en pasvorm", () => {
    const where = buildPartWhere({ search: "primavera" });

    expect(where.OR).toEqual([
      { name: { contains: "primavera", mode: "insensitive" } },
      { sku: { contains: "primavera", mode: "insensitive" } },
      { barcode: { contains: "primavera", mode: "insensitive" } },
      { supplierArticleNumber: { contains: "primavera", mode: "insensitive" } },
      { fitsModels: { contains: "primavera", mode: "insensitive" } },
    ]);
  });

  it("vindt een onderdeel op (een stuk van) het leveranciersartikelnummer, ongeacht hoofdletters", () => {
    // Zelfde nummer als in de fixture hierboven (PIA-4T-8412): zowel het hele nummer
    // als een stuk ervan in kleine letters moet als `contains` + `insensitive` op
    // `supplierArticleNumber` in de where terechtkomen (Prisma vertaalt dat naar
    // ILIKE '%...%'; de echte database-uitkomst is apart gecontroleerd).
    for (const term of ["PIA-4T-8412", "pia-4t", "8412"]) {
      expect(buildPartWhere({ search: term }).OR).toContainEqual({
        supplierArticleNumber: { contains: term, mode: "insensitive" },
      });
    }
  });

  it("trimt de zoekterm en negeert een lege of witruimte-zoekterm", () => {
    expect(buildPartWhere({ search: "  rem  " }).OR).toEqual([
      { name: { contains: "rem", mode: "insensitive" } },
      { sku: { contains: "rem", mode: "insensitive" } },
      { barcode: { contains: "rem", mode: "insensitive" } },
      { supplierArticleNumber: { contains: "rem", mode: "insensitive" } },
      { fitsModels: { contains: "rem", mode: "insensitive" } },
    ]);

    expect(buildPartWhere({ search: "" }).OR).toBeUndefined();
    expect(buildPartWhere({ search: "   " }).OR).toBeUndefined();
  });

  it("filtert op merk", () => {
    expect(buildPartWhere({ brandId: "brand_1" })).toEqual({
      archivedAt: null,
      brandId: "brand_1",
    });
  });

  it("filtert op onderdelen zonder merk (universele artikelen)", () => {
    expect(buildPartWhere({ brandIsNull: true })).toEqual({
      archivedAt: null,
      brandId: null,
    });
  });

  it("laat het universeel-filter winnen van een achtergebleven brandId", () => {
    expect(
      buildPartWhere({ brandIsNull: true, brandId: "brand_1" }).brandId,
    ).toBeNull();
  });

  it("filtert op categorie en leverancier", () => {
    expect(buildPartWhere({ category: "HELMET", supplierId: "sup_9" })).toEqual(
      {
        archivedAt: null,
        category: "HELMET",
        supplierId: "sup_9",
      },
    );
  });

  it("vergelijkt bij lage voorraad twee kolommen via een Prisma field reference", () => {
    const where = buildPartWhere({ lowStockOnly: true });

    expect(where.minStock).toEqual({ gt: 0 });
    // Geen los getal, maar een verwijzing naar de kolom `minStock` zelf.
    expect(where.stockQuantity).toEqual({ lte: minStockFieldRef });
  });

  it("combineert lage voorraad met zoeken en de overige filters", () => {
    const where = buildPartWhere({
      search: "olie",
      lowStockOnly: true,
      category: "CONSUMABLE",
      brandIsNull: true,
    });

    expect(where).toEqual({
      archivedAt: null,
      OR: [
        { name: { contains: "olie", mode: "insensitive" } },
        { sku: { contains: "olie", mode: "insensitive" } },
        { barcode: { contains: "olie", mode: "insensitive" } },
        { supplierArticleNumber: { contains: "olie", mode: "insensitive" } },
        { fitsModels: { contains: "olie", mode: "insensitive" } },
      ],
      brandId: null,
      category: "CONSUMABLE",
      minStock: { gt: 0 },
      stockQuantity: { lte: minStockFieldRef },
    });
  });

  it("zet geen voorraadfilter als lowStockOnly uit staat", () => {
    const where = buildPartWhere({ lowStockOnly: false });

    expect(where.minStock).toBeUndefined();
    expect(where.stockQuantity).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// orderBy en paginering
// ---------------------------------------------------------------------------

describe("buildPartOrderBy", () => {
  it("sorteert standaard op naam, oplopend, met id als tiebreaker", () => {
    expect(buildPartOrderBy()).toEqual([{ name: "asc" }, { id: "asc" }]);
  });

  it("sorteert op naam aflopend", () => {
    expect(buildPartOrderBy("name", "desc")).toEqual([
      { name: "desc" },
      { id: "asc" },
    ]);
  });

  it("sorteert op voorraad met naam en id als tiebreakers", () => {
    expect(buildPartOrderBy("stock", "desc")).toEqual([
      { stockQuantity: "desc" },
      { name: "asc" },
      { id: "asc" },
    ]);
  });
});

describe("normalizePagination", () => {
  it("gebruikt pagina 1 en pageSize 50 als standaard (SPEC §F2)", () => {
    expect(normalizePagination()).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
    });
  });

  it("rekent skip en take uit", () => {
    expect(normalizePagination(3, 20)).toEqual({
      page: 3,
      pageSize: 20,
      skip: 40,
      take: 20,
    });
  });

  it("corrigeert onzinnige waarden uit de URL", () => {
    expect(normalizePagination(0, 10).page).toBe(1);
    expect(normalizePagination(-5, 10).page).toBe(1);
    expect(normalizePagination(Number.NaN, 10).page).toBe(1);
    expect(normalizePagination(2.7, 10).page).toBe(2);
    expect(normalizePagination(1, 0).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePagination(1, -1).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("begrenst de paginagrootte", () => {
    expect(normalizePagination(1, 100000).pageSize).toBe(MAX_PAGE_SIZE);
  });
});

// ---------------------------------------------------------------------------
// listParts
// ---------------------------------------------------------------------------

describe("listParts", () => {
  it("geeft gepagineerde DTO's plus het totaal terug", async () => {
    prismaMock.part.count.mockResolvedValue(3);
    prismaMock.part.findMany.mockResolvedValue([makePart()]);

    const result = await listParts();

    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(result.pageCount).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].salePriceIncl).toBe(30.19);
    expect(result.items[0].salePriceExcl).toBe(24.95);
    expect(result.items[0].margin).toBe(12.45);
  });

  it("geeft where, orderBy, skip en take door aan Prisma", async () => {
    prismaMock.part.count.mockResolvedValue(0);
    prismaMock.part.findMany.mockResolvedValue([]);

    await listParts({
      search: "rem",
      sort: "stock",
      sortDir: "desc",
      page: 2,
      pageSize: 25,
    });

    const args = prismaMock.part.findMany.mock.calls[0][0];
    expect(args.where).toEqual(buildPartWhere({ search: "rem" }));
    expect(args.orderBy).toEqual([
      { stockQuantity: "desc" },
      { name: "asc" },
      { id: "asc" },
    ]);
    expect(args.skip).toBe(25);
    expect(args.take).toBe(25);

    // `count` telt met exact dezelfde where, anders klopt de paginering niet.
    expect(prismaMock.part.count.mock.calls[0][0].where).toEqual(args.where);
  });

  it("rekent het aantal pagina's uit en geeft 0 bij een leeg resultaat", async () => {
    prismaMock.part.count.mockResolvedValue(0);
    prismaMock.part.findMany.mockResolvedValue([]);
    expect((await listParts()).pageCount).toBe(0);

    prismaMock.part.count.mockResolvedValue(101);
    prismaMock.part.findMany.mockResolvedValue([]);
    expect((await listParts({ pageSize: 50 })).pageCount).toBe(3);
  });

  it("sorteert op marge over de hele gefilterde set, niet alleen binnen de pagina", async () => {
    // Marges: laag 1,00 / midden 10,00 / hoog 50,00
    prismaMock.part.findMany
      .mockResolvedValueOnce([
        {
          id: "laag",
          name: "Laag",
          purchasePriceExcl: new Prisma.Decimal("9.00"),
          salePriceIncl: new Prisma.Decimal("10.00"),
          // 0% btw: incl. = excl., zodat de marge in deze test het
          // sorteergedrag test en niet de btw-afleiding.
          vatRate: new Prisma.Decimal("0.00"),
        },
        {
          id: "hoog",
          name: "Hoog",
          purchasePriceExcl: new Prisma.Decimal("50.00"),
          salePriceIncl: new Prisma.Decimal("100.00"),
          // 0% btw: incl. = excl., zodat de marge in deze test het
          // sorteergedrag test en niet de btw-afleiding.
          vatRate: new Prisma.Decimal("0.00"),
        },
        {
          id: "midden",
          name: "Midden",
          purchasePriceExcl: new Prisma.Decimal("10.00"),
          salePriceIncl: new Prisma.Decimal("20.00"),
          // 0% btw: incl. = excl., zodat de marge in deze test het
          // sorteergedrag test en niet de btw-afleiding.
          vatRate: new Prisma.Decimal("0.00"),
        },
      ])
      // Prisma geeft `id: { in: [...] }` in willekeurige volgorde terug.
      .mockResolvedValueOnce([
        makePart({ id: "midden", name: "Midden" }),
        makePart({ id: "hoog", name: "Hoog" }),
      ]);

    const result = await listParts({
      sort: "margin",
      sortDir: "desc",
      pageSize: 2,
    });

    expect(result.items.map((item) => item.id)).toEqual(["hoog", "midden"]);
    expect(result.total).toBe(3);
    expect(result.pageCount).toBe(2);

    // Stap 1 leest alleen de kolommen die nodig zijn voor de marge.
    const firstCall = prismaMock.part.findMany.mock.calls[0][0];
    expect(firstCall.select).toEqual({
      id: true,
      name: true,
      purchasePriceExcl: true,
      salePriceIncl: true,
      // Het btw-tarief is nodig om de verkoopprijs terug te rekenen naar excl.
      vatRate: true,
    });
    expect(firstCall.skip).toBeUndefined();

    // Stap 2 haalt alleen de rijen van deze pagina volledig op.
    expect(prismaMock.part.findMany.mock.calls[1][0].where).toEqual({
      id: { in: ["hoog", "midden"] },
    });
  });

  it("pagineert correct door bij sorteren op marge", async () => {
    prismaMock.part.findMany
      .mockResolvedValueOnce([
        {
          id: "laag",
          name: "Laag",
          purchasePriceExcl: new Prisma.Decimal("9.00"),
          salePriceIncl: new Prisma.Decimal("10.00"),
          // 0% btw: incl. = excl., zodat de marge in deze test het
          // sorteergedrag test en niet de btw-afleiding.
          vatRate: new Prisma.Decimal("0.00"),
        },
        {
          id: "hoog",
          name: "Hoog",
          purchasePriceExcl: new Prisma.Decimal("50.00"),
          salePriceIncl: new Prisma.Decimal("100.00"),
          // 0% btw: incl. = excl., zodat de marge in deze test het
          // sorteergedrag test en niet de btw-afleiding.
          vatRate: new Prisma.Decimal("0.00"),
        },
        {
          id: "midden",
          name: "Midden",
          purchasePriceExcl: new Prisma.Decimal("10.00"),
          salePriceIncl: new Prisma.Decimal("20.00"),
          // 0% btw: incl. = excl., zodat de marge in deze test het
          // sorteergedrag test en niet de btw-afleiding.
          vatRate: new Prisma.Decimal("0.00"),
        },
      ])
      .mockResolvedValueOnce([makePart({ id: "laag", name: "Laag" })]);

    const result = await listParts({
      sort: "margin",
      sortDir: "desc",
      page: 2,
      pageSize: 2,
    });

    expect(result.items.map((item) => item.id)).toEqual(["laag"]);
    expect(result.total).toBe(3);
    expect(result.page).toBe(2);
  });

  it("sorteert op marge oplopend", async () => {
    prismaMock.part.findMany
      .mockResolvedValueOnce([
        {
          id: "hoog",
          name: "Hoog",
          purchasePriceExcl: new Prisma.Decimal("50.00"),
          salePriceIncl: new Prisma.Decimal("100.00"),
          // 0% btw: incl. = excl., zodat de marge in deze test het
          // sorteergedrag test en niet de btw-afleiding.
          vatRate: new Prisma.Decimal("0.00"),
        },
        {
          id: "laag",
          name: "Laag",
          purchasePriceExcl: new Prisma.Decimal("9.00"),
          salePriceIncl: new Prisma.Decimal("10.00"),
          // 0% btw: incl. = excl., zodat de marge in deze test het
          // sorteergedrag test en niet de btw-afleiding.
          vatRate: new Prisma.Decimal("0.00"),
        },
      ])
      .mockResolvedValueOnce([
        makePart({ id: "hoog", name: "Hoog" }),
        makePart({ id: "laag", name: "Laag" }),
      ]);

    const result = await listParts({ sort: "margin", sortDir: "asc" });

    expect(result.items.map((item) => item.id)).toEqual(["laag", "hoog"]);
  });

  it("doet geen tweede query als de margepagina buiten het resultaat valt", async () => {
    prismaMock.part.findMany.mockResolvedValueOnce([
      {
        id: "laag",
        name: "Laag",
        purchasePriceExcl: new Prisma.Decimal("9.00"),
        salePriceIncl: new Prisma.Decimal("10.00"),
        // 0% btw: incl. = excl., zodat de marge in deze test het
        // sorteergedrag test en niet de btw-afleiding.
        vatRate: new Prisma.Decimal("0.00"),
      },
    ]);

    const result = await listParts({ sort: "margin", page: 5, pageSize: 50 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(1);
    expect(prismaMock.part.findMany).toHaveBeenCalledTimes(1);
  });

  it("telt bij sorteren op marge niet via prisma.count", async () => {
    prismaMock.part.findMany.mockResolvedValueOnce([]);

    await listParts({ sort: "margin" });

    expect(prismaMock.part.count).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getPartById / findPartByBarcode
// ---------------------------------------------------------------------------

describe("getPartById", () => {
  it("geeft een DTO terug", async () => {
    prismaMock.part.findUnique.mockResolvedValue(makePart());

    const dto = await getPartById("part_1");

    expect(dto?.id).toBe("part_1");
    expect(prismaMock.part.findUnique.mock.calls[0][0].where).toEqual({
      id: "part_1",
    });
  });

  it("geeft ook gearchiveerde onderdelen terug (de bewerkpagina heeft ze nodig)", async () => {
    prismaMock.part.findUnique.mockResolvedValue(
      makePart({ archivedAt: new Date("2026-03-01T12:00:00.000Z") }),
    );

    const dto = await getPartById("part_1");

    expect(dto?.archivedAt).toBe("2026-03-01T12:00:00.000Z");
    // Geen archivedAt-voorwaarde in de where.
    expect(
      prismaMock.part.findUnique.mock.calls[0][0].where.archivedAt,
    ).toBeUndefined();
  });

  it("geeft null bij geen match", async () => {
    prismaMock.part.findUnique.mockResolvedValue(null);

    expect(await getPartById("bestaat-niet")).toBeNull();
  });

  it("gaat bij een lege id niet naar de database", async () => {
    expect(await getPartById("")).toBeNull();
    expect(prismaMock.part.findUnique).not.toHaveBeenCalled();
  });
});

describe("findPartByBarcode", () => {
  it("zoekt op exacte barcode en sluit gearchiveerde onderdelen uit", async () => {
    prismaMock.part.findFirst.mockResolvedValue(makePart());

    const dto = await findPartByBarcode(" 8712345678901 ");

    expect(dto?.id).toBe("part_1");
    expect(prismaMock.part.findFirst.mock.calls[0][0].where).toEqual({
      barcode: "8712345678901",
      archivedAt: null,
    });
  });

  it("geeft null bij geen match", async () => {
    prismaMock.part.findFirst.mockResolvedValue(null);

    expect(await findPartByBarcode("0000000000000")).toBeNull();
  });

  it("gaat bij een lege barcode niet naar de database", async () => {
    expect(await findPartByBarcode("")).toBeNull();
    expect(await findPartByBarcode("   ")).toBeNull();
    expect(prismaMock.part.findFirst).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// searchPartsForSale
// ---------------------------------------------------------------------------

describe("searchPartsForSale", () => {
  it("geeft een beknopte lijst met voorraad en prijs", async () => {
    prismaMock.part.findMany.mockResolvedValue([
      {
        id: "part_1",
        name: "Remblokset voor",
        category: "SCOOTER_PART",
        sku: "REM-001",
        barcode: "8712345678901",
        stockQuantity: 8,
        salePriceIncl: new Prisma.Decimal("30.19"),
        vatRate: new Prisma.Decimal("21.00"),
        brand: { name: "Vespa" },
      },
      {
        id: "part_2",
        name: "Motorolie 10W40",
        category: "CONSUMABLE",
        sku: "OLI-010",
        barcode: null,
        stockQuantity: 0,
        salePriceIncl: new Prisma.Decimal("11.50"),
        vatRate: new Prisma.Decimal("21.00"),
        brand: null,
      },
    ]);

    const results = await searchPartsForSale("rem");

    expect(results).toEqual([
      {
        id: "part_1",
        name: "Remblokset voor",
        brandName: "Vespa",
        category: "SCOOTER_PART",
        sku: "REM-001",
        barcode: "8712345678901",
        stockQuantity: 8,
        salePriceIncl: 30.19,
        vatRate: 21,
        // 30,19 / 1,21 = 24,9504... → 24,95
        salePriceExcl: 24.95,
      },
      {
        id: "part_2",
        name: "Motorolie 10W40",
        brandName: null,
        category: "CONSUMABLE",
        sku: "OLI-010",
        barcode: null,
        stockQuantity: 0,
        salePriceIncl: 11.5,
        vatRate: 21,
        // 11,50 / 1,21 = 9,5041... → 9,50
        salePriceExcl: 9.5,
      },
    ]);
  });

  it("zoekt op naam, sku, barcode en leveranciersnummer, zonder gearchiveerde onderdelen", async () => {
    prismaMock.part.findMany.mockResolvedValue([]);

    await searchPartsForSale("rem", 5);

    const args = prismaMock.part.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      archivedAt: null,
      OR: [
        { name: { contains: "rem", mode: "insensitive" } },
        { sku: { contains: "rem", mode: "insensitive" } },
        { barcode: { contains: "rem", mode: "insensitive" } },
        { supplierArticleNumber: { contains: "rem", mode: "insensitive" } },
      ],
    });
    expect(args.take).toBe(5);
  });

  it("zoekt in het verkoopscherm ook op het leveranciersnummer van de verpakking", async () => {
    prismaMock.part.findMany.mockResolvedValue([]);

    await searchPartsForSale("  pia-4t-84 ");

    expect(prismaMock.part.findMany.mock.calls[0][0].where.OR).toContainEqual({
      supplierArticleNumber: { contains: "pia-4t-84", mode: "insensitive" },
    });
  });

  it("begrenst het aantal suggesties", async () => {
    prismaMock.part.findMany.mockResolvedValue([]);

    await searchPartsForSale("rem", 9999);

    expect(prismaMock.part.findMany.mock.calls[0][0].take).toBe(50);
  });

  it("gaat bij een lege zoekterm niet naar de database", async () => {
    expect(await searchPartsForSale("")).toEqual([]);
    expect(await searchPartsForSale("   ")).toEqual([]);
    expect(prismaMock.part.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Filteropties (merken/leveranciers: zie ./brands en ./suppliers)
// ---------------------------------------------------------------------------

describe("countUnbrandedParts", () => {
  it("telt de universele onderdelen zonder merk, zonder gearchiveerde", async () => {
    prismaMock.part.count.mockResolvedValue(7);

    expect(await countUnbrandedParts()).toBe(7);
    expect(prismaMock.part.count.mock.calls[0][0].where).toEqual({
      brandId: null,
      archivedAt: null,
    });
  });
});
