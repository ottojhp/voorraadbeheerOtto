/**
 * Tests voor de pure UI-logica achter de snelle voorraadknoppen
 * (`src/app/(app)/onderdelen/stock-state.ts`), T19.
 *
 * Deze functies zitten met opzet NIET in het client component: dan zouden ze alleen
 * in een browser te testen zijn, en juist de optimistische rekenregel ("twee keer
 * tikken is +2") is een rekenregel die zonder browser bewijsbaar hoort te zijn.
 */

import { describe, expect, it } from "vitest";

import {
  applyPendingStockChange,
  buildUndoInput,
  buildUndoNote,
  describeStockChange,
  stuksLabel,
} from "@/app/(app)/onderdelen/stock-state";
import type { StockAdjustmentResultDTO } from "@/lib/queries/types";

function successResult(
  overrides: Partial<StockAdjustmentResultDTO> = {},
): StockAdjustmentResultDTO {
  return {
    partId: "part_1",
    partName: "Remblokset voor",
    changed: true,
    delta: 1,
    quantityBefore: 8,
    quantityAfter: 9,
    minStock: 3,
    isLowStock: false,
    reason: "CORRECTION",
    mutationId: "mut_1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Optimistische stand
// ---------------------------------------------------------------------------

describe("applyPendingStockChange", () => {
  it("telt één wijziging bij de stand op", () => {
    expect(applyPendingStockChange(8, { id: 1, delta: 1 })).toBe(9);
    expect(applyPendingStockChange(8, { id: 1, delta: -1 })).toBe(7);
    expect(applyPendingStockChange(8, { id: 1, delta: 10 })).toBe(18);
  });

  it("levert +2 op bij twee snel achter elkaar toegepaste tikken", () => {
    // Dit is precies wat React met de wachtrij van `useOptimistic` doet: elke nog
    // niet bevestigde wijziging wordt op de vorige uitkomst toegepast. Een reducer
    // die "zet op de waarde die ik zag" zou hier 9 opleveren en dus een tik
    // verliezen.
    const changes = [
      { id: 1, delta: 1 },
      { id: 2, delta: 1 },
    ];
    const result = changes.reduce(applyPendingStockChange, 8);

    expect(result).toBe(10);
  });

  it("blijft ook bij vijf snelle tikken kloppen", () => {
    const changes = [1, 1, 1, 1, 1].map((delta, index) => ({
      id: index + 1,
      delta,
    }));

    expect(changes.reduce(applyPendingStockChange, 0)).toBe(5);
  });

  it("laat de stand nooit onder 0 zakken", () => {
    // SPEC §3 regel 6 geldt ook voor wat er even op het scherm staat. De server
    // weigert zo'n verlaging alsnog, waarna de stand terugspringt.
    expect(applyPendingStockChange(0, { id: 1, delta: -1 })).toBe(0);
    expect(applyPendingStockChange(1, { id: 1, delta: -5 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Teksten
// ---------------------------------------------------------------------------

describe("stuksLabel", () => {
  it("gebruikt enkelvoud bij 1 en meervoud daarbuiten", () => {
    expect(stuksLabel(1)).toBe("1 stuk");
    expect(stuksLabel(0)).toBe("0 stuks");
    expect(stuksLabel(10)).toBe("10 stuks");
  });
});

describe("describeStockChange", () => {
  it("noemt de reden, het aantal en zowel de oude als de nieuwe stand", () => {
    expect(describeStockChange(successResult())).toBe(
      "Correctie: 1 stuk bijgeboekt. Voorraad 8 → 9.",
    );
  });

  it("zegt 'afgeboekt' bij een verlaging", () => {
    expect(
      describeStockChange(
        successResult({ delta: -2, quantityBefore: 8, quantityAfter: 6 }),
      ),
    ).toBe("Correctie: 2 stuks afgeboekt. Voorraad 8 → 6.");
  });

  it("gebruikt het Nederlandse label van de gekozen reden", () => {
    expect(
      describeStockChange(
        successResult({
          reason: "DELIVERY",
          delta: 10,
          quantityBefore: 8,
          quantityAfter: 18,
        }),
      ),
    ).toBe("Levering: 10 stuks bijgeboekt. Voorraad 8 → 18.");

    expect(
      describeStockChange(
        successResult({
          reason: "COUNT",
          delta: 22,
          quantityBefore: 8,
          quantityAfter: 30,
        }),
      ),
    ).toBe("Telling: 22 stuks bijgeboekt. Voorraad 8 → 30.");
  });

  it("meldt duidelijk dat er niets gewijzigd is als de stand al klopte", () => {
    expect(
      describeStockChange(
        successResult({
          changed: false,
          delta: 0,
          quantityBefore: 8,
          quantityAfter: 8,
          reason: null,
          mutationId: null,
        }),
      ),
    ).toBe("De voorraad stond al op 8 stuks; er is niets gewijzigd.");
  });
});

describe("buildUndoNote", () => {
  it("verwijst naar de mutatie die teruggedraaid wordt", () => {
    expect(buildUndoNote(successResult({ reason: "DELIVERY", delta: 10 }))).toBe(
      "Ongedaan gemaakt: levering van +10 stuks (mutatie mut_1).",
    );
  });

  it("werkt ook zonder mutatie-id", () => {
    expect(
      buildUndoNote(successResult({ delta: -1, mutationId: null })),
    ).toBe("Ongedaan gemaakt: correctie van -1 stuks.");
  });
});

// ---------------------------------------------------------------------------
// Ongedaan maken
// ---------------------------------------------------------------------------

describe("buildUndoInput", () => {
  it("maakt een NIEUWE tegengestelde RELATIEVE mutatie met reden CORRECTION", () => {
    const undo = buildUndoInput(
      successResult({ reason: "DELIVERY", delta: 10, quantityAfter: 18 }),
    );

    expect(undo).toEqual({
      mode: "relative",
      partId: "part_1",
      delta: -10,
      reason: "CORRECTION",
      note: "Ongedaan gemaakt: levering van +10 stuks (mutatie mut_1).",
    });
  });

  it("draait ook een verlaging terug", () => {
    const undo = buildUndoInput(successResult({ delta: -3 }));

    expect(undo?.delta).toBe(3);
    expect(undo?.mode).toBe("relative");
  });

  it("zet de voorraad NIET terug op de oude stand", () => {
    // Een "zet terug op 8"-mutatie zou een verkoop die er tussendoor kwam
    // stilletjes wegpoetsen. De tegenboeking is daarom relatief.
    const undo = buildUndoInput(
      successResult({ delta: 22, quantityBefore: 8, quantityAfter: 30 }),
    );

    expect(undo).not.toHaveProperty("targetQuantity");
    expect(undo?.delta).toBe(-22);
  });

  it("geeft null als er niets te herstellen is", () => {
    expect(
      buildUndoInput(
        successResult({ changed: false, delta: 0, reason: null, mutationId: null }),
      ),
    ).toBeNull();
  });
});
