/**
 * Eén presentatievorm voor elk geldbedrag waar btw bij hoort (taak T18, SPEC §3
 * regel 0 v2.0).
 *
 * ### Waarom dit één component is en niet acht keer dezelfde JSX
 *
 * Vóór T18 stond op elke pagina een eigen variant: op `/onderdelen` het excl.-bedrag
 * groot met "incl." erachter, op het verkoopscherm "excl. / incl." naast elkaar, op de
 * detailpagina twee losse `dt`/`dd`-paren. Drie verschillende vormen voor hetzelfde
 * gegeven, en op geen van die plekken kon je in één oogopslag zien welk getal de klant
 * betaalt. Dat is precies de verwarring die geld kost. Daarom staat de vorm nu hier,
 * één keer:
 *
 * - het bedrag **inclusief** btw is het HOOFDbedrag: groot, vet, met het label
 *   "incl. btw" erachter. Dat is wat de klant betaalt en wat de winkel vaststelt;
 * - het bedrag **exclusief** btw staat er kleiner ONDER, ook gelabeld. Dat is het
 *   stuurgetal waarmee marge en rapportages rekenen.
 *
 * Beide bedragen worden altijd gelabeld. Een kaal bedrag zonder "incl."/"excl."-label
 * is in deze applicatie een bug: bij 21% btw zit er een vijfde verschil tussen de twee.
 *
 * ### Mobiel (SPEC §3 regel 8, §F8)
 *
 * De twee bedragen staan op eigen regels (`block`) en elk bedrag is
 * `whitespace-nowrap`, zodat "€ 1.234,56" nooit middenin afbreekt. Dat is de reden
 * dat ze niet naast elkaar staan: naast elkaar past het op 375px niet meer zodra er
 * een bedrag van vier cijfers in staat, en dan loopt de tabelcel of de kaart over.
 *
 * ### Rekenen gebeurt hier niet
 *
 * Dit component krijgt twee kant-en-klare bedragen en formatteert ze met
 * `formatEuro` (SPEC §3 regel 2: één formatteerhelper, afronden alleen bij
 * presentatie). Het leidt zelf géén excl.-bedrag uit een incl.-bedrag af: die
 * afleiding hoort in de datalaag (`priceExclVat`/`priceWithVat` in `@/lib/money`),
 * zodat het scherm nooit iets anders toont dan waarmee gerekend is.
 *
 * Geen `"use client"`: dit is pure presentatie en moet vanuit server components
 * gebruikt kunnen worden (zie de les in TASKS.md, reviewronde 3).
 */

import { formatEuro } from "@/lib/money";

/** Visuele maat van het hoofdbedrag. */
export type PriceWithVatSize = "sm" | "md" | "lg";

const MAIN_SIZE_CLASSES: Record<PriceWithVatSize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
};

export interface PriceWithVatProps {
  /** Bedrag INCLUSIEF btw — wordt het hoofdbedrag. */
  incl: number;
  /** Bedrag EXCLUSIEF btw — wordt het kleinere bedrag eronder. */
  excl: number;
  /** Maat van het hoofdbedrag; `sm` in tabellen, `lg` op kaarten met kerncijfers. */
  size?: PriceWithVatSize;
  /** Rechts uitlijnen (tabelkolommen met bedragen). */
  align?: "left" | "right";
  className?: string;
}

/**
 * Een bedrag met btw: incl. groot boven, excl. klein eronder, beide gelabeld.
 */
export function PriceWithVat({
  incl,
  excl,
  size = "sm",
  align = "left",
  className,
}: PriceWithVatProps) {
  const alignClass = align === "right" ? "text-right" : "text-left";

  return (
    <span className={`block ${alignClass} ${className ?? ""}`.trim()}>
      {/* Bedrag en label zijn elk apart `whitespace-nowrap`: de regel mag tussen het
          bedrag en "incl. btw" afbreken op een smal scherm, maar nooit middenin een
          bedrag. Zo loopt een tabelcel of kaart op 375px niet over. */}
      <span
        className={`block font-semibold text-gray-900 ${MAIN_SIZE_CLASSES[size]}`}
      >
        <span className="whitespace-nowrap">{formatEuro(incl)}</span>{" "}
        <span className="whitespace-nowrap text-xs font-normal text-gray-500">
          incl. btw
        </span>
      </span>
      <span className="block text-xs text-gray-500">
        <span className="whitespace-nowrap">{formatEuro(excl)}</span>{" "}
        <span className="whitespace-nowrap">excl. btw</span>
      </span>
    </span>
  );
}

/**
 * De toelichting die overal bij een marge hoort staan (T18).
 *
 * De marge is verkoopprijs EXCL. btw minus inkoopprijs EXCL. btw. Wie de marge naast
 * een incl.-bedrag ziet staan zou kunnen denken dat de btw meegerekend is — en dan
 * lijkt de winst bij 21% btw een vijfde hoger dan hij is. Eén vaste tekst, zodat die
 * uitleg op geen enkel scherm anders klinkt of ontbreekt.
 */
export const MARGIN_BASIS_NOTE =
  "Marge = verkoopprijs excl. btw − inkoopprijs excl. btw. Btw is geen winst: die draag je af.";

/** Kleine, grijze toelichting bij een marge. Gebruikt {@link MARGIN_BASIS_NOTE}. */
export function MarginBasisNote({ className }: { className?: string }) {
  return (
    <p className={`text-xs text-gray-500 ${className ?? ""}`.trim()}>
      {MARGIN_BASIS_NOTE}
    </p>
  );
}
