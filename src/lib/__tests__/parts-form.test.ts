import { describe, expect, it } from "vitest";

import {
  DUPLICATE_BARCODE_ERROR,
  DUPLICATE_SKU_ERROR,
  fieldErrorFromUniqueConstraint,
  partFormSchema,
} from "@/lib/validation/parts";

/** Bouwt een geldige basisinvoer, met overschrijfbare velden per test. */
function validInput(overrides: Record<string, string> = {}) {
  return {
    name: "Remblok voorzijde",
    sku: "SKU-001",
    category: "SCOOTER_PART",
    brandId: "",
    supplierId: "",
    barcode: "",
    description: "",
    fitsModels: "",
    location: "",
    purchasePrice: "10,00",
    salePrice: "19,99",
    vatRate: "21",
    stockQuantity: "5",
    minStock: "2",
    ...overrides,
  };
}

describe("partFormSchema", () => {
  it("weigert een lege naam", () => {
    const result = partFormSchema.safeParse(validInput({ name: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.name?.[0]).toBe(
        "Naam is verplicht",
      );
    }
  });

  it("weigert een naam die alleen uit spaties bestaat", () => {
    const result = partFormSchema.safeParse(validInput({ name: "   " }));
    expect(result.success).toBe(false);
  });

  it("weigert een lege sku", () => {
    const result = partFormSchema.safeParse(validInput({ sku: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.sku?.[0]).toBe(
        "SKU is verplicht",
      );
    }
  });

  it("weigert een ongeldige categorie", () => {
    const result = partFormSchema.safeParse(
      validInput({ category: "GEEN_BESTAANDE_CATEGORIE" }),
    );
    expect(result.success).toBe(false);
  });

  it("weigert een negatieve inkoopprijs", () => {
    const result = partFormSchema.safeParse(
      validInput({ purchasePrice: "-5,00" }),
    );
    expect(result.success).toBe(false);
  });

  it("weigert een negatieve verkoopprijs", () => {
    const result = partFormSchema.safeParse(validInput({ salePrice: "-1" }));
    expect(result.success).toBe(false);
  });

  it("weigert meer dan 2 decimalen bij een prijs", () => {
    const result = partFormSchema.safeParse(
      validInput({ salePrice: "19,999" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.salePrice?.[0]).toContain(
        "2 decimalen",
      );
    }
  });

  it('accepteert "12,50" (komma) als bedrag en normaliseert naar 12.5', () => {
    const result = partFormSchema.safeParse(
      validInput({ purchasePrice: "12,50" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchasePrice).toBe(12.5);
    }
  });

  it('accepteert "12.50" (punt) als bedrag', () => {
    const result = partFormSchema.safeParse(
      validInput({ purchasePrice: "12.50" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchasePrice).toBe(12.5);
    }
  });

  it("valt terug op 21 als het btw-tarief leeg is", () => {
    const result = partFormSchema.safeParse(validInput({ vatRate: "" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.vatRate).toBe(21);
    }
  });

  it("weigert een niet-geheel aantal voor voorraad", () => {
    const result = partFormSchema.safeParse(
      validInput({ stockQuantity: "5,5" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.stockQuantity?.[0]).toContain(
        "geheel getal",
      );
    }
  });

  it("weigert een negatief aantal voor minimumvoorraad", () => {
    const result = partFormSchema.safeParse(validInput({ minStock: "-1" }));
    expect(result.success).toBe(false);
  });

  it("staat een leeg merk toe (universeel onderdeel)", () => {
    const result = partFormSchema.safeParse(validInput({ brandId: "" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.brandId).toBeNull();
    }
  });

  it("staat een lege leverancier toe", () => {
    const result = partFormSchema.safeParse(validInput({ supplierId: "" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.supplierId).toBeNull();
    }
  });

  it('zet een lege barcode om naar `null`, niet naar ""', () => {
    const result = partFormSchema.safeParse(validInput({ barcode: "" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.barcode).toBeNull();
      expect(result.data.barcode).not.toBe("");
    }
  });

  it("behoudt een ingevulde barcode", () => {
    const result = partFormSchema.safeParse(
      validInput({ barcode: "  8710123456789  " }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.barcode).toBe("8710123456789");
    }
  });

  it("accepteert een volledig geldig formulier", () => {
    const result = partFormSchema.safeParse(validInput());
    expect(result.success).toBe(true);
  });
});

describe("fieldErrorFromUniqueConstraint (P2002 → veld + melding)", () => {
  it("herkent een dubbele sku via meta.target als array", () => {
    const error = { code: "P2002", meta: { target: ["sku"] } };
    const result = fieldErrorFromUniqueConstraint(error);
    expect(result).toEqual({ field: "sku", message: DUPLICATE_SKU_ERROR });
  });

  it("herkent een dubbele barcode via meta.target als array", () => {
    const error = { code: "P2002", meta: { target: ["barcode"] } };
    const result = fieldErrorFromUniqueConstraint(error);
    expect(result).toEqual({
      field: "barcode",
      message: DUPLICATE_BARCODE_ERROR,
    });
  });

  it("herkent een dubbele sku via een constraintnaam als string", () => {
    const error = { code: "P2002", meta: { target: "Part_sku_key" } };
    const result = fieldErrorFromUniqueConstraint(error);
    expect(result).toEqual({ field: "sku", message: DUPLICATE_SKU_ERROR });
  });

  it("herkent een dubbele barcode via een constraintnaam als string", () => {
    const error = { code: "P2002", meta: { target: "Part_barcode_key" } };
    const result = fieldErrorFromUniqueConstraint(error);
    expect(result).toEqual({
      field: "barcode",
      message: DUPLICATE_BARCODE_ERROR,
    });
  });

  it("geeft null terug voor een andere Prisma-foutcode", () => {
    const error = { code: "P2025", meta: { target: ["sku"] } };
    expect(fieldErrorFromUniqueConstraint(error)).toBeNull();
  });

  it("geeft null terug voor een niet-Prisma-fout", () => {
    expect(fieldErrorFromUniqueConstraint(new Error("iets anders"))).toBeNull();
  });

  it("geeft null terug als target geen sku/barcode bevat", () => {
    const error = { code: "P2002", meta: { target: ["name"] } };
    expect(fieldErrorFromUniqueConstraint(error)).toBeNull();
  });
});
