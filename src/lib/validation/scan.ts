/**
 * Zod-schema voor het opzoeken van een gescande code (T20, SPEC §3 regel 7: ALLE
 * server-side invoer wordt gevalideerd).
 *
 * De invoer komt uit drie bronnen, en geen van de drie is te vertrouwen:
 *
 * - `barcode` — wat de camera uit een streepjescode haalde;
 * - `ocr` — wat de tekstherkenning van een verpakking meende te lezen. Dat is een
 *   lap tekst met regelafbrekingen en ruis, niet één net nummer;
 * - `manual` — wat de gebruiker in het correctieveld typte nadat de herkenning
 *   ernaast zat.
 *
 * Er wordt met opzet NIETS afgekeurd op vorm: een OCR-resultaat mag letters,
 * cijfers, spaties, regelafbrekingen en rommel bevatten. De enige eisen zijn "niet
 * leeg" en "niet absurd lang" — dat laatste zodat een geknutselde aanroep de server
 * niet met een megabyte tekst aan het werk kan zetten. Het schoonmaken en matchen
 * gebeurt daarna in de pure functies van `@/lib/article-number`.
 */

import { z } from "zod";

/**
 * Bovengrens op de lengte van de tekst die we bekijken. Een OCR-lap van een hele
 * verpakking is in de praktijk een paar honderd tekens; 2000 is ruim genoeg en houdt
 * de kosten van het matchen begrensd.
 */
export const MAX_SCAN_TEXT_LENGTH = 2000;

/** De bronnen, als tuple voor `z.enum`. */
export const SCAN_SOURCES = ["barcode", "ocr", "manual"] as const;

export const scanLookupSchema = z.object({
  text: z
    .string({
      required_error: "Er is geen tekst om op te zoeken",
      invalid_type_error: "Er is geen geldige tekst om op te zoeken",
    })
    .trim()
    .min(1, "Er is geen tekst om op te zoeken")
    .max(
      MAX_SCAN_TEXT_LENGTH,
      `De gescande tekst is langer dan ${MAX_SCAN_TEXT_LENGTH} tekens`,
    ),
  source: z.enum(SCAN_SOURCES, {
    errorMap: () => ({ message: "Onbekende herkomst van de gescande tekst" }),
  }),
});

export type ScanLookupInput = z.infer<typeof scanLookupSchema>;
