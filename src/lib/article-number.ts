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
 * - de LENGTE blijft gelijk bij het normaliseren, dus `8412` wordt nooit `841`.
 *
 * Daarom vraagt de UI ALTIJD om bevestiging voordat er iets met een onderdeel
 * gebeurt (T20: "er wordt nooit automatisch iets gewijzigd").
 *
 * ## T25 — benaderend matchen, en waarom dat niet soepeler is dan het lijkt
 * T20 eiste na het normaliseren een EXACTE gelijkheid van sleutels. Eén teken dat
 * buiten het verwisselingslijstje verkeerd gelezen werd (een `6` voor een `G`, een
 * `4` voor een `A`) liet daarmee de hele scan mislukken — precies de klacht uit de
 * werkplaats. De voorraad is echter een bekende, eindige lijst: de app hoeft de
 * tekst niet perfect te lezen, alleen te bepalen wélk bekend nummer het dichtst in
 * de buurt komt.
 *
 * Dat gebeurt met {@link damerauLevenshtein} (inclusief verwisselde tekens), en
 * ALLEEN als er geen hard bewijs is. Drie remmen houden valse treffers tegen — een
 * valse treffer is in deze app erger dan geen treffer, want hij verandert de
 * voorraad van het verkeerde artikel en dat merkt niemand tot de telling:
 *
 *  1. **lengtegrens** — tot en met 2 correcties vanaf 6 tekens, tot en met 1 bij
 *    kortere nummers, en nooit meer dan de helft van het nummer
 *    ({@link allowedCorrections});
 *  2. **onderlinge afstand** — een nummer mag maar zoveel gecorrigeerd worden als
 *    het van het dichtstbijzijnde ANDERE bekende nummer af staat, minus één. Staan
 *    `PIA-4T-8412` en `PIA-4T-8455` op afstand 2 van elkaar, dan is er op die twee
 *    dus maar één correctie toegestaan en kan een scan die van beide 2 tekens
 *    afwijkt nooit één van de twee aanwijzen. Hoe meer de bekende nummers op elkaar
 *    lijken, hoe STRENGER de drempel ({@link minDistanceToOtherCandidate});
 *  3. **ondubbelzinnigheid** — alleen de kandidaten op de KLEINSTE afstand komen
 *    terug. Zijn dat er twee, dan worden ze beide getoond en kiest de gebruiker.
 *    Er wordt nooit één van twee gelijkwaardige kandidaten uitgekozen.
 *
 * Benaderend matchen staat per aanroep aan (`approximate: true`) en nooit voor een
 * BARCODE: die werkt volgens de eigenaar goed en houdt zijn strenge pad (`exactOnly`).
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
// Bewerkingsafstand (T25)
// ---------------------------------------------------------------------------

/**
 * Damerau-Levenshtein-afstand: het minimale aantal invoegingen, verwijderingen,
 * vervangingen en VERWISSELINGEN van twee tekens om `a` in `b` te veranderen.
 *
 * Zelf geschreven en niet uit een pakket: het is twintig regels, het is de kern van
 * de beslissing "is dit hetzelfde onderdeel", en daar wil je geen afhankelijkheid
 * met eigen aannames tussen hebben.
 *
 * Dit is de ECHTE Damerau-Levenshtein en niet de eenvoudiger "optimal string
 * alignment": een verwisseling mag hier ook als er tussen de twee tekens nog iets
 * gebeurd is. Dat verschil is klein (`CA` → `ABC` is 2 in plaats van 3) maar wel het
 * verschil tussen de naam in de acceptatiecriteria en iets wat er alleen op lijkt.
 *
 * `maxDistance` is een afkapgrens: is de afstand groter, dan komt er een getal
 * terug dat alleen "groter dan `maxDistance`" betekent. Dat maakt de functie bij
 * duidelijk verschillende nummers veel goedkoper, want dan hoeft de rest van de
 * matrix niet meer gevuld te worden. De exacte waarde boven de grens is dus niet
 * betrouwbaar; roep zonder grens aan als je het echte getal nodig hebt.
 */
export function damerauLevenshtein(
  a: string,
  b: string,
  maxDistance: number = Number.POSITIVE_INFINITY,
): number {
  if (a === b) {
    return 0;
  }
  const lengthA = a.length;
  const lengthB = b.length;
  if (lengthA === 0) {
    return lengthB;
  }
  if (lengthB === 0) {
    return lengthA;
  }

  // Invoegen en verwijderen kost minstens het lengteverschil: dat is al genoeg om
  // de meeste kandidaten zonder rekenwerk af te wijzen.
  const lengthGap = Math.abs(lengthA - lengthB);
  if (lengthGap > maxDistance) {
    return maxDistance + 1;
  }

  // De matrix heeft een extra rij en kolom vóór de gebruikelijke, waarin de
  // "oneindige" waarden staan die de verwisselingsstap nodig heeft.
  const infinite = lengthA + lengthB;
  const rows: number[][] = [];
  for (let row = 0; row <= lengthA + 1; row += 1) {
    rows.push(new Array<number>(lengthB + 2).fill(0));
  }
  rows[0][0] = infinite;
  for (let i = 0; i <= lengthA; i += 1) {
    rows[i + 1][0] = infinite;
    rows[i + 1][1] = i;
  }
  for (let j = 0; j <= lengthB; j += 1) {
    rows[0][j + 1] = infinite;
    rows[1][j + 1] = j;
  }

  /** Laatste rij waarin een teken voorkwam; de verwisselingsstap zoekt daarin. */
  const lastRowOfChar = new Map<string, number>();

  for (let i = 1; i <= lengthA; i += 1) {
    let lastMatchColumn = 0;
    let rowMinimum = Number.POSITIVE_INFINITY;

    for (let j = 1; j <= lengthB; j += 1) {
      const charA = a[i - 1];
      const charB = b[j - 1];
      const lastRow = lastRowOfChar.get(charB) ?? 0;
      const lastColumn = lastMatchColumn;

      let substitutionCost = 1;
      if (charA === charB) {
        substitutionCost = 0;
        lastMatchColumn = j;
      }

      rows[i + 1][j + 1] = Math.min(
        rows[i][j] + substitutionCost, // vervangen (of gelijk)
        rows[i + 1][j] + 1, // invoegen
        rows[i][j + 1] + 1, // verwijderen
        // verwisselen: twee tekens omgedraaid, met wat ertussen zit als invoeging
        rows[lastRow][lastColumn] +
          (i - lastRow - 1) +
          1 +
          (j - lastColumn - 1),
      );
      rowMinimum = Math.min(rowMinimum, rows[i + 1][j + 1]);
    }

    lastRowOfChar.set(a[i - 1], i);

    // Afkappen: elke volgende rij kan alleen groter worden dan het minimum van
    // deze rij, dus verder rekenen heeft geen zin meer.
    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }
  }

  return rows[lengthA + 1][lengthB + 1];
}

/**
 * De afstand van `needle` tot het BESTE stuk van `haystack`: invoegingen aan het
 * begin en het einde van `haystack` zijn gratis.
 *
 * Nodig omdat de tekstherkenning zelden alleen het artikelnummer teruggeeft. Een
 * regel als `Art.nr: PIA-4T-8455` wordt de sleutel `ARTNRP1A4T8455`, en dat is van
 * `P1A4T8455` vijf tekens verwijderd terwijl het nummer er letterlijk in staat.
 * Door de randen gratis te maken wordt hier 0 gemeten, en in het gemeten geval uit
 * de werkplaats (`Art.nr- PlA-4T.g 455`) precies de ene correctie die er echt is.
 *
 * Alleen de VERVANGING en de verwisseling kosten hier; het is dus een gewone
 * Levenshtein-variant met vrije randen plus verwisselingen van naburige tekens
 * (geen volledige Damerau, want met vrije randen voegt dat niets toe aan de
 * uitkomst en wel een hoop code).
 *
 * Wordt met opzet alleen op LANGE nummers losgelaten (zie
 * {@link MIN_CONTAINED_LENGTH}): een kort nummer zit veel te gemakkelijk "ergens
 * in" een lange reeks cijfers van een EAN of een datum.
 */
export function approximateSubstringDistance(
  needle: string,
  haystack: string,
): number {
  if (needle.length === 0) {
    return 0;
  }
  if (haystack.length === 0) {
    return needle.length;
  }

  const rows = needle.length + 1;
  const columns = haystack.length + 1;
  // Twee vorige rijen bijhouden is genoeg; de verwisselingsstap kijkt één rij en
  // één kolom terug.
  let twoBack: number[] = new Array<number>(columns).fill(0);
  let previous: number[] = new Array<number>(columns).fill(0);
  let current: number[] = new Array<number>(columns).fill(0);

  // Rij 0: een leeg stuk `needle` past op elke plek in `haystack` zonder kosten.
  // Dát is wat de randen gratis maakt.
  previous.fill(0);

  for (let i = 1; i < rows; i += 1) {
    current = new Array<number>(columns).fill(0);
    current[0] = i;
    for (let j = 1; j < columns; j += 1) {
      const cost = needle[i - 1] === haystack[j - 1] ? 0 : 1;
      let value = Math.min(
        previous[j - 1] + cost,
        previous[j] + 1,
        current[j - 1] + 1,
      );
      if (
        i > 1 &&
        j > 1 &&
        needle[i - 1] === haystack[j - 2] &&
        needle[i - 2] === haystack[j - 1]
      ) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }
      current[j] = value;
    }
    twoBack = previous;
    previous = current;
  }

  // De uitkomst is het beste einde: het stuk mag overal in `haystack` ophouden.
  return Math.min(...previous);
}

/**
 * Hoeveel tekens er in een nummer van `keyLength` tekens gecorrigeerd mogen worden.
 *
 * De criteria van T25: tot en met 2 vanaf 6 tekens, tot en met 1 bij kortere. Daar
 * zit één eigen rem bovenop — nooit meer dan de helft van het nummer — zodat een
 * nummer van 2 of 3 tekens niet half herschreven kan worden. Een `A1` dat op elke
 * andere code van twee tekens matcht is geen hulp maar een val.
 */
/** Vanaf deze lengte mogen er 2 tekens gecorrigeerd worden in plaats van 1. */
export const APPROX_LONG_LENGTH = 6;

export function allowedCorrections(keyLength: number): number {
  if (!Number.isFinite(keyLength) || keyLength < 2) {
    return 0;
  }
  const byLength = keyLength >= APPROX_LONG_LENGTH ? 2 : 1;
  return Math.min(byLength, Math.floor((keyLength - 1) / 2));
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
 *   regel, maar de regel bevat meer. Alleen vanaf {@link MIN_CONTAINED_LENGTH}
 *   tekens.
 * - `approximate` — gelijk ná het corrigeren van `distance` losse tekens
 *   (Damerau-Levenshtein, T25). Zwakste bewijs: hier is écht iets anders gelezen
 *   dan er staat. Komt alleen terug als er geen enkele hardere treffer is, en
 *   alleen als de kandidaat ondubbelzinnig de dichtstbijzijnde is.
 */
export type ArticleMatchKind =
  | "exact"
  | "normalized"
  | "contained"
  | "approximate";

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
  /**
   * Hoeveel tekens er gecorrigeerd moesten worden om op dit nummer uit te komen.
   * `0` bij alles behalve `approximate`. De UI noemt dit getal, zodat de gebruiker
   * weet wanneer hij de verpakking moet controleren (T25).
   */
  distance: number;
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
  approximate: 3,
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
  /**
   * `true` staat benaderend matchen toe (T25): als er geen enkele harde treffer is,
   * mag er met een bewerkingsafstand naar het dichtstbijzijnde bekende nummer
   * gezocht worden. Zie de uitleg bovenaan deze module voor de drie remmen.
   *
   * Standaard `false`, en genegeerd als `exactOnly` aanstaat. De aanroeper zet dit
   * bewust aan voor tekstherkenning en handmatige invoer — de twee bronnen waar
   * tekens verkeerd gelezen of getypt worden — en NOOIT voor een barcode.
   */
  approximate?: boolean;
}

/**
 * De kleinste Damerau-Levenshtein-afstand van `key` naar een nummer van een ANDER
 * onderdeel in `candidates`. `Infinity` als er geen ander onderdeel met een nummer
 * is.
 *
 * Dit is de tweede rem uit de uitleg bovenaan. Nummers van hetzelfde onderdeel
 * (sku, barcode én leveranciersnummer) doen niet mee: die wijzen alle drie naar
 * hetzelfde artikel, dus ze kunnen onderling geen verwarring opleveren.
 *
 * Geëxporteerd omdat het de kern van de drempel is en apart te testen hoort te
 * zijn.
 */
export function minDistanceToOtherCandidate<T extends ArticleNumberCandidate>(
  key: string,
  ownCandidateId: string,
  candidates: readonly T[],
): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.id === ownCandidateId) {
      continue;
    }
    for (const field of FIELDS) {
      const other = normalizeArticleNumber(fieldValue(candidate, field));
      if (other.length === 0) {
        continue;
      }
      const distance = damerauLevenshtein(key, other, smallest);
      if (distance < smallest) {
        smallest = distance;
        if (smallest === 0) {
          // Twee onderdelen met hetzelfde nummer: dan is er geen enkele correctie
          // toegestaan. Verder zoeken kan het niet erger maken.
          return 0;
        }
      }
    }
  }
  return smallest;
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
 *  4. en als er dán nog niets is, en alleen met `approximate: true` (T25): het
 *     bekende nummer dat op de kleinste bewerkingsafstand ligt, mits die afstand
 *     binnen de drempels valt en er niet twee kandidaten even dicht bij liggen.
 *
 * Stap 3 en 4 worden alleen gezet als het voorgaande niets opleverde. Anders zou
 * een zwakke treffer naast een harde komen te staan en moet de gebruiker kiezen
 * tussen iets wat zeker is en iets wat dat niet is.
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
        consider({ candidate, field, value: stored, kind: "exact", distance: 0 });
        continue;
      }

      // Stap 2: hetzelfde na normaliseren?
      if (needleKeys.has(storedKey)) {
        consider({
          candidate,
          field,
          value: stored,
          kind: "normalized",
          distance: 0,
        });
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
          consider({
            candidate,
            field,
            value: stored,
            kind: "contained",
            distance: 0,
          });
        }
      }
    }
  }

  if (best.size === 0 && !exactOnly && options.approximate === true) {
    // Stap 4 (T25): niets hards gevonden. Nu mag er gezocht worden naar het
    // bekende nummer dat het DICHTST bij de gelezen tekst ligt.
    for (const match of findApproximateMatches(
      needleKeys,
      lineKeys,
      candidates,
    )) {
      consider(match);
    }
  }

  return [...best.values()].sort(compareMatches).slice(0, limit);
}

/**
 * Stap 4: de kandidaten op de kleinste bewerkingsafstand (T25).
 *
 * Geeft een LEGE lijst als niets binnen de toegestane afstand ligt, en anders
 * ALLE kandidaten op de kleinste gevonden afstand — ook als dat er meer dan één
 * zijn. Dat laatste is met opzet: twee nummers op dezelfde afstand betekent dat de
 * gelezen tekst geen van de twee uitwijst, en dan hoort de gebruiker te kiezen in
 * plaats van de app te gokken.
 *
 * De volgorde van de remmen is hier belangrijk, en niet vrijblijvend:
 *
 *  1. eerst wordt van ELKE kandidaat de afstand gemeten, met alleen de lengtegrens
 *     als budget;
 *  2. dan wordt de kleinste afstand bepaald;
 *  3. en pas dan wordt van de kandidaten op die kleinste afstand gekeken of ze ver
 *     genoeg van de andere bekende nummers af staan. Faalt daar ook maar ÉÉN van,
 *     dan komt er helemaal niets terug.
 *
 * Die laatste regel is het verschil tussen "voorzichtig" en "veilig". Zou de
 * onderlinge-afstandsrem per kandidaat gezet worden, dan zou een nummer dat te veel
 * op zijn buurman lijkt uit de lijst vallen terwijl een DERDE nummer op dezelfde
 * afstand blijft staan — en dan staat er één kandidaat op het scherm terwijl er
 * twee even dicht bij lagen. Precies de valse treffer die hier het ergste is.
 */
function findApproximateMatches<T extends ArticleNumberCandidate>(
  needleKeys: ReadonlySet<string>,
  lineKeys: readonly string[],
  candidates: readonly T[],
): ArticleNumberMatch<T>[] {
  /** Losse stukken die lang genoeg zijn om als heel nummer te vergelijken. */
  const tokenKeys = [...needleKeys].filter(
    (key) => key.length >= MIN_TOKEN_LENGTH,
  );
  if (tokenKeys.length === 0 && lineKeys.length === 0) {
    return [];
  }

  const found: ArticleNumberMatch<T>[] = [];
  let smallest = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    for (const field of FIELDS) {
      const stored = fieldValue(candidate, field);
      if (stored === null || stored.trim().length === 0) {
        continue;
      }
      const storedKey = normalizeArticleNumber(stored);
      const budget = allowedCorrections(storedKey.length);
      if (budget === 0) {
        continue;
      }

      // Rem 1: de lengtegrens. Hier wordt nog niets over de buren gezegd, dus dit
      // is de goedkope zeef die de meeste kandidaten wegstuurt.
      let distance = Number.POSITIVE_INFINITY;
      for (const tokenKey of tokenKeys) {
        if (Math.abs(tokenKey.length - storedKey.length) > budget) {
          continue;
        }
        const measured = damerauLevenshtein(storedKey, tokenKey, budget);
        if (measured < distance) {
          distance = measured;
        }
      }
      // Een lang nummer mag ook ergens IN een gelezen regel zitten, met wat ruis
      // eromheen ("Art.nr: ..."). Alleen vanaf MIN_CONTAINED_LENGTH tekens.
      if (storedKey.length >= MIN_CONTAINED_LENGTH) {
        for (const lineKey of lineKeys) {
          if (lineKey.length + budget < storedKey.length) {
            continue;
          }
          const measured = approximateSubstringDistance(storedKey, lineKey);
          if (measured < distance) {
            distance = measured;
          }
        }
      }

      if (distance === 0 || distance > budget) {
        // Afstand 0 hoort hier niet te kunnen: dan was er een harde treffer en was
        // stap 4 nooit gezet.
        continue;
      }

      if (distance < smallest) {
        smallest = distance;
      }
      found.push({
        candidate,
        field,
        value: stored,
        kind: "approximate",
        distance,
      });
    }
  }

  // Rem 3: alleen de dichtstbijzijnde. Een kandidaat op afstand 2 verdwijnt dus
  // zodra er één op afstand 1 is.
  const nearest = found.filter((match) => match.distance === smallest);

  // Rem 2: staan de nummers op die afstand ver genoeg van de ANDERE bekende
  // nummers af om het verschil te kunnen maken? Zo niet, dan is dit geen treffer
  // maar een gok, en gokken doet deze app niet.
  for (const match of nearest) {
    const storedKey = normalizeArticleNumber(match.value);
    const neighbour = minDistanceToOtherCandidate(
      storedKey,
      match.candidate.id,
      candidates,
    );
    if (match.distance > neighbour - 1) {
      return [];
    }
  }

  return nearest;
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
  // Minder gecorrigeerde tekens = harder bewijs. Alleen van belang bij
  // `approximate`; bij de andere soorten is de afstand altijd 0.
  const byDistance = a.distance - b.distance;
  if (byDistance !== 0) {
    return byDistance;
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
