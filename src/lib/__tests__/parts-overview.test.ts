/**
 * Tests voor de pure logica achter het voorraadoverzicht (T07, SPEC §F2):
 * het omzetten van `searchParams` naar `listParts`-parameters, het opbouwen
 * van URL's die bestaande filters behouden, en het groeperen per merk.
 *
 * Bewust geen database nodig: `search-params.ts` importeert alleen types uit
 * `@/lib/queries/*` (weggecompileerd door `import type`) en `PartsTable.tsx`
 * rekent niets uit — beide zijn hier dus rechtstreeks als pure functies te
 * testen.
 */

import { describe, expect, it } from "vitest";

import {
  buildPartsQuery,
  firstParam,
  normalizeSearchParams,
  parsePartsSearchParams,
  type RawSearchParams,
} from "@/app/(app)/onderdelen/search-params";
import { groupPartsByBrand } from "@/app/(app)/onderdelen/PartsTable";
import type { PartDTO } from "@/lib/queries/types";

// ---------------------------------------------------------------------------
// Testfabriek voor PartDTO
// ---------------------------------------------------------------------------

let idCounter = 0;

function makePart(overrides: Partial<PartDTO> = {}): PartDTO {
  idCounter += 1;
  return {
    id: `part-${idCounter}`,
    name: `Onderdeel ${idCounter}`,
    brand: null,
    category: "ACCESSORY",
    sku: `SKU-${idCounter}`,
    barcode: null,
    purchasePrice: 10,
    salePrice: 20,
    vatRate: 21,
    salePriceInclVat: 24.2,
    margin: 10,
    marginPct: 50,
    stockQuantity: 5,
    minStock: 2,
    isLowStock: false,
    supplier: null,
    description: null,
    fitsModels: null,
    location: null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// firstParam / normalizeSearchParams
// ---------------------------------------------------------------------------

describe("firstParam", () => {
  it("geeft een kale string terug", () => {
    expect(firstParam("vespa")).toBe("vespa");
  });

  it("pakt de eerste waarde bij een herhaalde parameter", () => {
    expect(firstParam(["a", "b"])).toBe("a");
  });

  it("geeft undefined terug bij undefined", () => {
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe("normalizeSearchParams", () => {
  it("laat lege en ontbrekende waarden weg", () => {
    const raw: RawSearchParams = { search: "", brandId: undefined, category: "HELMET" };
    expect(normalizeSearchParams(raw)).toEqual({ category: "HELMET" });
  });

  it("pakt de eerste waarde van een array", () => {
    const raw: RawSearchParams = { sort: ["stock", "margin"] };
    expect(normalizeSearchParams(raw)).toEqual({ sort: "stock" });
  });
});

// ---------------------------------------------------------------------------
// parsePartsSearchParams
// ---------------------------------------------------------------------------

describe("parsePartsSearchParams", () => {
  it("geeft standaardwaarden terug zonder parameters", () => {
    const { listParams, groupByBrand } = parsePartsSearchParams({});
    expect(listParams).toEqual({
      search: undefined,
      brandId: undefined,
      brandIsNull: undefined,
      category: undefined,
      supplierId: undefined,
      lowStockOnly: undefined,
      sort: "name",
      sortDir: "asc",
      page: 1,
    });
    expect(groupByBrand).toBe(false);
  });

  it("neemt zoekterm, categorie en leverancier over", () => {
    const { listParams } = parsePartsSearchParams({
      search: "remblok",
      category: "CONSUMABLE",
      supplierId: "sup-1",
    });
    expect(listParams.search).toBe("remblok");
    expect(listParams.category).toBe("CONSUMABLE");
    expect(listParams.supplierId).toBe("sup-1");
  });

  it("valt terug op geen categoriefilter bij een ongeldige waarde", () => {
    const { listParams } = parsePartsSearchParams({ category: "ONBESTAAND" });
    expect(listParams.category).toBeUndefined();
  });

  it("zet brandId=unbranded om naar brandIsNull en negeert dan brandId", () => {
    const { listParams } = parsePartsSearchParams({ brandId: "unbranded" });
    expect(listParams.brandIsNull).toBe(true);
    expect(listParams.brandId).toBeUndefined();
  });

  it("herkent een gewoon merk-id", () => {
    const { listParams } = parsePartsSearchParams({ brandId: "brand-123" });
    expect(listParams.brandId).toBe("brand-123");
    expect(listParams.brandIsNull).toBeUndefined();
  });

  it("zet lowStockOnly=1 om naar true, iedere andere waarde naar undefined", () => {
    expect(parsePartsSearchParams({ lowStockOnly: "1" }).listParams.lowStockOnly).toBe(
      true,
    );
    expect(
      parsePartsSearchParams({ lowStockOnly: "true" }).listParams.lowStockOnly,
    ).toBeUndefined();
  });

  it("valt terug op sort=name bij een onbekende sorteersleutel", () => {
    expect(parsePartsSearchParams({ sort: "prijs" }).listParams.sort).toBe("name");
    expect(parsePartsSearchParams({ sort: "margin" }).listParams.sort).toBe("margin");
    expect(parsePartsSearchParams({ sort: "stock" }).listParams.sort).toBe("stock");
  });

  it("accepteert alleen sortDir=desc als 'desc', al de rest wordt 'asc'", () => {
    expect(parsePartsSearchParams({ sortDir: "desc" }).listParams.sortDir).toBe("desc");
    expect(parsePartsSearchParams({ sortDir: "omhoog" }).listParams.sortDir).toBe("asc");
  });

  it("normaliseert een ongeldig paginanummer naar 1", () => {
    expect(parsePartsSearchParams({ page: "0" }).listParams.page).toBe(1);
    expect(parsePartsSearchParams({ page: "abc" }).listParams.page).toBe(1);
    expect(parsePartsSearchParams({ page: "3" }).listParams.page).toBe(3);
  });

  it("herkent group=merk als groepering per merk", () => {
    expect(parsePartsSearchParams({ group: "merk" }).groupByBrand).toBe(true);
    expect(parsePartsSearchParams({ group: "iets-anders" }).groupByBrand).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildPartsQuery
// ---------------------------------------------------------------------------

describe("buildPartsQuery", () => {
  it("geeft een lege string terug zonder parameters", () => {
    expect(buildPartsQuery({}, {})).toBe("");
  });

  it("behoudt bestaande filters en voegt de override toe", () => {
    const qs = buildPartsQuery({ category: "HELMET" }, { search: "vespa" });
    const params = new URLSearchParams(qs.replace(/^\?/, ""));
    expect(params.get("category")).toBe("HELMET");
    expect(params.get("search")).toBe("vespa");
  });

  it("reset de pagina naar 1 (verwijdert 'm) als een filter wijzigt", () => {
    const qs = buildPartsQuery({ page: "3", category: "HELMET" }, { search: "vespa" });
    const params = new URLSearchParams(qs.replace(/^\?/, ""));
    expect(params.has("page")).toBe(false);
  });

  it("behoudt de pagina wél als 'page' expliciet wordt meegegeven", () => {
    const qs = buildPartsQuery({ page: "3", category: "HELMET" }, { page: 4 });
    const params = new URLSearchParams(qs.replace(/^\?/, ""));
    expect(params.get("page")).toBe("4");
    expect(params.get("category")).toBe("HELMET");
  });

  it("verwijdert een parameter als de override null is", () => {
    const qs = buildPartsQuery({ brandId: "brand-1" }, { brandId: null });
    expect(qs).toBe("");
  });

  it("zet true om naar '1' en laat false weg", () => {
    const qs = buildPartsQuery({}, { lowStockOnly: true, groupByBrand: false });
    const params = new URLSearchParams(qs.replace(/^\?/, ""));
    expect(params.get("lowStockOnly")).toBe("1");
    expect(params.has("groupByBrand")).toBe(false);
  });

  it("laat lege strings weg", () => {
    expect(buildPartsQuery({}, { search: "" })).toBe("");
  });
});

// ---------------------------------------------------------------------------
// groupPartsByBrand
// ---------------------------------------------------------------------------

describe("groupPartsByBrand", () => {
  it("groepeert per merk en zet 'universeel' altijd als laatste groep", () => {
    const vespaPart = makePart({ brand: { id: "b-vespa", name: "Vespa" } });
    const kymcoPart = makePart({ brand: { id: "b-kymco", name: "Kymco" } });
    const universalPart = makePart({ brand: null });

    const groups = groupPartsByBrand([vespaPart, universalPart, kymcoPart]);

    expect(groups.map((g) => g.label)).toEqual([
      "Kymco",
      "Vespa",
      "Universeel (geen merk)",
    ]);
    expect(groups[0].items).toEqual([kymcoPart]);
    expect(groups[2].items).toEqual([universalPart]);
  });

  it("houdt alle onderdelen van hetzelfde merk in één groep, in oorspronkelijke volgorde", () => {
    const brand = { id: "b-1", name: "Piaggio" };
    const first = makePart({ brand, name: "A" });
    const second = makePart({ brand, name: "B" });

    const groups = groupPartsByBrand([first, second]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual([first, second]);
  });

  it("geeft een lege lijst terug voor een lege invoer", () => {
    expect(groupPartsByBrand([])).toEqual([]);
  });
});
