/**
 * Hulplogica voor het scannen van barcodes (SPEC §F4). Bewust vrij van DOM- en
 * camera-API's zodat alles hier zonder browser te testen is; `BarcodeScanner.tsx`
 * doet het camerawerk en gebruikt deze module voor formaten, foutmeldingen en
 * ontdubbeling.
 *
 * De formaatnamen volgen de schrijfwijze van de `BarcodeDetector`-API
 * (`"ean_13"`), omdat dat het snelle pad is; voor de @zxing-fallback wordt
 * daarheen vertaald met `toZxingFormatNames`.
 */

/** De vier formaten die de app ondersteunt (SPEC §F4 / TASKS T10). */
export type BarcodeFormatName = "ean_13" | "ean_8" | "code_128" | "qr_code";

/** Standaardformaten: EAN-13, EAN-8, Code-128 en QR. */
export const DEFAULT_BARCODE_FORMATS: readonly BarcodeFormatName[] = [
  "ean_13",
  "ean_8",
  "code_128",
  "qr_code",
];

/** Leesbare labels, bv. voor een uitleg onder het richtkader. */
export const BARCODE_FORMAT_LABELS: Record<BarcodeFormatName, string> = {
  ean_13: "EAN-13",
  ean_8: "EAN-8",
  code_128: "Code-128",
  qr_code: "QR",
};

/** Namen zoals de `BarcodeFormat`-enum van `@zxing/library` ze kent. */
export type ZxingFormatName = "EAN_13" | "EAN_8" | "CODE_128" | "QR_CODE";

const ZXING_FORMAT_BY_NAME: Record<BarcodeFormatName, ZxingFormatName> = {
  ean_13: "EAN_13",
  ean_8: "EAN_8",
  code_128: "CODE_128",
  qr_code: "QR_CODE",
};

const FORMAT_BY_ZXING_NAME: Record<ZxingFormatName, BarcodeFormatName> = {
  EAN_13: "ean_13",
  EAN_8: "ean_8",
  CODE_128: "code_128",
  QR_CODE: "qr_code",
};

/**
 * Zet onze formaatnamen om naar de strings die `new BarcodeDetector({ formats })`
 * verwacht. Die zijn identiek; de functie bestaat zodat het aanroeppunt geen
 * aannames doet en dubbele waarden eruit vallen.
 */
export function toDetectorFormats(
  formats: readonly BarcodeFormatName[],
): string[] {
  return [...new Set(formats)];
}

/**
 * Houdt alleen de gevraagde formaten over die deze browser volgens
 * `BarcodeDetector.getSupportedFormats()` daadwerkelijk aankan.
 *
 * - `supported === null` betekent "onbekend" (de browser geeft geen lijst): dan
 *   gaan we uit van de gevraagde formaten en laten we de detector het zeggen.
 * - Een lege uitkomst betekent dat `BarcodeDetector` hier niets bruikbaars doet;
 *   de aanroeper valt dan terug op @zxing.
 */
export function pickDetectorFormats(
  requested: readonly BarcodeFormatName[],
  supported: readonly string[] | null | undefined,
): BarcodeFormatName[] {
  const unique = [...new Set(requested)];
  if (supported === null || supported === undefined) {
    return unique;
  }
  const supportedSet = new Set(supported);
  return unique.filter((format) => supportedSet.has(format));
}

/** Vertaalt onze formaatnamen naar de sleutels van de zxing-`BarcodeFormat`-enum. */
export function toZxingFormatNames(
  formats: readonly BarcodeFormatName[],
): ZxingFormatName[] {
  return [...new Set(formats)].map((format) => ZXING_FORMAT_BY_NAME[format]);
}

/**
 * Vertaalt een formaatnaam uit een zxing-resultaat terug naar onze naam.
 * Geeft `null` voor formaten die de app niet ondersteunt (bv. `PDF_417`).
 */
export function fromZxingFormatName(name: string): BarcodeFormatName | null {
  return FORMAT_BY_ZXING_NAME[name as ZxingFormatName] ?? null;
}

/** Oorzaken waarom de camera niet beschikbaar is. */
export type CameraErrorCode =
  | "insecure-context"
  | "not-supported"
  | "permission-denied"
  | "no-camera"
  | "camera-busy"
  | "unknown";

/**
 * Nederlandse melding per oorzaak. Elke melding noemt de terugval "voer de code
 * handmatig in", zodat de balie nooit vastloopt op een camera die niet wil
 * (SPEC §F4 en §F8: geen stille mislukkingen).
 */
export const CAMERA_ERROR_MESSAGES: Record<CameraErrorCode, string> = {
  "insecure-context":
    "Scannen werkt alleen via een beveiligde verbinding (https). Open de app via https of voer de code handmatig in.",
  "not-supported":
    "Deze browser kan geen camerabeeld gebruiken om te scannen. Voer de code handmatig in.",
  "permission-denied":
    "Toegang tot de camera is geweigerd. Sta de camera toe in de browserinstellingen en probeer opnieuw, of voer de code handmatig in.",
  "no-camera":
    "Er is geen camera gevonden op dit apparaat. Voer de code handmatig in.",
  "camera-busy":
    "De camera is al in gebruik door een ander tabblad of een andere app. Sluit die eerst en probeer opnieuw, of voer de code handmatig in.",
  unknown:
    "De camera kon niet gestart worden. Probeer het opnieuw of voer de code handmatig in.",
};

/**
 * Herleidt de oorzaak uit een `getUserMedia`-fout. De browser geeft die als
 * `DOMException` met een `name`; de oude Firefox-/Chrome-namen worden
 * meegenomen omdat aan de balie ook oudere toestellen liggen.
 */
export function classifyCameraError(error: unknown): CameraErrorCode {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "PermissionDismissedError":
      return "permission-denied";
    case "SecurityError":
      return "insecure-context";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "no-camera";
    case "NotReadableError":
    case "TrackStartError":
      return "camera-busy";
    case "TypeError":
      // getUserMedia gooit een TypeError als de API ontbreekt of de pagina niet
      // in een beveiligde context draait.
      return "not-supported";
    default:
      return "unknown";
  }
}

/** Kortere weg: van een ruwe fout naar de Nederlandse melding. */
export function cameraErrorMessage(error: unknown): string {
  return CAMERA_ERROR_MESSAGES[classifyCameraError(error)];
}

/**
 * Maakt een gescande waarde schoon: witruimte eraf en stuurtekens eruit
 * (zxing levert regelmatig een afsluitende newline). Geeft `null` als er niets
 * bruikbaars overblijft, zodat een leeg resultaat nooit als scan doorgaat.
 */
export function normalizeScannedCode(raw: string): string | null {
  let cleaned = "";
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    // Stuurtekens (0-31 en DEL) overslaan; de rest blijft ongemoeid.
    if (code >= 32 && code !== 127) {
      cleaned += char;
    }
  }
  const trimmed = cleaned.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Poortje tegen dubbele detectie: de camera ziet dezelfde streepjescode vele
 * keren per seconde, maar `onScan` mag daar één keer op afgaan.
 */
export interface ScanGate {
  /**
   * Geeft de opgeschoonde code terug als die als nieuwe scan telt, anders
   * `null` (leeg resultaat of te snel dezelfde code).
   */
  accept(raw: string, now?: number): string | null;
  /** Vergeet de laatste scan, bv. bij opnieuw openen van de scanner. */
  reset(): void;
}

export interface ScanGateOptions {
  /** Hoe lang dezelfde code genegeerd wordt (ms). Standaard 2000. */
  repeatDelayMs?: number;
  /** Klok, injecteerbaar voor tests. Standaard `Date.now`. */
  now?: () => number;
}

export function createScanGate(options: ScanGateOptions = {}): ScanGate {
  const repeatDelayMs = options.repeatDelayMs ?? 2000;
  const clock = options.now ?? Date.now;

  let lastCode: string | null = null;
  let lastAt = 0;

  return {
    accept(raw: string, now?: number): string | null {
      const code = normalizeScannedCode(raw);
      if (code === null) {
        return null;
      }
      const at = now ?? clock();
      if (lastCode === code && at - lastAt < repeatDelayMs) {
        // Dezelfde code binnen het venster: de tijdstempel opschuiven zou een
        // code die continu in beeld ligt voor altijd blokkeren, dus dat doen we
        // bewust niet.
        return null;
      }
      lastCode = code;
      lastAt = at;
      return code;
    },
    reset(): void {
      lastCode = null;
      lastAt = 0;
    },
  };
}
