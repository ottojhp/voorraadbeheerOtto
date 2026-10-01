import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  canArchiveSupplier,
  toSupplierDetailDTO,
  toSupplierPartDTO,
} from "@/lib/queries/suppliers";
import { supplierFormSchema } from "@/lib/validation/suppliers";

describe("supplierFormSchema", () => {
  it("weigert een lege naam", () => {
    const result = supplierFormSchema.safeParse({
      name: "",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      notes: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.name?.[0]).toBe(
        "Naam is verplicht",
      );
    }
  });

  it("weigert een naam die alleen uit spaties bestaat", () => {
    const result = supplierFormSchema.safeParse({
      name: "   ",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      notes: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.name?.[0]).toBe(
        "Naam is verplicht",
      );
    }
  });

  it("weigert een ongeldig e-mailadres", () => {
    const result = supplierFormSchema.safeParse({
      name: "Onderdelen BV",
      contactPerson: "",
      phone: "",
      email: "geen-emailadres",
      address: "",
      notes: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email?.[0]).toBe(
        "Voer een geldig e-mailadres in",
      );
    }
  });

  it("staat een leeg e-mailveld toe", () => {
    const result = supplierFormSchema.safeParse({
      name: "Onderdelen BV",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeNull();
    }
  });

  it("accepteert een geldig e-mailadres", () => {
    const result = supplierFormSchema.safeParse({
      name: "Onderdelen BV",
      contactPerson: "",
      phone: "",
      email: "info@onderdelenbv.nl",
      address: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("info@onderdelenbv.nl");
    }
  });

  it("zet lege optionele velden om naar null, niet naar een lege string", () => {
    const result = supplierFormSchema.safeParse({
      name: "Onderdelen BV",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contactPerson).toBeNull();
      expect(result.data.phone).toBeNull();
      expect(result.data.address).toBeNull();
      expect(result.data.notes).toBeNull();
    }
  });

  it("trimt whitespace rondom ingevulde velden", () => {
    const result = supplierFormSchema.safeParse({
      name: "  Onderdelen BV  ",
      contactPerson: "  Jan Jansen  ",
      phone: "",
      email: "",
      address: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Onderdelen BV");
      expect(result.data.contactPerson).toBe("Jan Jansen");
    }
  });
});

describe("canArchiveSupplier (archiveerregel)", () => {
  it("staat archiveren toe bij 0 actieve onderdelen", () => {
    expect(canArchiveSupplier(0)).toBe(true);
  });

  it("weigert archiveren bij 1 of meer actieve onderdelen", () => {
    expect(canArchiveSupplier(1)).toBe(false);
    expect(canArchiveSupplier(5)).toBe(false);
  });
});

describe("DTO-mappers (SPEC §3 regel 1: geen Decimal/Date naar client components)", () => {
  it("toSupplierPartDTO zet een Prisma Decimal om naar number", () => {
    const dto = toSupplierPartDTO({
      id: "part-1",
      name: "Remblok voorzijde",
      sku: "SKU-001",
      stockQuantity: 4,
      minStock: 2,
      salePriceIncl: new Prisma.Decimal("19.99"),
    });

    expect(dto.salePriceIncl).toBe(19.99);
    expect(typeof dto.salePriceIncl).toBe("number");
  });

  it("toSupplierDetailDTO zet Decimal- en Date-velden om naar number/ISO-string", () => {
    const createdAt = new Date("2026-01-15T10:00:00.000Z");
    const updatedAt = new Date("2026-02-20T08:30:00.000Z");

    const dto = toSupplierDetailDTO({
      id: "supplier-1",
      name: "Scooterparts Nederland",
      contactPerson: "Jan Jansen",
      phone: "0201234567",
      email: "info@scooterparts.nl",
      address: "Voorbeeldstraat 1\n1234 AB Amsterdam",
      notes: null,
      archivedAt: null,
      createdAt,
      updatedAt,
      parts: [
        {
          id: "part-1",
          name: "Remblok voorzijde",
          sku: "SKU-001",
          stockQuantity: 4,
          minStock: 2,
          salePriceIncl: new Prisma.Decimal("19.99"),
        },
      ],
    });

    expect(dto.createdAt).toBe("2026-01-15T10:00:00.000Z");
    expect(dto.updatedAt).toBe("2026-02-20T08:30:00.000Z");
    expect(dto.archivedAt).toBeNull();
    expect(dto.parts[0].salePriceIncl).toBe(19.99);
    expect(typeof dto.parts[0].salePriceIncl).toBe("number");

    // Geen enkel veld mag nog een Decimal- of Date-object zijn.
    for (const value of Object.values(dto)) {
      expect(value).not.toBeInstanceOf(Date);
      expect(value).not.toBeInstanceOf(Prisma.Decimal);
    }
  });

  it("toSupplierDetailDTO zet een gevulde archivedAt om naar een ISO-string", () => {
    const archivedAt = new Date("2026-03-01T00:00:00.000Z");
    const dto = toSupplierDetailDTO({
      id: "supplier-2",
      name: "Gearchiveerde Leverancier",
      contactPerson: null,
      phone: null,
      email: null,
      address: null,
      notes: null,
      archivedAt,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      parts: [],
    });

    expect(dto.archivedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(dto.parts).toEqual([]);
  });
});
