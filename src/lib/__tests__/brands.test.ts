import { describe, expect, it } from "vitest";
import {
  createBrandSchema,
  DUPLICATE_BRAND_NAME_ERROR,
  deleteBrandSchema,
  evaluateBrandDeletion,
  isRecordNotFoundError,
  isUniqueConstraintViolation,
  renameBrandSchema,
} from "@/lib/validation/brands";

describe("createBrandSchema", () => {
  it("weigert een lege naam", () => {
    const result = createBrandSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("weigert een naam met alleen spaties", () => {
    const result = createBrandSchema.safeParse({ name: "    " });
    expect(result.success).toBe(false);
  });

  it("trimt de naam", () => {
    const result = createBrandSchema.safeParse({ name: "  Vespa  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Vespa");
    }
  });

  it("accepteert een geldige naam", () => {
    const result = createBrandSchema.safeParse({ name: "Piaggio" });
    expect(result.success).toBe(true);
  });

  it("weigert een naam die te lang is", () => {
    const result = createBrandSchema.safeParse({ name: "a".repeat(200) });
    expect(result.success).toBe(false);
  });
});

describe("renameBrandSchema", () => {
  it("weigert een lege naam bij hernoemen", () => {
    const result = renameBrandSchema.safeParse({ id: "brand-1", name: "" });
    expect(result.success).toBe(false);
  });

  it("weigert een naam met alleen spaties bij hernoemen", () => {
    const result = renameBrandSchema.safeParse({
      id: "brand-1",
      name: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("trimt de naam bij hernoemen", () => {
    const result = renameBrandSchema.safeParse({
      id: "brand-1",
      name: " NIU ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("NIU");
    }
  });

  it("weigert een ontbrekend id", () => {
    const result = renameBrandSchema.safeParse({ id: "", name: "NIU" });
    expect(result.success).toBe(false);
  });
});

describe("deleteBrandSchema", () => {
  it("weigert een ontbrekend id", () => {
    const result = deleteBrandSchema.safeParse({ id: "" });
    expect(result.success).toBe(false);
  });

  it("accepteert een geldig id", () => {
    const result = deleteBrandSchema.safeParse({ id: "brand-1" });
    expect(result.success).toBe(true);
  });
});

describe("evaluateBrandDeletion (verwijderregel als pure functie)", () => {
  it("staat verwijderen toe zonder gekoppelde onderdelen", () => {
    const result = evaluateBrandDeletion(0);
    expect(result.allowed).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it("blokkeert verwijderen bij gekoppelde onderdelen en noemt het aantal", () => {
    const result = evaluateBrandDeletion(3);
    expect(result.allowed).toBe(false);
    expect(result.message).toContain("3");
  });

  it("gebruikt correct enkelvoud bij precies 1 gekoppeld onderdeel", () => {
    const result = evaluateBrandDeletion(1);
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/\b1 onderdeel\b/);
    expect(result.message).not.toMatch(/onderdelen/);
  });

  it("gebruikt meervoud bij meerdere gekoppelde onderdelen", () => {
    const result = evaluateBrandDeletion(5);
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/\b5 onderdelen\b/);
  });
});

describe("isUniqueConstraintViolation (P2002-foutvertaler, geen database)", () => {
  it("herkent een Prisma P2002-fout", () => {
    expect(isUniqueConstraintViolation({ code: "P2002" })).toBe(true);
  });

  it("herkent geen andere Prisma-foutcode", () => {
    expect(isUniqueConstraintViolation({ code: "P2025" })).toBe(false);
  });

  it("herkent geen willekeurige fout of lege waarde", () => {
    expect(isUniqueConstraintViolation(new Error("iets anders"))).toBe(false);
    expect(isUniqueConstraintViolation(null)).toBe(false);
    expect(isUniqueConstraintViolation(undefined)).toBe(false);
    expect(isUniqueConstraintViolation("P2002")).toBe(false);
  });
});

describe("isRecordNotFoundError", () => {
  it("herkent een Prisma P2025-fout", () => {
    expect(isRecordNotFoundError({ code: "P2025" })).toBe(true);
  });

  it("herkent geen P2002-fout", () => {
    expect(isRecordNotFoundError({ code: "P2002" })).toBe(false);
  });
});

describe("DUPLICATE_BRAND_NAME_ERROR", () => {
  it("is een duidelijke Nederlandse melding over een dubbele naam", () => {
    expect(DUPLICATE_BRAND_NAME_ERROR).toMatch(/bestaat al/i);
    expect(DUPLICATE_BRAND_NAME_ERROR).toMatch(/merk/i);
  });
});
