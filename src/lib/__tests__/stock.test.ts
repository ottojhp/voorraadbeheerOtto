/**
 * Tests voor de voorraad-datalaag (`src/lib/queries/stock.ts`) en het bijbehorende
 * Zod-schema (`src/lib/validation/stock.ts`), T19.
 *
 * Alles draait tegen een gemockte Prisma-client, net als in `sales.test.ts`.
 * `prisma.$transaction` geeft de mock-transactieclient door aan de callback, precies
 * zoals Prisma dat doet; een fout uit die callback laten we doorborrelen, want dat is
 * exact wat een rollback in de praktijk veroorzaakt.
 *
 * Wat hier NIET te testen is en alleen op echt Postgres blijkt: dat de rollback
 * daadwerkelijk plaatsvindt, en dat de voorwaardelijke `UPDATE` bij twee
 * gelijktijdige wijzigingen precies één winnaar oplevert. Wat hier WEL getest wordt
 * is dat de voorwaarden in de WHERE-clause terechtkomen (en niet alleen in een
 * `if` ervoor), want dat is het verschil tussen veilig en niet veilig.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  StockAdjustmentError,
  adjustStock,
  isStockAdjustmentError,
  sumStockMutationDeltas,
} from "@/lib/queries/stock";
import {
  MAX_STOCK_DELTA,
  MAX_STOCK_NOTE_LENGTH,
  stockAdjustmentSchema,
} from "@/lib/validation/stock";

// ---------------------------------------------------------------------------
// Gemockte Prisma-client
// ---------------------------------------------------------------------------

const { prismaMock, txMock } = vi.hoisted(() => {
  const txMock = {
    part: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    stockMutation: {
      create: vi.fn(),
    },
  };

  const prismaMock = {
    $transaction: vi.fn(async (run: (tx: typeof txMock) => unknown) => run(txMock)),
    stockMutation: {
      aggregate: vi.fn(),
    },
  };

  return { prismaMock, txMock };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock, default: prismaMock }));

// ---------------------------------------------------------------------------
// Testdata en hulpjes
// ---------------------------------------------------------------------------

/** Het onderdeel zoals `adjustStock` het in stap 1 leest. */
function partRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "part_1",
    name: "Remblokset voor",
    stockQuantity: 8,
    minStock: 3,
    archivedAt: null,
    ...overrides,
  };
}

/**
 * Zet een geslaagd verloop klaar: stap 1 leest het onderdeel, de voorwaardelijke
 * update raakt één rij, stap 3 leest de nieuwe stand, stap 4 schrijft de regel.
 */
function arrangeSuccess(options: {
  part?: ReturnType<typeof partRow>;
  /** De stand die stap 3 teruggeeft; standaard `part.stockQuantity`. */
  afterQuantity: number;
  afterMinStock?: number;
  updatedCount?: number;
  mutationId?: string;
}) {
  const part = options.part ?? partRow();

  txMock.part.findUnique
    .mockResolvedValueOnce(part)
    .mockResolvedValueOnce({
      stockQuantity: options.afterQuantity,
      minStock: options.afterMinStock ?? part.minStock,
    });
  txMock.part.updateMany.mockResolvedValue({ count: options.updatedCount ?? 1 });
  txMock.stockMutation.create.mockResolvedValue({
    id: options.mutationId ?? "mut_1",
  });

  return part;
}

/** Vangt de verwachte `StockAdjustmentError` en geeft hem terug. */
async function captureError(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Er werd een fout verwacht, maar de aanroep slaagde.");
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(
    async (run: (tx: typeof txMock) => unknown) => run(txMock),
  );
});

// ---------------------------------------------------------------------------
// Zod-schema
// ---------------------------------------------------------------------------

describe("stockAdjustmentSchema", () => {
  it("accepteert een relatieve wijziging van +1 met reden correctie", () => {
    const parsed = stockAdjustmentSchema.safeParse({
      mode: "relative",
      partId: "part_1",
      delta: 1,
      reason: "CORRECTION",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.mode === "relative") {
      expect(parsed.data.delta).toBe(1);
      expect(parsed.data.reason).toBe("CORRECTION");
      // Geen toelichting meegegeven: `null`, nooit een lege string.
      expect(parsed.data.note).toBeNull();
    }
  });

  it("leest een aantal uit FormData (string) als getal", () => {
    const parsed = stockAdjustmentSchema.safeParse({
      mode: "relative",
      partId: "part_1",
      delta: "10",
      reason: "DELIVERY",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.mode === "relative") {
      expect(parsed.data.delta).toBe(10);
    }
  });

  it("accepteert een negatieve relatieve wijziging", () => {
    const parsed = stockAdjustmentSchema.safeParse({
      mode: "relative",
      partId: "part_1",
      delta: "-3",
      reason: "CORRECTION",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.mode === "relative") {
      expect(parsed.data.delta).toBe(-3);
    }
  });

  it("weigert een wijziging van 0 stuks", () => {
    const parsed = stockAdjustmentSchema.safeParse({
      mode: "relative",
      partId: "part_1",
      delta: 0,
      reason: "CORRECTION",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.delta?.[0]).toBe(
        "Een wijziging van 0 stuks verandert niets",
      );
    }
  });

  it("weigert een gebroken getal als wijziging", () => {
    const parsed = stockAdjustmentSchema.safeParse({
      mode: "relative",
      partId: "part_1",
      delta: 1.5,
      reason: "CORRECTION",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.delta?.[0]).toBe(
        "Aantal moet een heel getal zijn",
      );
    }
  });

  it("geeft bij een leeg aantal 'Vul een aantal in' en niet 'mag niet 0 zijn'", () => {
    const parsed = stockAdjustmentSchema.safeParse({
      mode: "relative",
      partId: "part_1",
      delta: "   ",
      reason: "CORRECTION",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.delta?.[0]).toBe("Vul een aantal in");
    }
  });

  it("geeft bij onzin als aantal een Nederlandse melding", () => {
    const parsed = stockAdjustmentSchema.safeParse({
      mode: "relative",
      partId: "part_1",
      delta: "abc",
      reason: "CORRECTION",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.delta?.[0]).toBe(
        "Vul een geldig aantal in",
      );
    }
  });

  it("weigert een absurd grote wijziging", () => {
    const parsed = stockAdjustmentSchema.safeParse({
      mode: "relative",
      partId: "part_1",
      delta: MAX_STOCK_DELTA + 1,
      reason: "DELIVERY",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepteert een absolute stand van 0", () => {
    const parsed = stockAdjustmentSchema.safeParse({
      mode: "absolute",
      partId: "part_1",
      targetQuantity: "0",
      reason: "COUNT",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.mode === "absolute") {
      expect(parsed.data.targetQuantity).toBe(0);
    }
  });

  it("weigert een negatieve absolute stand (SPEC §3 regel 6)", () => {
    const parsed = stockAdjustmentSchema.safeParse({
      mode: "absolute",
      partId: "part_1",
      targetQuantity: -1,
      reason: "COUNT",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.targetQuantity?.[0]).toBe(
        "Voorraad kan niet onder 0",
      );
    }
  });

  it("weigert een onbekende reden met een Nederlandse melding", () => {
    const parsed = stockAdjustmentSchema.safeParse({
      mode: "relative",
      partId: "part_1",
      delta: 1,
      reason: "ONZIN",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.reason?.[0]).toBe(
        "Kies een reden: levering, correctie of telling",
      );
    }
  });

  it("staat SALE, WORKSHOP en INITIAL niet toe als handmatige reden", () => {
    for (const reason of ["SALE", "WORKSHOP", "INITIAL"]) {
      const parsed = stockAdjustmentSchema.safeParse({
        mode: "relative",
        partId: "part_1",
        delta: 1,
        reason,
      });
      expect(parsed.success, `reason ${reason} hoort geweigerd te worden`).toBe(false);
    }
  });

  it("maakt van een lege toelichting `null` en trimt een gevulde", () => {
    const empty = stockAdjustmentSchema.safeParse({
      mode: "relative",
      partId: "part_1",
      delta: 1,
      reason: "DELIVERY",
      note: "   ",
    });
    expect(empty.success && empty.data.note).toBeNull();

    const filled = stockAdjustmentSchema.safeParse({
      mode: "relative",
      partId: "part_1",
      delta: 1,
      reason: "DELIVERY",
      note: "  pakbon 2026-4471  ",
    });
    expect(filled.success && filled.data.note).toBe("pakbon 2026-4471");
  });

  it("weigert een te lange toelichting", () => {
    const parsed = stockAdjustmentSchema.safeParse({
      mode: "relative",
      partId: "part_1",
      delta: 1,
      reason: "DELIVERY",
      note: "x".repeat(MAX_STOCK_NOTE_LENGTH + 1),
    });

    expect(parsed.success).toBe(false);
  });

  it("weigert een ontbrekend onderdeel-id en een onbekende modus", () => {
    expect(
      stockAdjustmentSchema.safeParse({
        mode: "relative",
        partId: "  ",
        delta: 1,
        reason: "DELIVERY",
      }).success,
    ).toBe(false);

    expect(
      stockAdjustmentSchema.safeParse({
        mode: "iets-anders",
        partId: "part_1",
        delta: 1,
        reason: "DELIVERY",
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// adjustStock — relatieve wijzigingen
// ---------------------------------------------------------------------------

describe("adjustStock — relatief", () => {
  it("boekt +1 bij met een RELATIEVE update en schrijft een CORRECTION-regel", async () => {
    arrangeSuccess({ afterQuantity: 9 });

    const result = await adjustStock({
      mode: "relative",
      partId: "part_1",
      delta: 1,
      reason: "CORRECTION",
    });

    // De update is relatief (`increment`), niet "zet op de waarde die ik las".
    // Dit is wat twee snelle tikken +2 laat worden in plaats van +1.
    expect(txMock.part.updateMany).toHaveBeenCalledWith({
      where: { id: "part_1", archivedAt: null },
      data: { stockQuantity: { increment: 1 } },
    });

    expect(txMock.stockMutation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          partId: "part_1",
          delta: 1,
          quantityBefore: 8,
          quantityAfter: 9,
          reason: "CORRECTION",
        }),
      }),
    );

    expect(result).toMatchObject({
      changed: true,
      delta: 1,
      quantityBefore: 8,
      quantityAfter: 9,
      reason: "CORRECTION",
      mutationId: "mut_1",
    });
  });

  it("zet bij een VERLAGING de ondergrens in de WHERE-clause", async () => {
    arrangeSuccess({ afterQuantity: 7 });

    await adjustStock({
      mode: "relative",
      partId: "part_1",
      delta: -1,
      reason: "CORRECTION",
    });

    // De voorwaarde staat in de WHERE, niet alleen in een `if` ervoor: anders kan
    // een tweede telefoon tussen lezen en schrijven de voorraad leeghalen.
    expect(txMock.part.updateMany).toHaveBeenCalledWith({
      where: {
        id: "part_1",
        archivedAt: null,
        stockQuantity: { gte: 1 },
      },
      // Ook een verlaging gaat als één relatieve `increment` met een negatieve
      // waarde: `stockQuantity = stockQuantity + (-1)`.
      data: { stockQuantity: { increment: -1 } },
    });
  });

  it("boekt een levering van 10 stuks bij met reden DELIVERY en de toelichting", async () => {
    arrangeSuccess({ afterQuantity: 18 });

    const result = await adjustStock({
      mode: "relative",
      partId: "part_1",
      delta: "10",
      reason: "DELIVERY",
      note: "pakbon 2026-4471",
    });

    expect(txMock.stockMutation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          delta: 10,
          quantityBefore: 8,
          quantityAfter: 18,
          reason: "DELIVERY",
          note: "pakbon 2026-4471",
        }),
      }),
    );
    expect(result.delta).toBe(10);
  });

  it("weigert een verlaging die onder 0 zou uitkomen en wijzigt niets", async () => {
    txMock.part.findUnique.mockResolvedValueOnce(partRow({ stockQuantity: 0 }));

    const error = await captureError(() =>
      adjustStock({
        mode: "relative",
        partId: "part_1",
        delta: -1,
        reason: "CORRECTION",
      }),
    );

    expect(isStockAdjustmentError(error)).toBe(true);
    expect((error as StockAdjustmentError).code).toBe("INSUFFICIENT_STOCK");
    expect((error as StockAdjustmentError).message).toContain("niet onder 0");
    expect((error as StockAdjustmentError).availableStock).toBe(0);
    // Geen update en geen grootboekregel: er is niets half gebeurd.
    expect(txMock.part.updateMany).not.toHaveBeenCalled();
    expect(txMock.stockMutation.create).not.toHaveBeenCalled();
  });

  it("geeft een nette fout als de voorwaardelijke update 0 rijen raakt (verloren race)", async () => {
    txMock.part.findUnique.mockResolvedValueOnce(partRow({ stockQuantity: 2 }));
    txMock.part.updateMany.mockResolvedValue({ count: 0 });

    const error = await captureError(() =>
      adjustStock({
        mode: "relative",
        partId: "part_1",
        delta: -2,
        reason: "CORRECTION",
      }),
    );

    expect((error as StockAdjustmentError).code).toBe("STOCK_CHANGED");
    expect((error as StockAdjustmentError).message).toContain(
      "door iemand anders gewijzigd",
    );
    // Cruciaal: geen grootboekregel bij een mislukte update. Het gooien draait in
    // Postgres de hele transactie terug.
    expect(txMock.stockMutation.create).not.toHaveBeenCalled();
  });

  it("leidt quantityBefore af uit de stand ná de update, niet uit de eerste lezing", async () => {
    // Tussen stap 1 (las 8) en de update kwam er een levering van 6 binnen: de
    // werkelijke stand ná onze +1 is 15. De grootboekregel moet dan 14 → 15 zijn,
    // niet 8 → 9.
    arrangeSuccess({ afterQuantity: 15 });

    const result = await adjustStock({
      mode: "relative",
      partId: "part_1",
      delta: 1,
      reason: "CORRECTION",
    });

    expect(result.quantityBefore).toBe(14);
    expect(result.quantityAfter).toBe(15);
    expect(txMock.stockMutation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantityBefore: 14, quantityAfter: 15 }),
      }),
    );
  });

  it("markeert de nieuwe stand als lage voorraad zodra die onder het minimum komt", async () => {
    arrangeSuccess({
      part: partRow({ stockQuantity: 4, minStock: 3 }),
      afterQuantity: 3,
    });

    const result = await adjustStock({
      mode: "relative",
      partId: "part_1",
      delta: -1,
      reason: "CORRECTION",
    });

    expect(result.isLowStock).toBe(true);
    expect(result.minStock).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// adjustStock — absolute stand
// ---------------------------------------------------------------------------

describe("adjustStock — exact aantal instellen", () => {
  it("gebruikt een compare-and-set op de gelezen stand", async () => {
    arrangeSuccess({ afterQuantity: 30 });

    const result = await adjustStock({
      mode: "absolute",
      partId: "part_1",
      targetQuantity: 30,
      reason: "COUNT",
    });

    expect(txMock.part.updateMany).toHaveBeenCalledWith({
      where: { id: "part_1", archivedAt: null, stockQuantity: 8 },
      data: { stockQuantity: 30 },
    });
    expect(result).toMatchObject({
      changed: true,
      delta: 22,
      quantityBefore: 8,
      quantityAfter: 30,
      reason: "COUNT",
    });
    expect(txMock.stockMutation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ delta: 22, reason: "COUNT" }),
      }),
    );
  });

  it("boekt een negatief verschil als de telling lager uitvalt", async () => {
    arrangeSuccess({ afterQuantity: 5 });

    const result = await adjustStock({
      mode: "absolute",
      partId: "part_1",
      targetQuantity: 5,
      reason: "COUNT",
    });

    expect(result.delta).toBe(-3);
  });

  it("wijzigt en schrijft niets als de gestelde stand al klopt", async () => {
    txMock.part.findUnique.mockResolvedValueOnce(partRow({ stockQuantity: 8 }));

    const result = await adjustStock({
      mode: "absolute",
      partId: "part_1",
      targetQuantity: 8,
      reason: "COUNT",
    });

    expect(result).toMatchObject({
      changed: false,
      delta: 0,
      quantityBefore: 8,
      quantityAfter: 8,
      reason: null,
      mutationId: null,
    });
    expect(txMock.part.updateMany).not.toHaveBeenCalled();
    // `delta` mag niet 0 zijn (CHECK-constraint uit T17): geen regel dus.
    expect(txMock.stockMutation.create).not.toHaveBeenCalled();
  });

  it("weigert het instellen als iemand anders de stand net wijzigde", async () => {
    txMock.part.findUnique.mockResolvedValueOnce(partRow({ stockQuantity: 8 }));
    txMock.part.updateMany.mockResolvedValue({ count: 0 });

    const error = await captureError(() =>
      adjustStock({
        mode: "absolute",
        partId: "part_1",
        targetQuantity: 30,
        reason: "COUNT",
      }),
    );

    expect((error as StockAdjustmentError).code).toBe("STOCK_CHANGED");
    expect(txMock.stockMutation.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// adjustStock — overige gevallen
// ---------------------------------------------------------------------------

describe("adjustStock — randgevallen", () => {
  it("weigert ongeldige invoer zonder de database aan te raken", async () => {
    const error = await captureError(() =>
      adjustStock({
        mode: "relative",
        partId: "part_1",
        delta: 0,
        reason: "CORRECTION",
      }),
    );

    expect((error as StockAdjustmentError).code).toBe("INVALID_INPUT");
    expect((error as StockAdjustmentError).fieldErrors?.delta).toBe(
      "Een wijziging van 0 stuks verandert niets",
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("meldt een onbekend onderdeel", async () => {
    txMock.part.findUnique.mockResolvedValueOnce(null);

    const error = await captureError(() =>
      adjustStock({
        mode: "relative",
        partId: "weg",
        delta: 1,
        reason: "CORRECTION",
      }),
    );

    expect((error as StockAdjustmentError).code).toBe("PART_NOT_FOUND");
    expect(txMock.part.updateMany).not.toHaveBeenCalled();
  });

  it("weigert een gearchiveerd onderdeel (SPEC §3 regel 4)", async () => {
    txMock.part.findUnique.mockResolvedValueOnce(
      partRow({ archivedAt: new Date("2026-09-01T00:00:00.000Z") }),
    );

    const error = await captureError(() =>
      adjustStock({
        mode: "relative",
        partId: "part_1",
        delta: 1,
        reason: "CORRECTION",
      }),
    );

    expect((error as StockAdjustmentError).code).toBe("PART_ARCHIVED");
    expect(txMock.part.updateMany).not.toHaveBeenCalled();
  });

  it("doet de voorraadwijziging en de grootboekregel in één transactie", async () => {
    arrangeSuccess({ afterQuantity: 9 });

    await adjustStock({
      mode: "relative",
      partId: "part_1",
      delta: 1,
      reason: "CORRECTION",
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    // Beide schrijfacties lopen via de transactieclient, niet via `prisma` zelf.
    expect(txMock.part.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.stockMutation.create).toHaveBeenCalledTimes(1);
  });

  it("laat een mislukte grootboekregel de hele wijziging terugdraaien", async () => {
    txMock.part.findUnique
      .mockResolvedValueOnce(partRow())
      .mockResolvedValueOnce({ stockQuantity: 9, minStock: 3 });
    txMock.part.updateMany.mockResolvedValue({ count: 1 });
    txMock.stockMutation.create.mockRejectedValue(
      new Error("check constraint violated"),
    );

    await expect(
      adjustStock({
        mode: "relative",
        partId: "part_1",
        delta: 1,
        reason: "CORRECTION",
      }),
    ).rejects.toThrow("check constraint violated");
  });

  it("gooit als de nieuwe stand niet terug te lezen is, in plaats van hem te gokken", async () => {
    txMock.part.findUnique
      .mockResolvedValueOnce(partRow())
      .mockResolvedValueOnce(null);
    txMock.part.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      adjustStock({
        mode: "relative",
        partId: "part_1",
        delta: 1,
        reason: "CORRECTION",
      }),
    ).rejects.toThrow("niet leesbaar");
    expect(txMock.stockMutation.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// isStockAdjustmentError
// ---------------------------------------------------------------------------

describe("isStockAdjustmentError", () => {
  it("herkent een echte fout en een fout die zijn prototype kwijt is", () => {
    expect(
      isStockAdjustmentError(new StockAdjustmentError("STOCK_CHANGED", "test")),
    ).toBe(true);

    // Zoals een fout die door een serialisatiestap is gegaan: geen prototype meer,
    // maar wel dezelfde vorm.
    expect(
      isStockAdjustmentError({
        name: "StockAdjustmentError",
        code: "STOCK_CHANGED",
        message: "test",
      }),
    ).toBe(true);
  });

  it("herkent andere fouten niet", () => {
    expect(isStockAdjustmentError(new Error("gewoon kapot"))).toBe(false);
    expect(isStockAdjustmentError(null)).toBe(false);
    expect(isStockAdjustmentError("STOCK_CHANGED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sumStockMutationDeltas
// ---------------------------------------------------------------------------

describe("sumStockMutationDeltas", () => {
  it("telt alle delta's van één onderdeel op", async () => {
    prismaMock.stockMutation.aggregate.mockResolvedValue({ _sum: { delta: 42 } });

    await expect(sumStockMutationDeltas("part_1")).resolves.toBe(42);
    expect(prismaMock.stockMutation.aggregate).toHaveBeenCalledWith({
      where: { partId: "part_1" },
      _sum: { delta: true },
    });
  });

  it("geeft 0 als er nog geen mutaties zijn", async () => {
    prismaMock.stockMutation.aggregate.mockResolvedValue({ _sum: { delta: null } });

    await expect(sumStockMutationDeltas("part_1")).resolves.toBe(0);
  });
});
