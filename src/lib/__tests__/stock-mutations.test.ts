/**
 * Tests voor het zichtbaar maken van het voorraadgrootboek (T24):
 *
 * - `@/lib/stock-mutation-format`: +10 / −1, tijdstip in Amsterdamse tijd.
 * - `/voorraadmutaties/search-params`: filters uit de URL, terugval bij ongeldige
 *   invoer, URL's die filters behouden.
 * - `@/lib/queries/stock-mutations`: dat filteren, sorteren en pagineren als
 *   parameters naar de database gaan (gemockte Prisma-client, zoals in
 *   `reports.test.ts`) en dat er alleen plain DTO's uitkomen.
 * - Een statische bewaking tegen de "use client"-valkuil.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildMutationsQuery,
  parseMutationSearchParams,
} from "@/app/(app)/voorraadmutaties/search-params";
import {
  STOCK_MUTATION_REASON_LABELS,
  STOCK_MUTATION_REASON_OPTIONS,
} from "@/lib/labels";
import {
  buildStockMutationWhere,
  listStockMutations,
  toStockMutationDTO,
} from "@/lib/queries/stock-mutations";
import {
  describeDelta,
  formatDelta,
  formatMutationDateTime,
} from "@/lib/stock-mutation-format";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    stockMutation: { aggregate: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock, default: prismaMock }));

// 1 oktober 2026, 12:00 Amsterdamse zomertijd (10:00 UTC).
const NOW = new Date("2026-10-01T10:00:00.000Z");

// ---------------------------------------------------------------------------
// Weergave
// ---------------------------------------------------------------------------

describe("formatDelta", () => {
  it("toont een plus bij bijboeken en een echt minteken bij afboeken", () => {
    expect(formatDelta(10)).toBe("+10");
    expect(formatDelta(-1)).toBe("−1");
    expect(formatDelta(-1)).not.toBe("-1");
  });

  it("beschrijft de verandering voor schermlezers in het enkel- en meervoud", () => {
    expect(describeDelta(-1)).toBe("min 1 stuk");
    expect(describeDelta(10)).toBe("plus 10 stuks");
  });
});

describe("formatMutationDateTime", () => {
  it("rekent een UTC-instant om naar Amsterdamse tijd (zomertijd, +2)", () => {
    expect(formatMutationDateTime("2026-10-01T12:05:00.000Z")).toContain("14:05");
  });

  it("rekent in de winter met +1", () => {
    expect(formatMutationDateTime("2026-12-01T12:05:00.000Z")).toContain("13:05");
  });

  it("valt om middernacht UTC al op de volgende Amsterdamse dag", () => {
    expect(formatMutationDateTime("2026-09-30T22:30:00.000Z")).toMatch(/^1 okt/);
  });
});

describe("labels", () => {
  it("heeft een Nederlands label voor elke reden in het filter, in de gevraagde volgorde", () => {
    expect(STOCK_MUTATION_REASON_OPTIONS).toEqual([
      "DELIVERY",
      "CORRECTION",
      "COUNT",
      "SALE",
      "WORKSHOP",
      "INITIAL",
    ]);
    for (const reason of STOCK_MUTATION_REASON_OPTIONS) {
      expect(STOCK_MUTATION_REASON_LABELS[reason]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// URL-filters
// ---------------------------------------------------------------------------

describe("parseMutationSearchParams", () => {
  it("heeft zonder parameters geen filter en pagina 1", () => {
    const parsed = parseMutationSearchParams({}, NOW);
    expect(parsed.filters).toEqual({});
    expect(parsed.page).toBe(1);
    expect(parsed.hasFilter).toBe(false);
    expect(parsed.warning).toBeNull();
  });

  it("neemt een geldige reden over", () => {
    const parsed = parseMutationSearchParams({ reason: "WORKSHOP" }, NOW);
    expect(parsed.filters.reason).toBe("WORKSHOP");
    expect(parsed.hasFilter).toBe(true);
  });

  it("negeert een onbekende reden met een melding in plaats van te falen", () => {
    const parsed = parseMutationSearchParams({ reason: "onzin" }, NOW);
    expect(parsed.filters.reason).toBeUndefined();
    expect(parsed.warning).toContain("onzin");
  });

  it("zet 'vandaag' om naar de Amsterdamse kalenderdag, niet de UTC-dag", () => {
    const parsed = parseMutationSearchParams({ preset: "today" }, NOW);
    expect(parsed.filters.from?.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(parsed.filters.to?.toISOString()).toBe("2026-10-01T21:59:59.999Z");
    expect(parsed.preset).toBe("today");
  });

  it("zet '7d' om naar zeven kalenderdagen inclusief vandaag", () => {
    const parsed = parseMutationSearchParams({ preset: "7d" }, NOW);
    expect(parsed.filters.from?.toISOString()).toBe("2026-09-24T22:00:00.000Z");
    expect(parsed.filters.to?.toISOString()).toBe("2026-10-01T21:59:59.999Z");
  });

  it("zet 'ytd' om naar 1 januari van dit jaar", () => {
    const parsed = parseMutationSearchParams({ preset: "ytd" }, NOW);
    expect(parsed.filters.from?.toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });

  it("neemt een eigen periode over met begin- en einddag inclusief", () => {
    const parsed = parseMutationSearchParams(
      { preset: "custom", from: "2026-09-01", to: "2026-09-15" },
      NOW,
    );
    expect(parsed.filters.from?.toISOString()).toBe("2026-08-31T22:00:00.000Z");
    expect(parsed.filters.to?.toISOString()).toBe("2026-09-15T21:59:59.999Z");
  });

  it("staat een open eigen periode toe: alleen 'van' of alleen 'tot'", () => {
    const onlyFrom = parseMutationSearchParams({ preset: "custom", from: "2026-09-01" }, NOW);
    expect(onlyFrom.filters.from).toBeDefined();
    expect(onlyFrom.filters.to).toBeUndefined();

    const onlyTo = parseMutationSearchParams({ preset: "custom", to: "2026-09-01" }, NOW);
    expect(onlyTo.filters.from).toBeUndefined();
    expect(onlyTo.filters.to).toBeDefined();
  });

  it("filtert niet op periode bij 'custom' zonder datums, en meldt niets", () => {
    const parsed = parseMutationSearchParams({ preset: "custom" }, NOW);
    expect(parsed.filters.from).toBeUndefined();
    expect(parsed.filters.to).toBeUndefined();
    expect(parsed.warning).toBeNull();
    expect(parsed.preset).toBe("custom");
  });

  it("valt terug op geen periodefilter bij een niet-bestaande datum", () => {
    const parsed = parseMutationSearchParams(
      { preset: "custom", from: "2026-02-30", to: "2026-03-01" },
      NOW,
    );
    expect(parsed.filters.from).toBeUndefined();
    expect(parsed.filters.to).toBeUndefined();
    expect(parsed.warning).toContain("Ongeldige datum");
  });

  it("valt terug bij een einddatum vóór de begindatum", () => {
    const parsed = parseMutationSearchParams(
      { preset: "custom", from: "2026-09-15", to: "2026-09-01" },
      NOW,
    );
    expect(parsed.filters.from).toBeUndefined();
    expect(parsed.warning).toContain("einddatum");
  });

  it("valt terug bij een onbekende preset", () => {
    const parsed = parseMutationSearchParams({ preset: "eeuwig" }, NOW);
    expect(parsed.filters.from).toBeUndefined();
    expect(parsed.warning).toContain("eeuwig");
  });

  it("herstelt een ongeldig paginanummer naar 1", () => {
    for (const page of ["0", "-3", "abc", "2.5", ""]) {
      expect(parseMutationSearchParams({ page }, NOW).page).toBe(1);
    }
    expect(parseMutationSearchParams({ page: "4" }, NOW).page).toBe(4);
  });
});

describe("buildMutationsQuery", () => {
  it("behoudt de bestaande filters en zet een nieuwe erbij", () => {
    expect(buildMutationsQuery({ reason: "SALE" }, { preset: "7d" })).toBe(
      "?reason=SALE&preset=7d",
    );
  });

  it("verwijdert een parameter met null of een lege string", () => {
    expect(buildMutationsQuery({ reason: "SALE", preset: "7d" }, { reason: null })).toBe(
      "?preset=7d",
    );
    expect(buildMutationsQuery({ reason: "SALE" }, { reason: "" })).toBe("");
  });

  it("wist het paginanummer bij een filterwijziging, tenzij page expliciet meekomt", () => {
    expect(buildMutationsQuery({ reason: "SALE", page: "3" }, { reason: "COUNT" })).toBe(
      "?reason=COUNT",
    );
    expect(buildMutationsQuery({ reason: "SALE" }, { page: 3 })).toBe("?reason=SALE&page=3");
  });

  it("laat pagina 1 weg uit de URL", () => {
    expect(buildMutationsQuery({ reason: "SALE", page: "3" }, { page: 1 })).toBe("?reason=SALE");
  });
});

// ---------------------------------------------------------------------------
// Query's
// ---------------------------------------------------------------------------

describe("buildStockMutationWhere", () => {
  it("is leeg zonder filters", () => {
    expect(buildStockMutationWhere({})).toEqual({});
  });

  it("filtert op onderdeel, reden en een gesloten periode in de where", () => {
    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-09-30T00:00:00.000Z");
    expect(
      buildStockMutationWhere({ partId: "p1", reason: "SALE", from, to }),
    ).toEqual({
      partId: "p1",
      reason: "SALE",
      createdAt: { gte: from, lte: to },
    });
  });

  it("zet bij een open periode alleen de aanwezige kant in de where", () => {
    const from = new Date("2026-09-01T00:00:00.000Z");
    expect(buildStockMutationWhere({ from })).toEqual({ createdAt: { gte: from } });
  });
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    partId: "p1",
    part: { id: "p1", name: "Remblokken", sku: "REM-1", archivedAt: null },
    delta: -2,
    quantityBefore: 5,
    quantityAfter: 3,
    reason: "SALE",
    note: null,
    saleId: "s1",
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    ...overrides,
  };
}

describe("toStockMutationDTO", () => {
  it("zet de datum om naar een ISO-string en geeft alleen plain waarden", () => {
    const dto = toStockMutationDTO(row() as never);
    expect(dto.createdAt).toBe("2026-10-01T10:00:00.000Z");
    expect(typeof dto.createdAt).toBe("string");
    // Alles moet ongewijzigd door een JSON-ronde kunnen (RSC-serialisatie, SPEC §3 regel 1).
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });

  it("markeert SALE en WORKSHOP als 'uit verkoop', ook zonder saleId", () => {
    expect(toStockMutationDTO(row({ reason: "SALE", saleId: null }) as never).fromSale).toBe(true);
    expect(toStockMutationDTO(row({ reason: "WORKSHOP", saleId: null }) as never).fromSale).toBe(true);
  });

  it("markeert een handmatige wijziging niet als 'uit verkoop'", () => {
    expect(
      toStockMutationDTO(row({ reason: "DELIVERY", saleId: null, delta: 10 }) as never).fromSale,
    ).toBe(false);
  });

  it("markeert een gearchiveerd onderdeel", () => {
    const dto = toStockMutationDTO(
      row({ part: { id: "p1", name: "X", sku: "X", archivedAt: new Date() } }) as never,
    );
    expect(dto.partIsArchived).toBe(true);
  });
});

/** Zet de drie aggregaties (totaal, plus, min) van `getTotals` klaar. */
function mockTotals(count: number, plus: number | null, minus: number | null) {
  prismaMock.stockMutation.aggregate
    .mockResolvedValueOnce({ _count: { _all: count } })
    .mockResolvedValueOnce({ _sum: { delta: plus } })
    .mockResolvedValueOnce({ _sum: { delta: minus } });
}

describe("listStockMutations", () => {
  it("pagineert, sorteert en filtert in de database, niet in Node", async () => {
    prismaMock.stockMutation.aggregate.mockReset();
    prismaMock.stockMutation.findMany.mockReset();
    mockTotals(60, 40, -25);
    prismaMock.stockMutation.findMany.mockResolvedValue([row()]);

    const result = await listStockMutations({
      partId: "p1",
      reason: "SALE",
      page: 2,
      pageSize: 10,
    });

    expect(prismaMock.stockMutation.findMany).toHaveBeenCalledTimes(1);
    const args = prismaMock.stockMutation.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ partId: "p1", reason: "SALE" });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    // Nieuwste bovenaan, met een tiebreak zodat paginagrenzen stabiel zijn.
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);

    expect(result.total).toBe(60);
    expect(result.page).toBe(2);
    expect(result.pageCount).toBe(6);
    expect(result.items).toHaveLength(1);
    expect(result.totals).toEqual({ count: 60, added: 40, removed: 25 });
  });

  it("gebruikt voor de totalen exact dezelfde where als voor de regels", async () => {
    prismaMock.stockMutation.aggregate.mockReset();
    prismaMock.stockMutation.findMany.mockReset();
    mockTotals(3, 3, null);
    prismaMock.stockMutation.findMany.mockResolvedValue([]);

    await listStockMutations({ reason: "DELIVERY" });

    const calls = prismaMock.stockMutation.aggregate.mock.calls.map((c) => c[0].where);
    expect(calls[0]).toEqual({ reason: "DELIVERY" });
    expect(calls[1]).toEqual({ AND: [{ reason: "DELIVERY" }, { delta: { gt: 0 } }] });
    expect(calls[2]).toEqual({ AND: [{ reason: "DELIVERY" }, { delta: { lt: 0 } }] });
  });

  it("haalt geen rijen op als er niets is, en geeft nullen terug", async () => {
    prismaMock.stockMutation.aggregate.mockReset();
    prismaMock.stockMutation.findMany.mockReset();
    mockTotals(0, null, null);

    const result = await listStockMutations({ reason: "INITIAL" });

    expect(prismaMock.stockMutation.findMany).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
    expect(result.pageCount).toBe(0);
    expect(result.page).toBe(1);
    expect(result.totals).toEqual({ count: 0, added: 0, removed: 0 });
  });

  it("brengt een paginanummer voorbij het einde terug naar de laatste pagina", async () => {
    prismaMock.stockMutation.aggregate.mockReset();
    prismaMock.stockMutation.findMany.mockReset();
    mockTotals(12, 12, null);
    prismaMock.stockMutation.findMany.mockResolvedValue([row()]);

    const result = await listStockMutations({ page: 99, pageSize: 10 });

    expect(result.page).toBe(2);
    expect(prismaMock.stockMutation.findMany.mock.calls[0][0].skip).toBe(10);
  });

  it("begrenst de paginagrootte, zodat de URL de server niet kan opblazen", async () => {
    prismaMock.stockMutation.aggregate.mockReset();
    prismaMock.stockMutation.findMany.mockReset();
    mockTotals(1, 1, null);
    prismaMock.stockMutation.findMany.mockResolvedValue([row()]);

    await listStockMutations({ pageSize: 100000 });

    expect(prismaMock.stockMutation.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// Client/server-scheiding
// ---------------------------------------------------------------------------

describe("client/server-scheiding", () => {
  it("MutationsFilters.tsx ('use client') exporteert alleen het component en types", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../app/(app)/voorraadmutaties/MutationsFilters.tsx"),
      "utf8",
    );
    expect(source.trimStart().startsWith('"use client"')).toBe(true);

    const valueExports = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm)].map(
      (m) => m[1],
    );
    expect(valueExports).toEqual(["MutationsFilters"]);
  });

  it("search-params.ts heeft geen 'use client' en importeert geen Prisma-runtime", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../app/(app)/voorraadmutaties/search-params.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/from\s+["']@prisma\/client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/db["']/);
  });
});
