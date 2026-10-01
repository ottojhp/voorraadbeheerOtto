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
    purchasePriceExcl: "10,00",
    salePriceIncl: "19,99",
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
      validInput({ purchasePriceExcl: "-5,00" }),
    );
    expect(result.success).toBe(false);
  });

  it("weigert een negatieve verkoopprijs", () => {
    const result = partFormSchema.safeParse(validInput({ salePriceIncl: "-1" }));
    expect(result.success).toBe(false);
  });

  it("weigert meer dan 2 decimalen bij een prijs", () => {
    const result = partFormSchema.safeParse(
      validInput({ salePriceIncl: "19,999" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.salePriceIncl?.[0]).toContain(
        "2 decimalen",
      );
    }
  });

  it('accepteert "12,50" (komma) als bedrag en normaliseert naar 12.5', () => {
    const result = partFormSchema.safeParse(
      validInput({ purchasePriceExcl: "12,50" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchasePriceExcl).toBe(12.5);
    }
  });

  it('accepteert "12.50" (punt) als bedrag', () => {
    const result = partFormSchema.safeParse(
      validInput({ purchasePriceExcl: "12.50" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchasePriceExcl).toBe(12.5);
    }
  });

  // -------------------------------------------------------------------------
  // De incl./excl.-schakelaar bij de inkoopprijs (T18)
  // -------------------------------------------------------------------------

  it("slaat het ingetypte bedrag ongewijzigd op bij mode 'excl'", () => {
    const result = partFormSchema.safeParse(
      validInput({ purchasePriceExcl: "10,00", purchasePriceVatMode: "excl" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchasePriceExcl).toBe(10);
    }
  });

  it("rekent bij mode 'incl' server-side terug naar excl. btw", () => {
    // 12,10 incl. bij 21% is exact 10,00 excl.
    const result = partFormSchema.safeParse(
      validInput({
        purchasePriceExcl: "12,10",
        purchasePriceVatMode: "incl",
        vatRate: "21",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchasePriceExcl).toBe(10);
    }
  });

  it("gebruikt bij het terugrekenen het ingevulde btw-tarief, niet 21", () => {
    // 109,00 incl. bij 9% btw is 100,00 excl. Zou het schema hier 21% pakken, dan
    // kwam er 90,08 uit en was de inkoopprijs ruim 10% te laag.
    const result = partFormSchema.safeParse(
      validInput({
        purchasePriceExcl: "109,00",
        purchasePriceVatMode: "incl",
        vatRate: "9",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchasePriceExcl).toBe(100);
    }
  });

  it("behandelt een ontbrekende keuze als 'excl' (de veilige kant)", () => {
    const input = validInput();
    expect("purchasePriceVatMode" in input).toBe(false);
    const result = partFormSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      // Ongewijzigd: bij 'excl' wordt er niets omgerekend.
      expect(result.data.purchasePriceExcl).toBe(10);
    }
  });

  it("behandelt een lege keuze als 'excl'", () => {
    const result = partFormSchema.safeParse(
      validInput({ purchasePriceExcl: "10,00", purchasePriceVatMode: "" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.purchasePriceExcl).toBe(10);
    }
  });

  it("weigert een onbekende keuze in plaats van die als 'excl' te behandelen", () => {
    const result = partFormSchema.safeParse(
      validInput({ purchasePriceVatMode: "inclusief" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.flatten().fieldErrors.purchasePriceVatMode?.[0],
      ).toContain("inclusief of exclusief btw");
    }
  });

  it("laat de verkoopprijs ongemoeid: die wordt altijd incl. btw opgeslagen", () => {
    // De drie bedragen uit T18 waarbij de oude excl.-opslag een cent verloor.
    for (const bedrag of ["10,00", "19,99", "24,95"]) {
      const result = partFormSchema.safeParse(
        validInput({ salePriceIncl: bedrag, purchasePriceVatMode: "incl" }),
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.salePriceIncl).toBe(Number(bedrag.replace(",", ".")));
      }
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
