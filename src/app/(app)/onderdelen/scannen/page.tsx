import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/PageHeader";

import { ScanScreen } from "./ScanScreen";

export const metadata: Metadata = {
  title: "Scannen — Voorraadbeheer",
};

/**
 * Scannen van een artikelnummer of barcode (SPEC §F4, taak T20).
 *
 * Een eigen route en geen overlay op `/onderdelen`, om drie redenen: de scanknop in
 * de navigatie kan dan een gewone link zijn, de pagina is deelbaar en met de
 * terugknop te verlaten, en het zware werk (camera, tekstherkenning) zit in een
 * aparte clientbundle die alleen geladen wordt als iemand echt gaat scannen — het
 * voorraadoverzicht blijft daardoor even licht als het was.
 *
 * Deze server component haalt zelf GEEN data op. Dat is bewust: wat er opgezocht
 * moet worden is pas bekend als de camera iets gelezen heeft, en dat loopt via de
 * server actions in `../scan-actions`.
 */
export default function ScanPage() {
  return (
    <div>
      <PageHeader
        title="Scannen"
        description="Lees een barcode of artikelnummer van de verpakking en pas direct de voorraad aan."
        actions={
          <Link
            href="/onderdelen"
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50"
          >
            Naar voorraad
          </Link>
        }
      />
      <ScanScreen />
    </div>
  );
}
