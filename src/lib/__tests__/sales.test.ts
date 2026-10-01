/**
 * Tests voor de verkoop-datalaag (`src/lib/queries/sales.ts`) en het bijbehorende
 * Zod-schema (`src/lib/validation/sales.ts`), SPEC §F4 / T12.
 *
 * Er is in deze omgeving geen database, dus alles draait tegen een gemockte
 * Prisma-client. `prisma.$transaction` geeft de mock-transactieclient door aan de
 * callback, precies zoals Prisma dat doet; een fout uit die callback laten we gewoon
 * doorborrelen, want dat is exact wat een rollback in de praktijk veroorzaakt.
 *
 * Wat hier NIET getest kan worden en alleen op echt Postgres blijkt: dat de rollback
 * ook daadwerkelijk plaatsvindt, en dat de voorwaardelijke `UPDATE` bij twee
 * gelijktijdige verkopen precies één winnaar oplevert.
 */

import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RECENT_SALES_LIMIT,
  MAX_RECENT_SALES_LIMIT,
  SaleError,
  isSaleError,
  listRecentSales,
  registerSale,
  type SaleErrorCode,
} from "@/lib/queries/sales";
import {
  MAX_SALE_QUANTITY,
  saleSchema,
  type SaleInput,
} from "@/lib/validation/sales";

// ---------------------------------------------------------------------------
// Gemockte Prisma-client
// ---------------------------------------------------------------------------

const { prismaMock, txMock } = vi.hoisted(() => {
  const txMock = {
    part: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    sale: {
      create: vi.fn(),
    },
    stockMutation: {
      create: vi.fn(),
    },
  };

  const prismaMock = {
    $transaction: vi.fn(async (run: (tx: typeof txMock) => unknown) =>
      run(txMock),
    ),
    sale: {
      findMany: vi.fn(),
    },
  };

  return { prismaMock, txMock };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock, default: prismaMock }));

// ---------------------------------------------------------------------------
// Testdata en hulpjes
// ---------------------------------------------------------------------------

const SOLD_AT = new Date("2026-09-22T09:15:00.000Z");

/** Het onderdeel zoals `registerSale` het binnen de transactie leest. */
function partRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "part_1",
    name: "Remblokset voor",
    sku: "REM-001",
    stockQuantity: 8,
    purchasePriceExcl: new Prisma.Decimal("12.50"),
    // INCL. btw (datamodel v2): 30,19 incl. is 24,95 excl. bij 21%.
    salePriceIncl: new Prisma.Decimal("30.19"),
    vatRate: new Prisma.Decimal("21.00"),
    archivedAt: null,
    brand: { name: "Vespa" },
    ...overrides,
  };
}

/** Zet een geslaagd verloop klaar: lezen → voorwaardelijke update → verkoop → herlezen. */
function arrangeSuccess(options: {
  part?: ReturnType<typeof partRow>;
  newStock: number;
  saleId?: string;
}) {
  const part = options.part ?? partRow();
  txMock.part.findUnique
    .mockResolvedValueOnce(part)
    .mockResolvedValueOnce({ stockQuantity: options.newStock });
  txMock.part.updateMany.mockResolvedValue({ count: 1 });
  txMock.sale.create.mockResolvedValue({
    id: options.saleId ?? "sale_1",
    soldAt: SOLD_AT,
  });
  txMock.stockMutation.create.mockResolvedValue({ id: "mut_1" });
  return part;
}

/** Roept `registerSale` aan en geeft de fout terug in plaats van hem te gooien. */
async function captureError(input: SaleInput): Promise<unknown> {
  return registerSale(input).then(
    () => null,
    (error: unknown) => error,
  );
}

function expectSaleError(error: unknown, code: SaleErrorCode): SaleError {
  expect(isSaleError(error)).toBe(true);
  const saleError = error as SaleError;
  expect(saleError.code).toBe(code);
  // Elke fout moet een toonbare Nederlandse melding hebben.
  expect(saleError.message.length).toBeGreaterThan(0);
  return saleError;
}

/** De argumenten waarmee `sale.create` is aangeroepen. */
function saleCreateData(): Record<string, unknown> {
  const call = txMock.sale.create.mock.calls[0]?.[0] as
    | { data: Record<string, unknown> }
    | undefined;
  expect(call).toBeDefined();
  return call!.data;
}

/** De argumenten waarmee `stockMutation.create` is aangeroepen. */
function stockMutationData(): Record<string, unknown> {
  const call = txMock.stockMutation.create.mock.calls[0]?.[0] as
    | { data: Record<string, unknown> }
    | undefined;
  expect(call).toBeDefined();
  return call!.data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Succespaden
// ---------------------------------------------------------------------------

describe("registerSale — succespad balie", () => {
  it("verlaagt de voorraad en legt de verkoop vast in één transactie", async () => {
    arrangeSuccess({ newStock: 6 });

    const { sale } = await registerSale({
      partId: "part_1",
      quantity: 2,
      channel: "COUNTER",
    });

    // SPEC §3 regel 5: alles binnen één transactie.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    // De voorraad wordt VOORWAARDELIJK verlaagd: de controle staat in de
    // WHERE-clause, zodat twee gelijktijdige verkopen elkaar niet kunnen inhalen.
    expect(txMock.part.updateMany).toHaveBeenCalledWith({
      where: {
        id: "part_1",
        archivedAt: null,
        stockQuantity: { gte: 2 },
      },
      data: { stockQuantity: { decrement: 2 } },
    });

    // SPEC §3 regel 3: historische prijzen en btw-tarief uit het onderdeel.
    const data = saleCreateData();
    expect(data.partId).toBe("part_1");
    expect(data.quantity).toBe(2);
    // De prijzen gaan ONGEWIJZIGD mee: verkoop incl. btw, inkoop excl. btw. Een
    // tussentijdse omrekening zou hier een cent kunnen kosten (SPEC §3 regel 0).
    expect(String(data.salePriceInclAtSale)).toBe("30.19");
    expect(String(data.purchasePriceExclAtSale)).toBe("12.5");
    expect(String(data.vatRateAtSale)).toBe("21");
    expect(data.channel).toBe("COUNTER");
    expect(data.reference).toBeNull();

    // Het resultaat bevat de NIEUWE voorraadstand voor de bevestiging.
    expect(sale.newStockQuantity).toBe(6);
    expect(sale.saleId).toBe("sale_1");
    expect(sale.partName).toBe("Remblokset voor");
    expect(sale.brandName).toBe("Vespa");
    expect(sale.quantity).toBe(2);
    expect(sale.salePriceInclAtSale).toBe(30.19);
    expect(sale.salePriceExclAtSale).toBe(24.95);
    expect(sale.vatRateAtSale).toBe(21);
    expect(sale.lineTotalExclVat).toBeCloseTo(49.9, 2);
    // Het incl.-totaal is een exacte vermenigvuldiging van het betaalde bedrag.
    expect(sale.lineTotalInclVat).toBe(60.38);
    expect(sale.soldAt).toBe(SOLD_AT.toISOString());
  });

  it("geeft alleen plain waarden terug: geen Decimal en geen Date", async () => {
    arrangeSuccess({ newStock: 7 });

    const { sale } = await registerSale({
      partId: "part_1",
      quantity: 1,
      channel: "COUNTER",
    });

    expect(typeof sale.salePriceInclAtSale).toBe("number");
    expect(typeof sale.salePriceExclAtSale).toBe("number");
    expect(typeof sale.vatRateAtSale).toBe("number");
    expect(typeof sale.soldAt).toBe("string");
    expect(sale.salePriceInclAtSale).not.toBeInstanceOf(Prisma.Decimal);
  });

  it("negeert een referentie bij een baliesverkoop", async () => {
    arrangeSuccess({ newStock: 7 });

    const { sale } = await registerSale({
      partId: "part_1",
      quantity: 1,
      channel: "COUNTER",
      reference: "WO-2026-0412",
    });

    expect(saleCreateData().reference).toBeNull();
    expect(sale.reference).toBeNull();
  });
});

describe("registerSale — succespad werkplaats", () => {
  it("legt kanaal WORKSHOP en de werkorderreferentie vast", async () => {
    arrangeSuccess({ newStock: 5, saleId: "sale_ws" });

    const { sale } = await registerSale({
      partId: "part_1",
      quantity: 3,
      channel: "WORKSHOP",
      reference: "  WO-2026-0412  ",
    });

    const data = saleCreateData();
    expect(data.channel).toBe("WORKSHOP");
    expect(data.reference).toBe("WO-2026-0412");
    expect(data.quantity).toBe(3);

    expect(sale.channel).toBe("WORKSHOP");
    expect(sale.reference).toBe("WO-2026-0412");
    expect(sale.newStockQuantity).toBe(5);

    // Werkplaatsverbruik verlaagt de voorraad op precies dezelfde manier.
    expect(txMock.part.updateMany).toHaveBeenCalledWith({
      where: { id: "part_1", archivedAt: null, stockQuantity: { gte: 3 } },
      data: { stockQuantity: { decrement: 3 } },
    });
  });
});

// ---------------------------------------------------------------------------
// Weigeringen
// ---------------------------------------------------------------------------

describe("registerSale — te weinig voorraad", () => {
  it("weigert de verkoop, schrijft niets en noemt de werkelijke voorraad", async () => {
    txMock.part.findUnique.mockResolvedValueOnce(partRow({ stockQuantity: 2 }));

    const error = await captureError({
      partId: "part_1",
      quantity: 5,
      channel: "COUNTER",
    });

    const saleError = expectSaleError(error, "INSUFFICIENT_STOCK");
    expect(saleError.availableStock).toBe(2);
    expect(saleError.requestedQuantity).toBe(5);
    expect(saleError.message).toContain("2");

    // Geen voorraadmutatie en geen verkoopregel: SPEC §3 regel 6.
    expect(txMock.part.updateMany).not.toHaveBeenCalled();
    expect(txMock.sale.create).not.toHaveBeenCalled();
  });

  it("weigert ook als de voorraad precies één stuk tekortkomt", async () => {
    txMock.part.findUnique.mockResolvedValueOnce(partRow({ stockQuantity: 1 }));

    const error = await captureError({
      partId: "part_1",
      quantity: 2,
      channel: "COUNTER",
    });

    expectSaleError(error, "INSUFFICIENT_STOCK");
    expect(txMock.sale.create).not.toHaveBeenCalled();
  });
});

describe("registerSale — gearchiveerd onderdeel", () => {
  it("weigert de verkoop en schrijft niets", async () => {
    txMock.part.findUnique.mockResolvedValueOnce(
      partRow({ archivedAt: new Date("2026-05-01T00:00:00.000Z") }),
    );

    const error = await captureError({
      partId: "part_1",
      quantity: 1,
      channel: "COUNTER",
    });

    const saleError = expectSaleError(error, "PART_ARCHIVED");
    expect(saleError.message).toContain("Remblokset voor");
    expect(txMock.part.updateMany).not.toHaveBeenCalled();
    expect(txMock.sale.create).not.toHaveBeenCalled();
  });
});

describe("registerSale — onderdeel bestaat niet", () => {
  it("geeft PART_NOT_FOUND", async () => {
    txMock.part.findUnique.mockResolvedValueOnce(null);

    const error = await captureError({
      partId: "weg",
      quantity: 1,
      channel: "COUNTER",
    });

    expectSaleError(error, "PART_NOT_FOUND");
    expect(txMock.sale.create).not.toHaveBeenCalled();
  });
});

describe("registerSale — verloren race", () => {
  it("gooit een nette fout als de voorwaardelijke update 0 rijen raakt", async () => {
    // De transactie leest nog 8 stuks, maar een andere balie commit er vlak voor
    // onze UPDATE 8 weg: de WHERE-clause matcht daardoor geen enkele rij.
    txMock.part.findUnique.mockResolvedValueOnce(partRow());
    txMock.part.updateMany.mockResolvedValue({ count: 0 });

    const error = await captureError({
      partId: "part_1",
      quantity: 2,
      channel: "COUNTER",
    });

    const saleError = expectSaleError(error, "STOCK_CHANGED");
    expect(saleError.message).toContain("Remblokset voor");

    // Geen halve verkoop: de `Sale` wordt niet aangemaakt en de fout laat de
    // transactie terugdraaien.
    expect(txMock.sale.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Voorraadgrootboek (StockMutation) — T22
// ---------------------------------------------------------------------------

describe("registerSale — grootboekregel", () => {
  it("schrijft een SALE-mutatie met kloppende before/after en de saleId", async () => {
    arrangeSuccess({ newStock: 6 });

    await registerSale({ partId: "part_1", quantity: 2, channel: "COUNTER" });

    const data = stockMutationData();
    expect(data.partId).toBe("part_1");
    // Een verkoop haalt voorraad WEG: delta is negatief.
    expect(data.delta).toBe(-2);
    // De stand ná de update is de waarheid (6); de stand ervóór volgt uit het
    // relatieve decrement: 6 + 2 = 8.
    expect(data.quantityAfter).toBe(6);
    expect(data.quantityBefore).toBe(8);
    // De CHECK-constraint in de database eist exact deze gelijkheid.
    expect(data.quantityAfter).toBe(
      (data.quantityBefore as number) + (data.delta as number),
    );
    expect(data.reason).toBe("SALE");
    expect(data.saleId).toBe("sale_1");

    // SPEC §3 regel 5: de mutatie hoort in DEZELFDE transactie als de verkoop.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.stockMutation.create).toHaveBeenCalledTimes(1);
  });

  it("gebruikt reason WORKSHOP bij werkplaatsverbruik en legt de referentie vast", async () => {
    arrangeSuccess({ newStock: 5, saleId: "sale_ws" });

    await registerSale({
      partId: "part_1",
      quantity: 3,
      channel: "WORKSHOP",
      reference: "WO-2026-0412",
    });

    const data = stockMutationData();
    expect(data.reason).toBe("WORKSHOP");
    expect(data.delta).toBe(-3);
    expect(data.quantityAfter).toBe(5);
    expect(data.quantityBefore).toBe(8);
    expect(data.saleId).toBe("sale_ws");
    expect(data.note).toBe("WO-2026-0412");
  });

  it("leidt de stand vóór de mutatie af uit de stand ná de update, niet uit de eerste lezing", async () => {
    // Scenario: tussen de eerste lezing (8 stuks) en onze UPDATE komt er een levering
    // van 4 stuks binnen. De stand ná onze verkoop van 2 is dan 10, niet 6.
    arrangeSuccess({ newStock: 10 });

    const { sale } = await registerSale({
      partId: "part_1",
      quantity: 2,
      channel: "COUNTER",
    });

    const data = stockMutationData();
    // De grootboekregel beschrijft uitsluitend onze eigen mutatie (-2) rond de
    // werkelijke standen (12 → 10), en niet de verouderde 8 uit de eerste lezing.
    expect(data.quantityAfter).toBe(10);
    expect(data.quantityBefore).toBe(12);
    expect(data.delta).toBe(-2);
    expect(sale.newStockQuantity).toBe(10);
  });

  it("draait alles terug als het schrijven van de mutatie faalt", async () => {
    arrangeSuccess({ newStock: 6 });
    txMock.stockMutation.create.mockRejectedValue(
      new Error("grootboek niet beschikbaar"),
    );

    const error = await captureError({
      partId: "part_1",
      quantity: 2,
      channel: "COUNTER",
    });

    // De fout borrelt uit de transactiecallback omhoog; in Postgres betekent dat een
    // ROLLBACK van de voorraadverlaging én de verkoopregel. Er mag nooit een
    // voorraadwijziging zonder grootboekregel overblijven (SPEC §4).
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("grootboek");
  });

  it("gooit en schrijft geen mutatie als de stand na de update niet leesbaar is", async () => {
    // Zou niet kunnen (de UPDATE houdt een rijslot), maar een gok zou een
    // grootboekregel met verzonnen standen opleveren.
    txMock.part.findUnique
      .mockResolvedValueOnce(partRow())
      .mockResolvedValueOnce(null);
    txMock.part.updateMany.mockResolvedValue({ count: 1 });
    txMock.sale.create.mockResolvedValue({ id: "sale_1", soldAt: SOLD_AT });

    const error = await captureError({
      partId: "part_1",
      quantity: 2,
      channel: "COUNTER",
    });

    expect(error).toBeInstanceOf(Error);
    expect(txMock.stockMutation.create).not.toHaveBeenCalled();
  });
});

describe("registerSale — grootboek sluit aan op de voorraad", () => {
  interface MutationRow {
    delta: number;
    quantityBefore: number;
    quantityAfter: number;
    reason: string;
  }

  /**
   * Bewijst het invariant van T22 tegen een piepkleine in-memory "database": de som
   * van alle `delta`'s van een onderdeel is na een verkoop exact gelijk aan zijn
   * `stockQuantity`. De voorraad en het grootboek worden hier door dezelfde
   * nagebootste transactie bijgehouden, dus als `registerSale` de mutatie zou
   * vergeten of met een verkeerde delta zou schrijven, loopt de som uit de pas.
   */
  it("som van alle delta's is gelijk aan de voorraadstand, ook na twee verkopen", async () => {
    const store = {
      stock: 8,
      // Het grootboek opent met de beginstand, precies zoals de seed en
      // `createPartAction` dat doen.
      mutations: [
        { delta: 8, quantityBefore: 0, quantityAfter: 8, reason: "INITIAL" },
      ] as MutationRow[],
    };

    txMock.part.findUnique.mockImplementation(async () =>
      partRow({ stockQuantity: store.stock }),
    );
    txMock.part.updateMany.mockImplementation(
      async (args: { data: { stockQuantity: { decrement: number } } }) => {
        const needed = args.data.stockQuantity.decrement;
        if (store.stock < needed) {
          return { count: 0 };
        }
        store.stock -= needed;
        return { count: 1 };
      },
    );
    let saleCounter = 0;
    txMock.sale.create.mockImplementation(async () => ({
      id: `sale_${++saleCounter}`,
      soldAt: SOLD_AT,
    }));
    txMock.stockMutation.create.mockImplementation(
      async (args: { data: MutationRow }) => {
        store.mutations.push(args.data);
        return { id: `mut_${store.mutations.length}` };
      },
    );

    await registerSale({ partId: "part_1", quantity: 3, channel: "COUNTER" });
    await registerSale({ partId: "part_1", quantity: 2, channel: "WORKSHOP" });

    // 8 - 3 - 2 = 3 stuks op voorraad.
    expect(store.stock).toBe(3);

    const sum = store.mutations.reduce((total, row) => total + row.delta, 0);
    expect(sum).toBe(store.stock);

    // En de keten zelf klopt: elke regel sluit aan op de vorige.
    expect(store.mutations.map((row) => row.delta)).toEqual([8, -3, -2]);
    let running = 0;
    for (const row of store.mutations) {
      expect(row.quantityBefore).toBe(running);
      expect(row.quantityAfter).toBe(row.quantityBefore + row.delta);
      running = row.quantityAfter;
    }
    expect(running).toBe(store.stock);
  });
});

describe("registerSale — ongeldig aantal", () => {
  it("weigert aantal 0 zonder de database aan te raken", async () => {
    const error = await captureError({
      partId: "part_1",
      quantity: 0,
      channel: "COUNTER",
    });

    const saleError = expectSaleError(error, "INVALID_INPUT");
    expect(saleError.fieldErrors?.quantity).toBe("Aantal moet minimaal 1 zijn");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("weigert aantal -1 zonder de database aan te raken", async () => {
    const error = await captureError({
      partId: "part_1",
      quantity: -1,
      channel: "COUNTER",
    });

    expectSaleError(error, "INVALID_INPUT");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("weigert een gebroken aantal en een leeg onderdeel", async () => {
    expectSaleError(
      await captureError({
        partId: "part_1",
        quantity: 1.5,
        channel: "COUNTER",
      }),
      "INVALID_INPUT",
    );
    expectSaleError(
      await captureError({ partId: "", quantity: 1, channel: "COUNTER" }),
      "INVALID_INPUT",
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("accepteert een aantal als string (zoals uit FormData)", async () => {
    arrangeSuccess({ newStock: 5 });

    const { sale } = await registerSale({
      partId: "part_1",
      quantity: "3",
      channel: "COUNTER",
    });

    expect(sale.quantity).toBe(3);
    expect(saleCreateData().quantity).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// listRecentSales
// ---------------------------------------------------------------------------

describe("listRecentSales", () => {
  it("mapt naar plain DTO's: Decimal → number, Date → ISO-string", async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      {
        id: "sale_1",
        partId: "part_1",
        quantity: 2,
        salePriceInclAtSale: new Prisma.Decimal("30.19"),
        vatRateAtSale: new Prisma.Decimal("21.00"),
        channel: "COUNTER",
        reference: null,
        soldAt: SOLD_AT,
        part: { name: "Remblokset voor", sku: "REM-001", brand: { name: "Vespa" } },
      },
      {
        id: "sale_2",
        partId: "part_2",
        quantity: 1,
        salePriceInclAtSale: new Prisma.Decimal("10.89"),
        vatRateAtSale: new Prisma.Decimal("21.00"),
        channel: "WORKSHOP",
        reference: "WO-2026-0412",
        soldAt: SOLD_AT,
        part: { name: "Motorolie 1L", sku: "OLI-001", brand: null },
      },
    ]);

    const sales = await listRecentSales(2);

    expect(sales).toHaveLength(2);
    expect(sales[0]).toEqual({
      id: "sale_1",
      partId: "part_1",
      partName: "Remblokset voor",
      brandName: "Vespa",
      sku: "REM-001",
      quantity: 2,
      channel: "COUNTER",
      reference: null,
      salePriceInclAtSale: 30.19,
      salePriceExclAtSale: 24.95,
      vatRateAtSale: 21,
      lineTotalExclVat: 49.9,
      lineTotalInclVat: 60.38,
      soldAt: SOLD_AT.toISOString(),
    });
    // Universeel onderdeel: geen merk.
    expect(sales[1].brandName).toBeNull();
    expect(sales[1].channel).toBe("WORKSHOP");
    expect(sales[1].reference).toBe("WO-2026-0412");
  });

  it("sorteert nieuwste eerst en begrenst de limit", async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    await listRecentSales();
    expect(prismaMock.sale.findMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: [{ soldAt: "desc" }, { id: "desc" }],
      take: DEFAULT_RECENT_SALES_LIMIT,
    });

    await listRecentSales(10_000);
    expect(prismaMock.sale.findMany.mock.calls[1]?.[0]).toMatchObject({
      take: MAX_RECENT_SALES_LIMIT,
    });

    await listRecentSales(0);
    expect(prismaMock.sale.findMany.mock.calls[2]?.[0]).toMatchObject({
      take: DEFAULT_RECENT_SALES_LIMIT,
    });
  });
});

// ---------------------------------------------------------------------------
// Zod-schema
// ---------------------------------------------------------------------------

describe("saleSchema", () => {
  it("accepteert een geldige baliesverkoop", () => {
    const parsed = saleSchema.safeParse({
      partId: "part_1",
      quantity: 1,
      channel: "COUNTER",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.reference).toBeNull();
  });

  it("weigert aantal 0, -1 en een gebroken getal met Nederlandse meldingen", () => {
    for (const quantity of [0, -1]) {
      const parsed = saleSchema.safeParse({
        partId: "part_1",
        quantity,
        channel: "COUNTER",
      });
      expect(parsed.success).toBe(false);
      expect(
        parsed.success ? [] : parsed.error.flatten().fieldErrors.quantity,
      ).toEqual(["Aantal moet minimaal 1 zijn"]);
    }

    const broken = saleSchema.safeParse({
      partId: "part_1",
      quantity: 2.5,
      channel: "COUNTER",
    });
    expect(broken.success).toBe(false);
    expect(
      broken.success ? [] : broken.error.flatten().fieldErrors.quantity,
    ).toEqual(["Aantal moet een heel getal zijn"]);
  });

  it("geeft een eigen melding bij een leeg of onleesbaar aantal", () => {
    const leeg = saleSchema.safeParse({
      partId: "part_1",
      quantity: "",
      channel: "COUNTER",
    });
    expect(leeg.success ? [] : leeg.error.flatten().fieldErrors.quantity).toEqual(
      ["Vul een aantal in"],
    );

    const onzin = saleSchema.safeParse({
      partId: "part_1",
      quantity: "twee",
      channel: "COUNTER",
    });
    expect(
      onzin.success ? [] : onzin.error.flatten().fieldErrors.quantity,
    ).toEqual(["Vul een geldig aantal in"]);
  });

  it("weigert een aantal boven de bovengrens", () => {
    const parsed = saleSchema.safeParse({
      partId: "part_1",
      quantity: MAX_SALE_QUANTITY + 1,
      channel: "COUNTER",
    });
    expect(parsed.success).toBe(false);
  });

  it("weigert een onbekend kanaal met een Nederlandse melding", () => {
    const parsed = saleSchema.safeParse({
      partId: "part_1",
      quantity: 1,
      channel: "KASSA",
    });
    expect(parsed.success).toBe(false);
    expect(
      parsed.success ? [] : parsed.error.flatten().fieldErrors.channel,
    ).toEqual(["Kies balie of werkplaats"]);
  });

  it("weigert een lege partId", () => {
    const parsed = saleSchema.safeParse({
      partId: "   ",
      quantity: 1,
      channel: "COUNTER",
    });
    expect(parsed.success).toBe(false);
    expect(
      parsed.success ? [] : parsed.error.flatten().fieldErrors.partId,
    ).toEqual(["Kies eerst een onderdeel"]);
  });

  it("trimt de referentie en maakt van leeg null", () => {
    const gevuld = saleSchema.parse({
      partId: "part_1",
      quantity: 1,
      channel: "WORKSHOP",
      reference: "  WO-1  ",
    });
    expect(gevuld.reference).toBe("WO-1");

    const leeg = saleSchema.parse({
      partId: "part_1",
      quantity: 1,
      channel: "WORKSHOP",
      reference: "   ",
    });
    expect(leeg.reference).toBeNull();
  });
});

describe("isSaleError", () => {
  it("herkent een SaleError en niet een gewone Error", () => {
    expect(isSaleError(new SaleError("PART_NOT_FOUND", "weg"))).toBe(true);
    expect(isSaleError(new Error("iets anders"))).toBe(false);
    expect(isSaleError(null)).toBe(false);
  });
});
