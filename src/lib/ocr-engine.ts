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
 * De opschaling die het SCANSCHERM gebruikt (T25), ruimer dan de standaard van
 * {@link computeOcrCrop}.
 *
 * T20 schaalde tot 2× op met een bovengrens van 1280 pixels breed. Op een
 * gegenereerde proefafbeelding van 240 pixels breed leverde dat nog net een
 * leesbaar beeld; op de kleine druk van een echte verpakking is dat te weinig. De
 * letterhoogte is wat telt voor Tesseract — ongeveer 30 pixels per letter is het
 * minimum, en in een strook van 30% van de beeldhoogte zit op een telefoon van
 * 720p zo'n 216 pixels met drie of vier regels tekst erin.
 *
 * De standaardwaarden van `computeOcrCrop` blijven staan zoals T20 ze gemeten
 * heeft; het scanscherm vraagt expliciet om meer. Zo blijft die functie in zijn
 * eigen tests exact hetzelfde doen en staat de wijziging op één plek.
 */
export const OCR_UPSCALE = { maxWidth: 1800, maxScale: 3 } as const;

export interface OcrCropOptions {
  /** Bovengrens voor de breedte van het beeld dat naar de herkenning gaat. */
  maxWidth?: number;
  /** Bovengrens voor de opschaling; 1 betekent "nooit opschalen". */
  maxScale?: number;
}

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
  options: OcrCropOptions = {},
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

  const maxWidth = options.maxWidth ?? MAX_OCR_WIDTH;
  const maxScale = options.maxScale ?? 2;
  const scale = Math.min(maxScale, Math.max(1, maxWidth / sourceWidth));

  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    canvasWidth: Math.round(sourceWidth * scale),
    canvasHeight: Math.round(sourceHeight * scale),
  };
}

/* -------------------------------------------------------------------------- */
/* Beeldbewerking vóór de herkenning (T25)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Welk deel van de donkerste en lichtste pixels buiten beschouwing blijft bij het
 * bepalen van het bereik: een tiende procent aan elke kant.
 *
 * Dat is bewust WEINIG, en ook dat komt uit de meting. Een artikelnummer beslaat
 * maar een paar procent van de strook, en kleine druk nog veel minder. Met 2%
 * (en zelfs met 0,5%) werd de DRUK ZELF weggeknipt: op het proefbeeld met kleine
 * druk en korrel kwam het bereik daardoor op 130–255 uit in plaats van op 14–255,
 * werd er opgerekt waar dat niet hoefde, en veranderde leesbare druk in onzin. Op
 * 0,1% is het bereik van alle 32 proefbeelden plausibel en wordt er alleen nog
 * opgerekt op de vier beelden die écht contrastarm zijn.
 *
 * Een enkele dode of spiegelende pixel wordt nog steeds genegeerd; een glimlicht
 * dat groter is dan 0,1% van het beeld bepaalt hooguit de bovengrens, en dat maakt
 * de bewerking alleen maar voorzichtiger.
 */
const CONTRAST_CLIP_RATIO = 0.001;

/**
 * Het kleinste verschil tussen de donkerste en lichtste pixel waarbij er nog
 * opgerekt wordt. Onder deze waarde is het beeld zo vlak (een lens tegen een doos,
 * een volledig overbelicht of pikdonker frame) dat oprekken alleen de ruis zou
 * versterken en van korrel letters zou maken.
 */
const MIN_CONTRAST_RANGE = 24;

/**
 * En de bovengrens: beslaat het beeld al zoveel van de schaal, dan wordt er NIET
 * opgerekt.
 *
 * Dit is geen voorzichtigheid vooraf maar een meting achteraf. In de voor/na-meting
 * van T25 (32 proefbeelden) was er één beeld waarop de nieuwe aanpak het slechter
 * deed dan de oude: kleine druk met flinke korrel, zoals een telefoon bij weinig
 * licht maakt. Zonder bewerking las Tesseract daar vier keer op rij `MOT-BEN-010`;
 * mét het oprekken kwam er vier keer op rij `LE LE -WOE SC C LE LL...` uit. De
 * korrel besloeg daar al de volle schaal, dus het oprekken voegde niets toe en
 * blies alleen het verschil tussen twee korrels op tot het verschil tussen inkt en
 * papier.
 *
 * Een beeld dat de schaal al gebruikt heeft deze bewerking niet nodig; een
 * contrastarm beeld (grijze druk op een grijze verpakking) wel, en dat is precies
 * waar deze stap voor bedoeld is.
 */
const ALREADY_WIDE_RANGE = 180;

/**
 * Zet RGBA-pixels om naar grijswaarden en rekt het contrast op naar de volle
 * zwart-wit-schaal.
 *
 * Werkt IN PLAATS op de array uit `getImageData()` — dat is één buffer van een paar
 * megabyte per frame en die moet op een telefoon niet per bewerking gekopieerd
 * worden.
 *
 * Waarom dit helpt: Tesseract maakt zelf ook een zwart-witbeeld (Otsu), maar doet
 * dat over het hele beeld in één keer. Een camerabeeld van een verpakking onder
 * tl-licht heeft een lichtgradiënt van links naar rechts; de drempel die dan voor
 * de linkerhelft klopt, maakt van de rechterhelft een zwart vlak. Door eerst zelf
 * naar grijswaarden te gaan en het bereik op te rekken (met de uiterste 2%
 * weggeknipt zodat een glimlicht niet alles bepaalt) komt die drempel voor het hele
 * beeld dichter bij het midden te liggen.
 *
 * Puur en geëxporteerd, zodat het zonder camera en zonder canvas te testen is: in
 * gaat een `Uint8ClampedArray` met RGBA, uit komt dezelfde array met R=G=B.
 *
 * Geeft terug of er écht opgerekt is. `false` betekent "te vlak, alleen
 * grijswaarden" en is geen fout.
 */
export function enhanceOcrPixels(data: Uint8ClampedArray): boolean {
  const pixelCount = Math.floor(data.length / 4);
  if (pixelCount === 0) {
    return false;
  }

  // Grijswaarden volgens de gebruikelijke weging voor waargenomen helderheid; een
  // rekenkundig gemiddelde maakt rode druk op zwart onleesbaar.
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    // Een doorzichtige pixel is geen ZWARTE pixel. Een canvas dat uit een
    // videoframe getekend is heeft overal alpha 255, maar een canvas waarop nog
    // niets of maar een deel getekend is niet — en dan zou dit beeld pikzwart
    // worden en de herkenning niets opleveren. Doorzichtig telt daarom als wit,
    // zoals elke viewer het ook laat zien.
    const alpha = data[i + 3] / 255;
    const composited = gray * alpha + 255 * (1 - alpha);
    const rounded = Math.round(composited);
    const value = rounded > 255 ? 255 : rounded < 0 ? 0 : rounded;
    data[i] = value;
    histogram[value] += 1;
  }

  // De 2%-grenzen uit het histogram zoeken.
  const clip = Math.floor(pixelCount * CONTRAST_CLIP_RATIO);
  let low = 0;
  let seen = 0;
  for (let value = 0; value < 256; value += 1) {
    seen += histogram[value];
    if (seen > clip) {
      low = value;
      break;
    }
  }
  let high = 255;
  seen = 0;
  for (let value = 255; value >= 0; value -= 1) {
    seen += histogram[value];
    if (seen > clip) {
      high = value;
      break;
    }
  }

  const range = high - low;
  const stretched = range >= MIN_CONTRAST_RANGE && range < ALREADY_WIDE_RANGE;
  const factor = stretched ? 255 / (high - low) : 1;

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i];
    let value = gray;
    if (stretched) {
      value = Math.round((gray - low) * factor);
      value = value < 0 ? 0 : value > 255 ? 255 : value;
    }
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }

  return stretched;
}

/**
 * Tekent de uitsnede van het huidige videoframe op `canvas` en geeft aan of dat
 * gelukt is. `false` betekent "nog geen beeld" (de stream is net gestart) — dat is
 * normaal en geen fout.
 *
 * Vier stappen, in deze volgorde (T25): bijsnijden tot het richtkader, opschalen
 * naar een werkbare hoogte, omzetten naar grijswaarden en het contrast oprekken.
 * Het opschalen gebeurt met de interpolatie van de browser tijdens `drawImage`, dus
 * vóór de grijswaarden — andersom zou de interpolatie de net opgerekte randen weer
 * uitsmeren.
 *
 * Het canvas wordt hergebruikt tussen frames; elke keer een nieuw canvas maken
 * laat het geheugengebruik op een telefoon oplopen.
 */
export function drawOcrFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): boolean {
  const crop = computeOcrCrop(video.videoWidth, video.videoHeight, OCR_UPSCALE);
  if (crop === null) {
    return false;
  }

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    return false;
  }

  canvas.width = crop.canvasWidth;
  canvas.height = crop.canvasHeight;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
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

  try {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    enhanceOcrPixels(image.data);
    context.putImageData(image, 0, 0);
  } catch (error) {
    // `getImageData` gooit als het canvas "getaint" is door een bron van een ander
    // domein. Bij een eigen camerastream kan dat niet, maar als het ooit gebeurt
    // is het ruwe beeld beter dan geen beeld: de herkenning gaat gewoon door.
    console.warn("Beeldbewerking overgeslagen", error);
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* Engines                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * De enige tekens die een artikelnummer kan bevatten: hoofdletters, cijfers, een
 * streepje en een punt (T25). Spaties zitten er met opzet NIET in — Tesseract zet
 * woordgrenzen zelf, en in de ruimte tussen twee woorden hoort geen teken.
 */
export const OCR_CHAR_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.";

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
    // De tekenset beperken tot wat er in een artikelnummer kan staan (T25).
    //
    // Eerlijk over wat dit oplevert, want het is gemeten en niet aangenomen: op de
    // 32 proefbeelden van T25 gaf Tesseract met en zonder deze lijst 27 keer
    // LETTERLIJK dezelfde tekst, en op de vijf beelden waar de tekst verschilde
    // veranderde de uitkomst van het matchen geen enkele keer — niet ten goede en
    // niet ten kwade. De LSTM-engine negeert deze instelling dus grotendeels, zoals
    // de opmerking in T20 al vermoedde.
    //
    // Hij staat desondanks aan, om één reden: wat hij wél weghaalt is rommel
    // (kleine letters en leestekens uit de omringende verpakkingstekst) die anders
    // in de losse stukken belandt die naar het matchen gaan, en dat is precies waar
    // nu ook benaderend gematcht wordt. Minder ruis aan de ingang is daar meer
    // waard dan vóór T25. Hij is géén vervanging voor het samenvouwen van O/0,
    // I/1, S/5, B/8 en Z/2 in `@/lib/article-number`.
    tessedit_char_whitelist: OCR_CHAR_WHITELIST,
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
