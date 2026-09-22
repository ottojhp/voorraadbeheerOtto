/**
 * Tests voor de dubbele-barcodecontrole (`src/lib/queries/barcode-lookup.ts`, T11).
 *
 * Puur gemockte Prisma-client, geen echte database (SPEC §3: geen integratietests in
 * deze omgeving). Dekt de drie gevallen uit de acceptatiecriteria: lege/ontbrekende
 * barcode, een barcode van een ANDER onderdeel (conflict) en een barcode van het
 * onderdeel zelf tijdens het bewerken (geen conflict — de valkuil van deze taak).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    part: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock, default: prismaMock }));

import { findBarcodeConflict } from "@/lib/queries/barcode-lookup";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findBarcodeConflict", () => {
  it("geeft null bij een lege barcode, zonder de database te bevragen", async () => {
    const result = await findBarcodeConflict("");
    expect(result).toBeNull();
    expect(prismaMock.part.findFirst).not.toHaveBeenCalled();
  });

  it("geeft null bij een barcode van alleen witruimte", async () => {
    const result = await findBarcodeConflict("   ");
    expect(result).toBeNull();
    expect(prismaMock.part.findFirst).not.toHaveBeenCalled();
  });

  it("geeft null bij een ontbrekende barcode (null/undefined)", async () => {
    expect(await findBarcodeConflict(null)).toBeNull();
    expect(await findBarcodeConflict(undefined)).toBeNull();
    expect(prismaMock.part.findFirst).not.toHaveBeenCalled();
  });

  it("geeft het andere onderdeel terug als de barcode al in gebruik is", async () => {
    prismaMock.part.findFirst.mockResolvedValue({
      id: "part_2",
      name: "Remblokset achter",
    });

    const result = await findBarcodeConflict("8712345678901");

    expect(result).toEqual({ id: "part_2", name: "Remblokset achter" });
    expect(prismaMock.part.findFirst).toHaveBeenCalledWith({
      where: { barcode: "8712345678901" },
      select: { id: true, name: true },
    });
  });

  it("trimt de barcode vóór het zoeken", async () => {
    prismaMock.part.findFirst.mockResolvedValue(null);

    await findBarcodeConflict("  8712345678901  ");

    expect(prismaMock.part.findFirst).toHaveBeenCalledWith({
      where: { barcode: "8712345678901" },
      select: { id: true, name: true },
    });
  });

  it("sluit het eigen onderdeel-id uit (bewerken van een onderdeel met zijn eigen barcode geeft geen conflict)", async () => {
    // De database-query zelf sluit part_1 uit; met alleen part_1 als houder van
    // deze barcode levert `findFirst` dan niets op.
    prismaMock.part.findFirst.mockResolvedValue(null);

    const result = await findBarcodeConflict("8712345678901", "part_1");

    expect(result).toBeNull();
    expect(prismaMock.part.findFirst).toHaveBeenCalledWith({
      where: { barcode: "8712345678901", id: { not: "part_1" } },
      select: { id: true, name: true },
    });
  });

  it("geeft nog steeds het conflict van een ANDER onderdeel terug als excludePartId is meegegeven", async () => {
    prismaMock.part.findFirst.mockResolvedValue({
      id: "part_2",
      name: "Remblokset achter",
    });

    const result = await findBarcodeConflict("8712345678901", "part_1");

    expect(result).toEqual({ id: "part_2", name: "Remblokset achter" });
    expect(prismaMock.part.findFirst).toHaveBeenCalledWith({
      where: { barcode: "8712345678901", id: { not: "part_1" } },
      select: { id: true, name: true },
    });
  });
});
