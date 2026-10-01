import type { Metadata } from "next";

import { PageHeader } from "@/components/PageHeader";
import {
  findPartByBarcode,
  getPartById,
  searchPartsForSale,
} from "@/lib/queries/parts";
import type { PartDTO, PartSaleOptionDTO } from "@/lib/queries/types";

import { RecentSalesCard } from "./RecentSalesCard";
import { SaleScreen } from "./SaleScreen";

export const metadata: Metadata = {
  title: "Verkoop registreren — Voorraadbeheer",
};

/** Aantal regels in "laatste verkopen" onder het verkoopscherm. */
const RECENT_SALES_LIMIT = 5;

interface SearchParams {
  /** Vrije zoekterm. */
  q?: string | string[];
  /** Gekozen onderdeel. */
  partId?: string | string[];
  /** Zojuist gescande code. */
  scan?: string | string[];
}

/** Next geeft een herhaalde parameter als array terug; we gebruiken de eerste waarde. */
function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }
  return value?.trim() ?? "";
}

/**
 * `PartDTO` (volledig onderdeel) → `PartSaleOptionDTO`, het beknopte type dat het
 * verkoopscherm gebruikt. Zo krijgt de client altijd dezelfde vorm, of het onderdeel
 * nu uit een zoekopdracht, uit een barcode of uit `?partId=` komt.
 */
function toSaleOption(part: PartDTO): PartSaleOptionDTO {
  return {
    id: part.id,
    name: part.name,
    brandName: part.brand?.name ?? null,
    category: part.category,
    sku: part.sku,
    barcode: part.barcode,
    stockQuantity: part.stockQuantity,
    salePriceIncl: part.salePriceIncl,
    vatRate: part.vatRate,
    salePriceExcl: part.salePriceExcl,
  };
}

/**
 * Verkoop registreren (SPEC §F4, T12) — het belangrijkste baliescherm.
 *
 * Deze server component doet al het lezen via de bestaande datalaag
 * (`@/lib/queries/parts`) en geeft plain DTO's door aan `SaleScreen`. De
 * schermtoestand staat in de URL:
 *
 * - `?q=` — zoekterm (naam, sku of barcode, alleen niet-gearchiveerde onderdelen);
 * - `?scan=` — zojuist gescande code; precies één match selecteert direct, anders
 *   komt de code terug in een melding;
 * - `?partId=` — het gekozen onderdeel; de voorraad die de balie ziet komt zo bij
 *   elke render vers uit de database.
 */
export default async function VerkoopPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = first(params.q);
  const partId = first(params.partId);
  const scan = first(params.scan);

  let selectedPart: PartSaleOptionDTO | null = null;
  let results: PartSaleOptionDTO[] = [];
  let scanMiss: string | null = null;
  let notice: string | null = null;

  if (scan) {
    // Eerst de exacte barcode (die is uniek en sluit gearchiveerde onderdelen uit).
    const byBarcode = await findPartByBarcode(scan);
    if (byBarcode) {
      selectedPart = toSaleOption(byBarcode);
    } else {
      // Sommige codes op de schappen zijn het artikelnummer zelf; precies één
      // match telt nog steeds als "direct selecteren", meer dan één niet.
      const matches = await searchPartsForSale(scan);
      if (matches.length === 1) {
        selectedPart = matches[0];
      } else {
        scanMiss = scan;
        results = matches;
      }
    }
  } else if (partId) {
    const part = await getPartById(partId);
    if (!part) {
      notice = "Dit onderdeel bestaat niet (meer). Zoek of scan het opnieuw.";
    } else if (part.archivedAt !== null) {
      // Gearchiveerde onderdelen zijn niet selecteerbaar (SPEC §3 regel 4).
      notice = `"${part.name}" is gearchiveerd en kan niet verkocht worden.`;
    } else {
      selectedPart = toSaleOption(part);
    }
  } else if (query) {
    results = await searchPartsForSale(query);
  }

  return (
    <>
      <PageHeader
        title="Verkoop registreren"
        description="Scan of zoek een onderdeel, kies het aantal en bevestig. De voorraad wordt direct bijgewerkt."
      />

      <SaleScreen
        query={query}
        results={results}
        selectedPart={selectedPart}
        scanMiss={scanMiss}
        notice={notice}
      />

      <div className="mt-6">
        {/* Eigen component met eigen foutafhandeling: faalt het ophalen van de
            historie, dan blijft zoeken, scannen en verkopen hierboven werken. */}
        <RecentSalesCard limit={RECENT_SALES_LIMIT} />
      </div>
    </>
  );
}
