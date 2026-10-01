/**
 * Tests voor de teksten en beslisregels van het scanscherm (T20).
 *
 * Puur, net als `./stock-ui.test.ts`: hier staat geen camera en geen database bij,
 * alleen de vraag "hoe hard is dit bewijs en wat zegt het scherm erover".
 */

import { describe, expect, it } from "vitest";

import {
  SCAN_FIELD_LABELS,
  SCAN_KIND_LABELS,
  SCAN_SOURCE_LABELS,
  describeScanCertainty,
  describeScanMatch,
  describeScanOutcome,
  isStrongMatch,
} from "@/app/(app)/onderdelen/scan-state";
import type { PartScanDTO, PartScanMatchDTO } from "@/lib/queries/types";

const PART: PartScanDTO = {
  id: "p1",
  name: "Remblokset voor Piaggio Zip",
  brandName: "Piaggio",
  category: "SCOOTER_PART",
  sku: "REM-ZIP-001",
  barcode: "8712345000019",
  supplierArticleNumber: "PIA-4T-8412",
  location: "A1-03",
  stockQuantity: 12,
  minStock: 4,
  isLowStock: false,
  salePriceIncl: 24.95,
  vatRate: 21,
  salePriceExcl: 20.62,
  archivedAt: null,
};

function match(overrides: Partial<PartScanMatchDTO> = {}): PartScanMatchDTO {
  return {
    part: PART,
    field: "barcode",
    value: "8712345000019",
    kind: "exact",
    ...overrides,
  };
}

describe("isStrongMatch", () => {
  it("vertrouwt alleen een exacte treffer zonder meer", () => {
    expect(isStrongMatch(match({ kind: "exact" }))).toBe(true);
    expect(isStrongMatch(match({ kind: "normalized" }))).toBe(false);
    expect(isStrongMatch(match({ kind: "contained" }))).toBe(false);
  });
});

describe("describeScanMatch", () => {
  it("noemt het veld, de opgeslagen waarde en hoe hard de treffer is", () => {
    expect(describeScanMatch(match())).toBe(
      "barcode 8712345000019 — exacte treffer",
    );
    expect(
      describeScanMatch(
        match({
          field: "supplierArticleNumber",
          value: "PIA-4T-8412",
          kind: "normalized",
        }),
      ),
    ).toBe(
      "leveranciersnummer PIA-4T-8412 — treffer na verbeteren van verwisselbare tekens",
    );
  });

  it("gebruikt voor elk veld en elke soort een Nederlandse tekst", () => {
    for (const label of Object.values(SCAN_FIELD_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
    for (const label of Object.values(SCAN_KIND_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
    for (const label of Object.values(SCAN_SOURCE_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("describeScanOutcome", () => {
  it("telt in het Nederlands en in enkelvoud waar dat hoort", () => {
    expect(describeScanOutcome(0)).toBe("Geen onderdeel gevonden");
    expect(describeScanOutcome(1)).toBe("Eén onderdeel gevonden");
    expect(describeScanOutcome(3)).toBe("3 mogelijke onderdelen gevonden");
  });
});

// ---------------------------------------------------------------------------
// T25 — hoe zeker is de treffer
// ---------------------------------------------------------------------------

describe("describeScanCertainty", () => {
  it("noemt het aantal gecorrigeerde tekens bij een benaderende treffer", () => {
    // Dit is wat de gebruiker moet weten voordat hij bevestigt: één teken
    // gecorrigeerd is iets anders dan twee.
    expect(
      describeScanCertainty(match({ kind: "approximate", distance: 1 })),
    ).toBe("treffer na correctie van 1 teken");
    expect(
      describeScanCertainty(match({ kind: "approximate", distance: 2 })),
    ).toBe("treffer na correctie van 2 tekens");
  });

  it("houdt de bestaande teksten voor de hardere treffers", () => {
    expect(describeScanCertainty(match({ kind: "exact" }))).toBe(
      "exacte treffer",
    );
    expect(describeScanCertainty(match({ kind: "normalized" }))).toBe(
      SCAN_KIND_LABELS.normalized,
    );
    expect(describeScanCertainty(match({ kind: "contained" }))).toBe(
      SCAN_KIND_LABELS.contained,
    );
  });

  it("valt terug op een vaste tekst als het getal ontbreekt", () => {
    // `distance` is optioneel in het DTO; een treffer zonder getal mag nooit een
    // lege of halve zin opleveren.
    expect(describeScanCertainty(match({ kind: "approximate" }))).toBe(
      SCAN_KIND_LABELS.approximate,
    );
    expect(
      describeScanCertainty(match({ kind: "approximate", distance: 0 })),
    ).toBe(SCAN_KIND_LABELS.approximate);
  });

  it("vertrouwt een benaderende treffer nooit zonder meer", () => {
    // De kaart wordt daardoor oranje en krijgt "controleer de verpakking".
    expect(isStrongMatch(match({ kind: "approximate", distance: 1 }))).toBe(
      false,
    );
  });

  it("zet het aantal gecorrigeerde tekens ook in de volledige regel", () => {
    expect(
      describeScanMatch(
        match({
          field: "supplierArticleNumber",
          value: "PIA-4T-8455",
          kind: "approximate",
          distance: 1,
        }),
      ),
    ).toBe("leveranciersnummer PIA-4T-8455 — treffer na correctie van 1 teken");
  });
});
