/**
 * Artikelnummers normaliseren en matchen (T20, SPEC §F4).
 *
 * Deze module is PUUR: geen DOM, geen camera, geen database, geen React. Dat is
 * bewust, want dit is het enige deel van het scannen dat écht te bewijzen is.
 * `TextScanner.tsx` doet het camerawerk, `@/lib/ocr-engine` praat met Tesseract en
 * `findPartsByScannedText()` in `@/lib/queries/parts` haalt de kandidaten op; alleen
 * hier wordt besloten of twee nummers hetzelfde zijn.
 *
 * ## Waarom normaliseren
 * De garagehouder houdt zijn telefoon boven een verpakking. Wat de OCR teruggeeft is
 * zelden letterlijk wat er staat:
 *
 * - leesrichting en scheidingstekens verschillen (`PIA-4T-8412`, `PIA 4T 8412`,
 *   `pia4t8412`);
 * - en een handvol tekens is in bedrukte, kleine letters gewoon niet te
 *   onderscheiden: `O`/`0`, `I`/`1`/`l`, `S`/`5`, `B`/`8`, `Z`/`2`.
 *
 * `normalizeArticleNumber()` maakt van beide kanten (de gescande tekst én het
 * opgeslagen nummer) dezelfde sleutel, zodat die verschillen wegvallen.
 *
 * ## De prijs daarvan — eerlijk benoemd
 * Tekens samenvouwen maakt de sleutelruimte kleiner, en daarmee botsingen MOGELIJK.
 * Twee nummers die alleen verschillen in een samengevouwen paar worden door deze
 * module als gelijk gezien. Voorbeeld uit de eigen seed-data:
 * `ROF-RO9-L` en een hypothetische `ROF-RO9-1` krijgen dezelfde sleutel `ROF RO9 1`
 * → `R0FR091`. Dat is geen bug maar de rechtstreekse consequentie van het
 * criterium "behandel I/1/l als gelijk"; de tests in
 * `src/lib/__tests__/article-number.test.ts` leggen het vast zodat niemand zich er
 * later op verkijkt.
 *
 * Wat NIET gebeurt, en wat de botsingen beperkt houdt:
 *
 * - er verdwijnt nooit een teken uit het nummer zelf — alleen scheidingstekens
 *   (spaties, streepjes, punten, slashes) vallen weg. `8412` en `8455` blijven dus
 *   verschillend, en `0080` wordt geen `80`;
 * - de LENGTE blijft gelijk, dus nummers van verschillende lengte matchen nooit;
 * - er wordt geen "lijkt erop"-afstand gebruikt (geen Levenshtein, geen fuzzy
 *   score). Alleen exacte gelijkheid van sleutels, of — als laatste redmiddel en
 *   alleen voor nummers van 6 tekens of langer — het letterlijk voorkomen van de
 *   sleutel in de gescande regel.
 *
 * Daarom vraagt de UI ALTIJD om bevestiging voordat er iets met een onderdeel
 * gebeurt (T20: "er wordt nooit automatisch iets gewijzigd").
 */

// ---------------------------------------------------------------------------
// Normaliseren
// ---------------------------------------------------------------------------

/**
 * De OCR-verwisselingen uit de acceptatiecriteria, als afbeelding naar één
 * representant per groep. Na `toUpperCase()` is de lowercase `l` uit "I/1/l" een
 * `L`, dus die staat hier ook in.
 *
 * Elke groep wordt op het CIJFER afgebeeld en niet op de letter: artikelnummers
 * bestaan voor het grootste deel uit cijfers, dus dat levert de minste
 * verschuiving op bij het lezen van een sleutel in een logregel.
 */
const CONFUSABLE_MAP: Record<string, string> = {
  O: "0",
  I: "1",
  L: "1",
  S: "5",
  B: "8",
  Z: "2",
};

/**
 * De tekens die als scheidingsteken gelden en dus volledig wegvallen. Alles wat
 * geen letter en geen cijfer is, wordt verwijderd — dat dekt streepjes, spaties,
 * punten, slashes, underscores, haakjes en de losse puntjes die OCR verzint.
 */
const SEPARATOR_PATTERN = /[^A-Z0-9]/g;

/**
 * Maakt van een ruw nummer de vergelijkingssleutel: hoofdletters, scheidingstekens
 * eruit, verwisselbare tekens samengevouwen.
 *
 * Geeft een lege string terug als er niets bruikbaars overblijft; de aanroeper
 * hoort een lege sleutel nooit als match te laten tellen (zie
 * {@link articleNumbersMatch}).
 *
 * ```ts
 * normalizeArticleNumber("PIA-4T-8412") // "P1A4T8412"
 * normalizeArticleNumber("pia 4t 84i2") // "P1A4T8412"  (I gelezen voor 1)
 * normalizeArticleNumber("NGK-CR7HSA")  // "NGKCR7H5A" (S → 5; G blijft G)
 * ```
 */
export function normalizeArticleNumber(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0) {
    return "";
  }

  const upper = raw.toUpperCase().replace(SEPARATOR_PATTERN, "");

  let key = "";
  for (const char of upper) {
    key += CONFUSABLE_MAP[char] ?? char;
  }
  return key;
}

/**
 * Of twee ruwe nummers na normalisatie hetzelfde zijn. Twee lege of onbruikbare
 * waarden zijn NOOIT gelijk — anders zou een onderdeel zonder artikelnummer op elke
 * mislukte scan matchen.
 */
export function articleNumbersMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizeArticleNumber(a);
  if (left.length === 0) {
    return false;
  }
  return left === normalizeArticleNumber(b);
}

// ---------------------------------------------------------------------------
// Losse stukken uit een OCR-tekst halen
// ---------------------------------------------------------------------------

/**
 * Minimale lengte van een los stukje tekst dat als artikelnummer in aanmerking
 * komt. Korter dan dit levert aan de balie vooral ruis op: `12`, `V2` en `XL` staan
 * op half de verpakkingen.
 */
export const MIN_TOKEN_LENGTH = 4;

/**
 * Minimale lengte van een sleutel voordat een "komt voor in de regel"-treffer mag
 * meetellen. Bij kortere nummers is de kans te groot dat de reeks per ongeluk in een
 * langere reeks cijfers zit (een EAN, een datum, een literinhoud).
 */
export const MIN_CONTAINED_LENGTH = 6;

/**
 * Splitst de tekst in losse stukken die een artikelnummer KUNNEN zijn.
 *
 * Een stuk telt mee als het minstens één cijfer bevat en minstens
 * {@link MIN_TOKEN_LENGTH} tekens lang is. Die cijfer-eis is geen kosmetica: zonder
 * hem matcht elk woord op de verpakking ("REMBLOKKEN", "SCOOTER") tegen elk
 * artikelnummer dat alleen uit letters bestaat.
 *
 * De stukken komen terug in de volgorde waarin ze in de tekst staan, zonder
 * duplicaten, en ONGENORMALISEERD — het normaliseren gebeurt pas bij het
 * vergelijken, zodat de UI de gebruiker nog de letterlijk gelezen tekst kan tonen.
 */
export function extractArticleNumberTokens(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const tokens: string[] = [];

  // Splitsen op alles wat géén letter, cijfer of normaal scheidingsteken binnen een
  // artikelnummer is. Streepjes, punten en slashes horen bij het nummer en blijven
  // dus in het stuk zitten.
  for (const piece of text.split(/[^A-Za-z0-9./-]+/)) {
    const token = piece.replace(/^[-./]+|[-./]+$/g, "");
    if (token.length < MIN_TOKEN_LENGTH) {
      continue;
    }
    if (!/[0-9]/.test(token)) {
      continue;
    }
    const key = token.toUpperCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tokens.push(token);
  }

  return tokens;
}

/**
 * De genormaliseerde sleutel van elke losse REGEL in de tekst, plus van de hele
 * tekst. Hiermee wordt het geval gedekt dat OCR één artikelnummer in losse stukken
 * opbreekt (`PIA 4T 8412`): de losse stukken matchen dan niet, maar de regel als
 * geheel bevat de sleutel `P1A4T8412` wél.
 *
 * Per regel én als geheel, want over regelgrenzen heen plakken zou twee
 * ongerelateerde nummers aan elkaar kunnen knopen en zo een valse treffer maken.
 */
export function normalizedScanLines(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const keys = new Set<string>();
  for (const line of text.split(/[\r\n]+/)) {
    const key = normalizeArticleNumber(line);
    if (key.length > 0) {
      keys.add(key);
    }
  }
  const whole = normalizeArticleNumber(text);
  if (whole.length > 0) {
    keys.add(whole);
  }
  return [...keys];
}

// ---------------------------------------------------------------------------
// Matchen tegen een lijst kandidaten
// ---------------------------------------------------------------------------

/** De velden waarop gematcht wordt, in volgorde van betrouwbaarheid. */
export type ArticleNumberField = "barcode" | "sku" | "supplierArticleNumber";

/**
 * Hoe de treffer tot stand kwam. De UI toont dit, zodat de gebruiker weet hoe hard
 * het bewijs is voordat hij bevestigt:
 *
 * - `exact` — letterlijk hetzelfde (op hoofdletters en witruimte na). Geen
 *   interpretatie nodig.
 * - `normalized` — gelijk ná het samenvouwen van O/0, I/1/l, S/5, B/8, Z/2 of het
 *   weglaten van streepjes/spaties.
 * - `contained` — de sleutel van het nummer komt letterlijk vóór in de gescande
 *   regel, maar de regel bevat meer. Zwakste bewijs; alleen vanaf
 *   {@link MIN_CONTAINED_LENGTH} tekens.
 */
export type ArticleMatchKind = "exact" | "normalized" | "contained";

/** Het minimum dat een kandidaat moet aanleveren om mee te doen. */
export interface ArticleNumberCandidate {
  id: string;
  sku: string;
  barcode: string | null;
  supplierArticleNumber: string | null;
}

export interface ArticleNumberMatch<T extends ArticleNumberCandidate> {
  candidate: T;
  field: ArticleNumberField;
  /** De opgeslagen waarde die matchte, onveranderd. */
  value: string;
  kind: ArticleMatchKind;
}

/** Veldvoorkeur: een barcode is harder bewijs dan een sku, en die dan een artikelnummer. */
const FIELD_ORDER: Record<ArticleNumberField, number> = {
  barcode: 0,
  sku: 1,
  supplierArticleNumber: 2,
};

const KIND_ORDER: Record<ArticleMatchKind, number> = {
  exact: 0,
  normalized: 1,
  contained: 2,
};

const FIELDS: ArticleNumberField[] = ["barcode", "sku", "supplierArticleNumber"];

function fieldValue(
  candidate: ArticleNumberCandidate,
  field: ArticleNumberField,
): string | null {
  switch (field) {
    case "barcode":
      return candidate.barcode;
    case "sku":
      return candidate.sku;
    case "supplierArticleNumber":
      return candidate.supplierArticleNumber;
  }
}

/** Ruwe gelijkheid: alleen hoofdletters en omringende witruimte worden genegeerd. */
function looksExact(scanned: string, stored: string): boolean {
  return scanned.trim().toUpperCase() === stored.trim().toUpperCase();
}

export interface MatchScannedTextOptions {
  /** Maximaal aantal kandidaten dat teruggegeven wordt. Standaard 5. */
  limit?: number;
  /**
   * `true` als de tekst van een BARCODE komt. Dan wordt er niet in losse stukken
   * geknipt en geen "komt voor in de regel"-treffer toegestaan: een barcode is een
   * complete, betrouwbare code en hoort exact (of op z'n hoogst genormaliseerd) te
   * matchen. Zo kan een EAN van 13 cijfers nooit "bijna" op een sku lijken.
   */
  exactOnly?: boolean;
}

/**
 * Zoekt in `candidates` de onderdelen waarvan `sku`, `barcode` of
 * `supplierArticleNumber` overeenkomt met de gescande tekst.
 *
 * De tekst mag een complete barcode zijn, één artikelnummer, of een rommelige
 * OCR-lap van een hele verpakking. Er wordt in deze volgorde gezocht:
 *
 *  1. elk los stuk uit de tekst (zie {@link extractArticleNumberTokens}) tegen de
 *     drie velden, eerst letterlijk en dan genormaliseerd;
 *  2. de hele tekst/regel als één sleutel, voor nummers die OCR in stukken brak;
 *  3. als er dán nog niets is: bevat een regel de sleutel van een nummer van
 *     minstens {@link MIN_CONTAINED_LENGTH} tekens, dan telt dat als zwakke treffer.
 *
 * Stap 3 wordt alleen gezet als stap 1 en 2 niets opleverden. Anders zou een
 * zwakke treffer naast een harde komen te staan en moet de gebruiker kiezen tussen
 * iets wat zeker is en iets wat dat niet is.
 *
 * Per onderdeel komt er maximaal één treffer terug: de sterkste. Het resultaat is
 * gesorteerd op bewijskracht (`kind`), dan op veld, dan op lengte van het nummer
 * (langer = specifieker) en tot slot op id, zodat dezelfde scan altijd dezelfde
 * volgorde geeft.
 */
export function matchScannedText<T extends ArticleNumberCandidate>(
  text: string,
  candidates: readonly T[],
  options: MatchScannedTextOptions = {},
): ArticleNumberMatch<T>[] {
  const limit = options.limit ?? 5;
  if (typeof text !== "string" || text.trim().length === 0) {
    return [];
  }

  const exactOnly = options.exactOnly === true;
  const needles = exactOnly ? [text.trim()] : extractArticleNumberTokens(text);
  const lineKeys = exactOnly
    ? [normalizeArticleNumber(text)].filter((key) => key.length > 0)
    : normalizedScanLines(text);

  const needleKeys = new Set<string>();
  for (const needle of needles) {
    const key = normalizeArticleNumber(needle);
    if (key.length > 0) {
      needleKeys.add(key);
    }
  }
  for (const key of lineKeys) {
    needleKeys.add(key);
  }

  /** Per onderdeel de sterkste treffer; een tweede, zwakkere treffer vervangt niets. */
  const best = new Map<string, ArticleNumberMatch<T>>();

  const consider = (match: ArticleNumberMatch<T>) => {
    const current = best.get(match.candidate.id);
    if (current === undefined || isStronger(match, current)) {
      best.set(match.candidate.id, match);
    }
  };

  for (const candidate of candidates) {
    for (const field of FIELDS) {
      const stored = fieldValue(candidate, field);
      if (stored === null || stored.trim().length === 0) {
        continue;
      }
      const storedKey = normalizeArticleNumber(stored);
      if (storedKey.length === 0) {
        continue;
      }

      // Stap 1: letterlijk hetzelfde?
      const exactNeedle = needles.find((needle) => looksExact(needle, stored));
      if (exactNeedle !== undefined) {
        consider({ candidate, field, value: stored, kind: "exact" });
        continue;
      }

      // Stap 2: hetzelfde na normaliseren?
      if (needleKeys.has(storedKey)) {
        consider({ candidate, field, value: stored, kind: "normalized" });
      }
    }
  }

  if (best.size === 0 && !exactOnly) {
    // Stap 3: laatste redmiddel. Alleen als er niets hards gevonden is, en alleen
    // voor nummers die lang genoeg zijn om niet toevallig ergens in te zitten.
    for (const candidate of candidates) {
      for (const field of FIELDS) {
        const stored = fieldValue(candidate, field);
        if (stored === null || stored.trim().length === 0) {
          continue;
        }
        const storedKey = normalizeArticleNumber(stored);
        if (storedKey.length < MIN_CONTAINED_LENGTH) {
          continue;
        }
        if (lineKeys.some((line) => line.includes(storedKey))) {
          consider({ candidate, field, value: stored, kind: "contained" });
        }
      }
    }
  }

  return [...best.values()].sort(compareMatches).slice(0, limit);
}

function isStronger<T extends ArticleNumberCandidate>(
  a: ArticleNumberMatch<T>,
  b: ArticleNumberMatch<T>,
): boolean {
  return compareMatches(a, b) < 0;
}

function compareMatches<T extends ArticleNumberCandidate>(
  a: ArticleNumberMatch<T>,
  b: ArticleNumberMatch<T>,
): number {
  const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (byKind !== 0) {
    return byKind;
  }
  const byField = FIELD_ORDER[a.field] - FIELD_ORDER[b.field];
  if (byField !== 0) {
    return byField;
  }
  // Een langer nummer is specifieker en dus waarschijnlijker het bedoelde.
  const byLength = b.value.length - a.value.length;
  if (byLength !== 0) {
    return byLength;
  }
  return a.candidate.id.localeCompare(b.candidate.id);
}
