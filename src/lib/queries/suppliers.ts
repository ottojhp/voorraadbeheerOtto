/**
 * Datalaag voor leveranciers (SPEC §F5, taak T13).
 *
 * SPEC §3 regel 1 is hier bindend: Prisma geeft `Decimal`- en `Date`-objecten terug,
 * en die mogen NOOIT rechtstreeks een client component in. Elke functie hier mapt
 * daarom naar een plain DTO (`number` voor geld, ISO-string voor datums) vóórdat data
 * de pagina in gaat.
 *
 * Dit bestand definieert zijn eigen types (geen gedeeld types-bestand, in lijn met de
 * opdracht) en importeert bewust niets uit `@/lib/queries/parts.ts` of
 * `@/lib/queries/types.ts` — die worden gelijktijdig door een andere taak gebouwd.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// DTO's
// ---------------------------------------------------------------------------

/** Eén leverancier in het overzicht (`/leveranciers`). */
export interface SupplierListItemDTO {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  /** Aantal gekoppelde onderdelen met `archivedAt = null`. */
  activePartCount: number;
}

/** Eén gekoppeld onderdeel, zoals getoond op de leveranciersdetailpagina. */
export interface SupplierPartDTO {
  id: string;
  name: string;
  sku: string;
  stockQuantity: number;
  minStock: number;
  /** Verkoopprijs INCL. btw — zoals opgeslagen (SPEC §3 regel 0, v2.0). */
  salePriceIncl: number;
}

/** Volledige leverancier met gekoppelde actieve onderdelen, voor de detailpagina. */
export interface SupplierDetailDTO {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  /** ISO-string, of `null` als de leverancier niet gearchiveerd is. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  parts: SupplierPartDTO[];
}

// ---------------------------------------------------------------------------
// Pure mappers (DTO-regel, SPEC §3 regel 1) — geen database nodig, dus los te
// testen in Vitest.
// ---------------------------------------------------------------------------

/** Accepteert zowel een Prisma `Decimal` als een kaal getal, voor het gemak in tests. */
type DecimalLike = Prisma.Decimal | number;

function decimalToNumber(value: DecimalLike): number {
  return typeof value === "number" ? value : value.toNumber();
}

/** Brongegevens voor {@link toSupplierPartDTO}, losstaand van een echte Prisma-query. */
export interface SupplierPartSource {
  id: string;
  name: string;
  sku: string;
  stockQuantity: number;
  minStock: number;
  salePriceIncl: DecimalLike;
}

export function toSupplierPartDTO(part: SupplierPartSource): SupplierPartDTO {
  return {
    id: part.id,
    name: part.name,
    sku: part.sku,
    stockQuantity: part.stockQuantity,
    minStock: part.minStock,
    salePriceIncl: decimalToNumber(part.salePriceIncl),
  };
}

/** Brongegevens voor {@link toSupplierDetailDTO}, losstaand van een echte Prisma-query. */
export interface SupplierDetailSource {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  parts: SupplierPartSource[];
}

export function toSupplierDetailDTO(
  supplier: SupplierDetailSource,
): SupplierDetailDTO {
  return {
    id: supplier.id,
    name: supplier.name,
    contactPerson: supplier.contactPerson,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    notes: supplier.notes,
    archivedAt: supplier.archivedAt ? supplier.archivedAt.toISOString() : null,
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
    parts: supplier.parts.map(toSupplierPartDTO),
  };
}

/**
 * Pure archiveerregel (SPEC §F5): een leverancier mag alleen gearchiveerd worden als
 * er geen actieve (niet-gearchiveerde) onderdelen meer aan gekoppeld zijn. Los te
 * testen zonder database; de server action controleert dit ook echt server-side vóór
 * het schrijven van `archivedAt`.
 */
export function canArchiveSupplier(activePartCount: number): boolean {
  return activePartCount === 0;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Alle niet-gearchiveerde leveranciers, met het aantal gekoppelde ACTIEVE onderdelen
 * (onderdelen met `archivedAt = null`). Gebruikt de gefilterde relatie-`_count` van
 * Prisma zodat de aggregatie in de database gebeurt.
 */
export async function listSuppliers(): Promise<SupplierListItemDTO[]> {
  const suppliers = await prisma.supplier.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      contactPerson: true,
      phone: true,
      email: true,
      _count: {
        select: {
          parts: { where: { archivedAt: null } },
        },
      },
    },
  });

  return suppliers.map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    contactPerson: supplier.contactPerson,
    phone: supplier.phone,
    email: supplier.email,
    activePartCount: supplier._count.parts,
  }));
}

/**
 * Eén leverancier met de gekoppelde ACTIEVE onderdelen (naam, sku, voorraad,
 * minimumvoorraad, verkoopprijs), voor de detailpagina. Geeft `null` als de
 * leverancier niet bestaat. Gearchiveerde leveranciers worden hier bewust NIET
 * uitgefilterd — een directe link naar een gearchiveerde leverancier blijft werken,
 * alleen het overzicht (`listSuppliers`) sluit ze uit.
 */
export async function getSupplierById(
  id: string,
): Promise<SupplierDetailDTO | null> {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      contactPerson: true,
      phone: true,
      email: true,
      address: true,
      notes: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      parts: {
        where: { archivedAt: null },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          sku: true,
          stockQuantity: true,
          minStock: true,
          salePriceIncl: true,
        },
      },
    },
  });

  if (!supplier) {
    return null;
  }

  return toSupplierDetailDTO(supplier);
}

/**
 * Aantal actieve (niet-gearchiveerde) onderdelen dat aan een leverancier gekoppeld
 * is. Gebruikt door de archiveer-server action om de harde regel server-side af te
 * dwingen (SPEC §F5).
 */
export async function countActivePartsForSupplier(id: string): Promise<number> {
  return prisma.part.count({
    where: { supplierId: id, archivedAt: null },
  });
}
