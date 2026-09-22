/**
 * Datalaag voor merken (`Brand`), taak T09.
 *
 * SPEC §3 regel 1 is hier bindend: Prisma geeft `Date`-objecten terug, en die mogen
 * NOOIT een client component in. Elke functie hier geeft daarom uitsluitend plain
 * objects terug (`BrandDTO`), met datums als ISO-string.
 *
 * Dit bestand definieert zijn eigen DTO-types (niet `src/lib/queries/types.ts`, dat
 * eigendom is van een andere taak).
 */

import { prisma } from "@/lib/db";

/** Eén merk als plain object. */
export interface BrandDTO {
  id: string;
  name: string;
  /** ISO-string. */
  createdAt: string;
  /** ISO-string. */
  updatedAt: string;
}

/** Merk met het aantal gekoppelde ACTIEVE (niet-gearchiveerde) onderdelen. */
export interface BrandWithPartCountDTO extends BrandDTO {
  partCount: number;
}

/** Aantal onderdelen gekoppeld aan een merk, actief en totaal (incl. gearchiveerd). */
export interface BrandPartCounts {
  /** Aantal niet-gearchiveerde onderdelen, getoond in het overzicht. */
  active: number;
  /** Aantal onderdelen ongeacht archiefstatus; bepalend voor de verwijderregel. */
  total: number;
}

function toBrandDTO(brand: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}): BrandDTO {
  return {
    id: brand.id,
    name: brand.name,
    createdAt: brand.createdAt.toISOString(),
    updatedAt: brand.updatedAt.toISOString(),
  };
}

/**
 * Alle merken alfabetisch, met het aantal gekoppelde ACTIEVE onderdelen
 * (`archivedAt = null`).
 */
export async function listBrandsWithPartCounts(): Promise<
  BrandWithPartCountDTO[]
> {
  const brands = await prisma.brand.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { parts: { where: { archivedAt: null } } },
      },
    },
  });

  return brands.map((brand) => ({
    ...toBrandDTO(brand),
    partCount: brand._count.parts,
  }));
}

/** Eén merk op id, of `null` als het niet bestaat. */
export async function getBrandById(id: string): Promise<BrandDTO | null> {
  const brand = await prisma.brand.findUnique({ where: { id } });
  return brand ? toBrandDTO(brand) : null;
}

/**
 * Eén merk op exacte naam, of `null`. Gebruikt voor de voorafgaande
 * duplicaatcontrole bij aanmaken/hernoemen — de database-constraint
 * (`Brand.name @unique`) blijft de uiteindelijke waarheid voor gelijktijdige
 * aanvragen.
 */
export async function findBrandByName(name: string): Promise<BrandDTO | null> {
  const brand = await prisma.brand.findUnique({ where: { name } });
  return brand ? toBrandDTO(brand) : null;
}

/**
 * Aantal onderdelen gekoppeld aan een merk. `total` telt ook gearchiveerde
 * onderdelen mee — dat aantal bepaalt of een merk verwijderd mag worden
 * (SPEC/T09: "ook geen gearchiveerde").
 */
export async function countPartsForBrand(
  brandId: string,
): Promise<BrandPartCounts> {
  const [active, total] = await Promise.all([
    prisma.part.count({ where: { brandId, archivedAt: null } }),
    prisma.part.count({ where: { brandId } }),
  ]);

  return { active, total };
}
