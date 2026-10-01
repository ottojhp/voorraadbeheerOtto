/**
 * Tekstherkenning op een camerabeeld (T20, SPEC §F4).
 *
 * Deze module is de ENIGE plek waar Tesseract en de `TextDetector`-API aangeraakt
 * worden. Hij bevat geen React en geen UI; `@/components/TextScanner` gebruikt hem.
 * Bewust GÉÉN `"use client"`: dit bestand exporteert gewone functies, en een
 * `"use client"`-bestand mag alleen componenten en types exporteren. Het komt in de
 * clientbundle terecht doordat een client component het importeert — importeer het
 * nooit vanuit een server component, want het gebruikt browser-API's.
 *
 * ## Twee paden, met het goedkope eerst
 *
 *  1. **`TextDetector`** — een browser-API (Chrome op Android, achter een vlag of
 *     per platform wisselend aanwezig). Kost niets om te laden en is meteen klaar.
 *     We voelen hem af en gebruiken hem als hij er is.
 *  2. **Tesseract.js** — overal elders. Die wordt met een DYNAMISCHE import geladen
 *     (`await import("tesseract.js")`), zodat hij niet in de hoofdbundle belandt.
 *
 * ## Eerlijk over de kosten van het Tesseract-pad
 * De dynamische import houdt alleen het JavaScript van tesseract.js uit de
 * hoofdbundle (ordegrootte honderd kilobyte). Het echte gewicht zit NIET in de
 * bundle en kan daar ook niet in zitten: het worker-script, de WebAssembly-kern en
 * het Engelse taalmodel worden door tesseract.js bij het eerste gebruik van zijn
 * eigen CDN (jsdelivr) gehaald en zijn samen enkele megabytes — het taalmodel alleen
 * al ruim 10 MB ongecomprimeerd. Dat is de reden dat
 * {@link createOcrEngine} een voortgangsmelding doorgeeft en de UI "bezig met laden"
 * toont: zonder netwerk of met een trage verbinding duurt die eerste keer merkbaar
 * lang, en zonder internet werkt dit pad helemaal niet. De barcodescanner en het
 * handmatig zoeken blijven in dat geval gewoon werken; dat is precies waarom OCR
 * hier een aanvulling is en geen vervanging.
 *
 * Het model wordt door de browser gecached (IndexedDB), dus de tweede keer is het
 * snel.
 */

/* -------------------------------------------------------------------------- */
/* TextDetector — minimale typedeclaratie                                      */
/* -------------------------------------------------------------------------- */

/**
 * TypeScript kent `TextDetector` niet in zijn DOM-types. Hieronder staat precies
 * het stukje API dat hier gebruikt wordt — geen `any`, geen `@ts-ignore`. Bewust
 * géén `declare global`, net als bij de `BarcodeDetector`-declaratie in
 * `@/components/BarcodeScanner`, zodat twee bestanden niet met elkaar botsen.
 */
interface DetectedTextLike {
  rawValue: string;
}

interface TextDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedTextLike[]>;
}

interface TextDetectorConstructor {
  new (): TextDetectorLike;
}

type WindowWithTextDetector = Window &
  typeof globalThis & {
    TextDetector?: TextDetectorConstructor;
  };

/* -------------------------------------------------------------------------- */
/* Publieke types                                                              */
/* -------------------------------------------------------------------------- */

/** Welk pad de herkenning gebruikt. De UI noemt dit, zodat gedrag uitlegbaar is. */
export type OcrEngineKind = "text-detector" | "tesseract";

/** Voortgang tijdens het laden én tijdens het herkennen. */
export interface OcrProgress {
  /** Nederlandse omschrijving, direct te tonen. */
  label: string;
  /** 0..1, of `null` als de stap geen voortgang meldt. */
  fraction: number | null;
}

export interface OcrEngine {
  kind: OcrEngineKind;
  /**
   * Leest de tekst uit één beeld. Geeft de ruwe tekst terug (met
   * regelafbrekingen), of een lege string als er niets gelezen is. Gooit alleen bij
   * een echte storing in de engine.
   */
  recognize(source: HTMLCanvasElement): Promise<string>;
  /** Ruimt de worker op. Altijd aanroepen bij het sluiten van het scanscherm. */
  terminate(): Promise<void>;
}

export interface CreateOcrEngineOptions {
  /** Voortgang van het laden; wordt tijdens het downloaden meermaals aangeroepen. */
  onProgress?: (progress: OcrProgress) => void;
  /**
   * `true` slaat het `TextDetector`-pad over en gebruikt altijd Tesseract. Alleen
   * voor handmatig uitproberen; de UI gebruikt de standaard.
   */
  forceTesseract?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Statusmeldingen                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Tesseract meldt zijn stappen in het Engels via een logger. Dit zijn de statussen
 * die in de praktijk langskomen; onbekende statussen vallen terug op een algemene
 * tekst, zodat er nooit Engels op het scherm belandt.
 */
const TESSERACT_STATUS_LABELS: Record<string, string> = {
  "loading tesseract core": "Tekstherkenning laden…",
  "initializing tesseract": "Tekstherkenning starten…",
  "initialized tesseract": "Tekstherkenning gestart",
  "loading language traineddata": "Taalmodel downloaden…",
  "loaded language traineddata": "Taalmodel geladen",
  "initializing api": "Tekstherkenning gereedmaken…",
  "initialized api": "Tekstherkenning gereed",
  "recognizing text": "Tekst lezen…",
};

/** Vertaalt één logregel van Tesseract naar een Nederlandse voortgangsmelding. */
export function describeTesseractStatus(
  status: string,
  progress: number,
): OcrProgress {
  const label = TESSERACT_STATUS_LABELS[status] ?? "Tekstherkenning voorbereiden…";
  const fraction =
    Number.isFinite(progress) && progress >= 0 && progress <= 1 ? progress : null;
  return { label, fraction };
}

/* -------------------------------------------------------------------------- */
/* Beeld uit de videostream halen                                              */
/* -------------------------------------------------------------------------- */

/**
 * Welk deel van het camerabeeld naar de herkenning gaat: een brede, lage strook in
 * het midden, ongeveer waar het richtkader in het scanscherm staat.
 *
 * Alleen dat deel aanbieden doet twee dingen: het haalt de ruis van de rest van de
 * verpakking weg (merklogo's, waarschuwingsteksten, streepjescodes) en het maakt de
 * herkenning een stuk sneller, want Tesseract werkt op minder pixels.
 */
export const OCR_CROP = { widthRatio: 0.86, heightRatio: 0.3 } as const;

/**
 * Bovengrens voor de breedte van het beeld dat naar Tesseract gaat. Groter maakt de
 * herkenning langzamer zonder dat kleine druk beter leesbaar wordt.
 */
const MAX_OCR_WIDTH = 1280;

/**
 * Berekent de uitsnede uit een beeld van `videoWidth × videoHeight`, plus de
 * schaalfactor waarmee die uitsnede op het canvas wordt getekend.
 *
 * Puur rekenwerk, dus apart en geëxporteerd — zo is het zonder camera te
 * controleren. De uitsnede wordt OPGESCHAALD als hij kleiner is dan
 * {@link MAX_OCR_WIDTH}: kleine druk op een telefooncamera levert letters van een
 * paar pixels hoog op, en Tesseract leest die aantoonbaar slechter dan dezelfde
 * letters tweemaal zo groot.
 */
export function computeOcrCrop(
  videoWidth: number,
  videoHeight: number,
): {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
} | null {
  if (
    !Number.isFinite(videoWidth) ||
    !Number.isFinite(videoHeight) ||
    videoWidth < 1 ||
    videoHeight < 1
  ) {
    return null;
  }

  const sourceWidth = Math.max(1, Math.round(videoWidth * OCR_CROP.widthRatio));
  const sourceHeight = Math.max(1, Math.round(videoHeight * OCR_CROP.heightRatio));
  const sourceX = Math.round((videoWidth - sourceWidth) / 2);
  const sourceY = Math.round((videoHeight - sourceHeight) / 2);

  const scale = Math.min(2, Math.max(1, MAX_OCR_WIDTH / sourceWidth));

  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    canvasWidth: Math.round(sourceWidth * scale),
    canvasHeight: Math.round(sourceHeight * scale),
  };
}

/**
 * Tekent de uitsnede van het huidige videoframe op `canvas` en geeft aan of dat
 * gelukt is. `false` betekent "nog geen beeld" (de stream is net gestart) — dat is
 * normaal en geen fout.
 *
 * Het canvas wordt hergebruikt tussen frames; elke keer een nieuw canvas maken
 * laat het geheugengebruik op een telefoon oplopen.
 */
export function drawOcrFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): boolean {
  const crop = computeOcrCrop(video.videoWidth, video.videoHeight);
  if (crop === null) {
    return false;
  }

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    return false;
  }

  canvas.width = crop.canvasWidth;
  canvas.height = crop.canvasHeight;
  context.drawImage(
    video,
    crop.sourceX,
    crop.sourceY,
    crop.sourceWidth,
    crop.sourceHeight,
    0,
    0,
    crop.canvasWidth,
    crop.canvasHeight,
  );
  return true;
}

/* -------------------------------------------------------------------------- */
/* Engines                                                                     */
/* -------------------------------------------------------------------------- */

/** Of deze browser de ingebouwde `TextDetector` heeft. */
export function hasTextDetector(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return typeof (window as WindowWithTextDetector).TextDetector === "function";
}

/**
 * Maakt de herkenner. Probeert eerst `TextDetector` (gratis en meteen klaar) en valt
 * anders terug op Tesseract, met voortgang via `onProgress`.
 *
 * Gooit als geen van beide paden werkt; de aanroeper hoort dat als "tekstherkenning
 * niet beschikbaar" te tonen en de barcodescanner en het handmatig zoeken te laten
 * staan.
 */
export async function createOcrEngine(
  options: CreateOcrEngineOptions = {},
): Promise<OcrEngine> {
  const { onProgress, forceTesseract = false } = options;

  if (!forceTesseract && hasTextDetector()) {
    const Detector = (window as WindowWithTextDetector).TextDetector;
    if (Detector) {
      onProgress?.({ label: "Tekstherkenning van de browser gereed", fraction: 1 });
      const detector = new Detector();
      return {
        kind: "text-detector",
        async recognize(source) {
          const found = await detector.detect(source);
          return found
            .map((item) => item.rawValue)
            .filter((value) => value.length > 0)
            .join("\n");
        },
        async terminate() {
          // Geen worker, niets op te ruimen.
        },
      };
    }
  }

  onProgress?.({ label: "Tekstherkenning laden…", fraction: 0 });

  // DYNAMISCHE import: dit is de reden dat tesseract.js niet in de hoofdbundle zit.
  // Alles eronder (worker, WebAssembly-kern, taalmodel) komt pas hier van het net.
  const tesseract = await import("tesseract.js");

  const worker = await tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY, {
    logger: (message) => {
      onProgress?.(describeTesseractStatus(message.status, message.progress));
    },
  });

  await worker.setParameters({
    // Een artikelnummer staat als blok tekst op de verpakking, niet als één losse
    // regel: SINGLE_BLOCK geeft op proefbeelden de minste verminkte regels.
    tessedit_pageseg_mode: tesseract.PSM.SINGLE_BLOCK,
    // Een camerabeeld heeft geen DPI-informatie. Zonder deze waarde klaagt
    // Tesseract en schat hij er zelf een, wat per frame kan verschillen.
    user_defined_dpi: "300",
    preserve_interword_spaces: "1",
    // GEEN `tessedit_char_whitelist`: die wordt door de LSTM-engine grotendeels
    // genegeerd, en wat er wél mee gebeurt is per versie anders. De
    // letter/cijfer-verwisselingen worden daarom niet hier maar in
    // `@/lib/article-number` opgevangen, waar ze getest zijn.
  });

  onProgress?.({ label: "Tekstherkenning gereed", fraction: 1 });

  return {
    kind: "tesseract",
    async recognize(source) {
      const result = await worker.recognize(source, {
        // Scheef gehouden telefoon rechtzetten. In de werkplaats houdt niemand zijn
        // telefoon recht boven een pakje, en een paar graden scheefstand breekt de
        // herkenning volledig.
        //
        // Wat hier gemeten is op een testbeeld dat 10° gedraaid stond (vier rondes
        // op hetzelfde beeld, verse worker):
        //   zonder deze vlag: 4× "Art.nr- PlA-4T.g 455", zekerheid 51, geen treffer;
        //   mét deze vlag:    ronde 1 en 3 hetzelfde, ronde 2 en 4
        //                     "Art.nr: PIA-4T-8455", zekerheid 93, exacte treffer.
        //
        // Dat afwisselende patroon is geen toeval: Tesseract past de rotatie toe die
        // hij in de VORIGE ronde gemeten heeft. Eén losse ronde heeft er dus niets
        // aan — de leeslus in `@/components/TextScanner` doet er meerdere op
        // dezelfde scène, en dáár maakt dit het verschil tussen "nooit leesbaar" en
        // "om de ronde leesbaar". De kosten zijn ongeveer een verdubbeling van de
        // leestijd op de rondes waarin hij echt draait (gemeten ~80 → ~240 ms op
        // een Mac; op een telefoon navenant trager).
        rotateAuto: true,
      });
      return result.data.text ?? "";
    },
    async terminate() {
      try {
        await worker.terminate();
      } catch {
        // De worker was al weg; niets aan de hand.
      }
    },
  };
}
