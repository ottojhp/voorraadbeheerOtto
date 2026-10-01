/**
 * Seed-data voor het voorraadbeheer (T03, zie docs/TASKS.md).
 *
 * Draait via `tsx prisma/seed.ts` (of `npm run db:seed`). Idempotent: ruimt eerst
 * bestaande data op in de volgorde die de foreign keys voorschrijven
 * (StockMutation → Sale → Part → Supplier/Brand), zodat twee keer draaien geen
 * duplicaten en geen crash geeft.
 *
 * Prijzen volgen datamodel v2 (SPEC §3 regel 0): `salePriceIncl` is de prijs op het
 * prijskaartje (INCLUSIEF btw), `purchasePriceExcl` de prijs op de leveranciersfactuur
 * (EXCLUSIEF btw).
 *
 * De seed levert ook een CONSISTENT VOORRAADGROOTBOEK op (`StockMutation`, T17): per
 * onderdeel één `INITIAL`-regel met de beginstand en per verkoop één `SALE`- of
 * `WORKSHOP`-regel, chronologisch, met kloppende `quantityBefore`/`quantityAfter`. De
 * laatste `quantityAfter` per onderdeel is exact de `stockQuantity` die op het
 * onderdeel staat; de seed rekent dat na en faalt hard als het niet klopt.
 *
 * Alle willekeur komt uit één seeded pseudo-random generator (mulberry32), niet uit
 * een extern pakket zoals faker: dezelfde run produceert dezelfde verdeling van
 * prijzen, voorraden en verkopen. De verkoopdata zelf wordt wel gepositioneerd ten
 * opzichte van "nu" (laatste 90 dagen blijft altijd de laatste 90 dagen), maar welke
 * onderdelen op welke relatieve dag verkocht worden ligt door de vaste seed vast.
 */

import {
  PrismaClient,
  Category,
  SaleChannel,
  StockMutationReason,
} from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Deterministische pseudo-random generator (mulberry32). Vaste seed => altijd
// dezelfde reeks getallen, dus reproduceerbare seed-data zonder extern pakket.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let state = seed;
  return function random(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260921;

/**
 * Hoeveel dagen terug de INITIAL-mutaties van het grootboek worden gedateerd. Ligt
 * bewust vóór het verkoopvenster van 90 dagen, zodat elke verkoopmutatie ná de
 * beginstand valt.
 */
const LEDGER_START_DAYS_AGO = 95;
const rand = mulberry32(SEED);

/** Geheel getal tussen min en max, beide inclusief. */
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function pick<T>(items: readonly T[]): T {
  return items[randInt(0, items.length - 1)];
}

// ---------------------------------------------------------------------------
// Merken (SPEC / T03: exacte lijst van de opdrachtgever)
// ---------------------------------------------------------------------------
const BRAND_NAMES = [
  "Vespa",
  "Piaggio",
  "Peugeot",
  "Kymco",
  "SYM",
  "AGM",
  "BTC",
  "Brixton",
  "MT",
  "Rieju",
  "Benelli",
  "Hanway",
  "Aprilia",
  "NIU",
  "Super Soco",
  "Segway",
  "Knaap",
  "Phatfour",
  "Super73",
  "Art",
  "Shark",
  "Roof",
  "Beon",
  "Boxer",
  "Riva",
] as const;

// ---------------------------------------------------------------------------
// Leveranciers (verzonnen, GEEN echte bedrijven/telefoonnummers/e-mailadressen)
// ---------------------------------------------------------------------------
type SupplierSeed = {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

const SUPPLIERS: SupplierSeed[] = [
  {
    name: "Tweewieler Parts Nederland B.V.",
    contactPerson: "R. van Amstel",
    phone: "020-4001234",
    email: "verkoop@tweewielerparts.example.com",
    address: "Havenweg 12\n1013 AB Amsterdam",
    notes: "Vaste leverancier voor rem- en motoronderdelen, levert 2x per week.",
  },
  {
    name: "Noordzee Onderdelen Import B.V.",
    contactPerson: "S. Dekker",
    phone: "010-2987654",
    email: "orders@noordzee-onderdelen.example.com",
    address: "Waalhavenweg 88\n3087 BN Rotterdam",
    notes: "Importeur van banden en accu's; bestellingen boven €250 zonder verzendkosten.",
  },
  {
    name: "Van Doorn Tweewielergroothandel",
    contactPerson: "M. van Doorn",
    phone: "030-6541122",
    email: "info@vandoorn-groothandel.example.com",
    address: "Kanaalweg 45\n3526 KL Utrecht",
    notes: "Helmen en accessoires, ook kleine bestellingen mogelijk.",
  },
  {
    name: "E-Mobility Import Nederland B.V.",
    contactPerson: "J. Hendriksen",
    phone: "038-4551090",
    email: "support@emobility-import.example.com",
    address: "Voorsterweg 7\n8021 AL Zwolle",
    notes: "Gespecialiseerd in e-bike-, fatbike- en scootmobielonderdelen.",
  },
];

// ---------------------------------------------------------------------------
// Onderdelen
// ---------------------------------------------------------------------------
type PartSeed = {
  key: string;
  name: string;
  category: Category;
  brand: (typeof BRAND_NAMES)[number] | null;
  sku: string;
  hasBarcode: boolean;
  /** Artikelnummer van de leverancier/fabrikant; niet elk artikel heeft er een. */
  supplierArticleNumber?: string;
  /** Inkoopprijs EXCL. btw, zoals op de leveranciersfactuur. */
  purchasePriceExcl: number;
  /** Verkoopprijs INCL. btw: het bedrag op het prijskaartje (SPEC §3 regel 0). */
  salePriceIncl: number;
  vatRate: number;
  minStock: number;
  supplierIndex: number | null;
  fitsModels?: string;
  location?: string;
  description?: string;
};

const PARTS: PartSeed[] = [
  // --- SCOOTER_PART -----------------------------------------------------
  {
    key: "remblokken-voor-vespa",
    name: "Remblokkenset voorzijde",
    category: Category.SCOOTER_PART,
    brand: "Vespa",
    sku: "SCO-VES-001",
    hasBarcode: true,
    supplierArticleNumber: "PIA-4T-8412",
    purchasePriceExcl: 12.5,
    salePriceIncl: 29.95,
    vatRate: 21,
    minStock: 8,
    supplierIndex: 0,
    fitsModels: "Vespa Primavera 2014-2021, Sprint 125-150",
    location: "A1-01",
  },
  {
    key: "remblokken-achter-piaggio",
    name: "Remblokkenset achterzijde",
    category: Category.SCOOTER_PART,
    brand: "Piaggio",
    sku: "SCO-PIA-002",
    hasBarcode: true,
    supplierArticleNumber: "PIA-4T-8455",
    purchasePriceExcl: 11.0,
    salePriceIncl: 26.95,
    vatRate: 21,
    minStock: 6,
    supplierIndex: 0,
    fitsModels: "Piaggio Liberty 125, Medley 125-150",
    location: "A1-02",
  },
  {
    key: "luchtfilter-peugeot",
    name: "Luchtfilter",
    category: Category.SCOOTER_PART,
    brand: "Peugeot",
    sku: "SCO-PEU-003",
    hasBarcode: true,
    supplierArticleNumber: "PEU-AF-72310",
    purchasePriceExcl: 8.75,
    salePriceIncl: 21.95,
    vatRate: 21,
    minStock: 5,
    supplierIndex: 0,
    fitsModels: "Peugeot Tweet 125, Django 125-150",
  },
  {
    key: "vsnaar-kymco",
    name: "V-snaar variateur",
    category: Category.SCOOTER_PART,
    brand: "Kymco",
    sku: "SCO-KYM-004",
    hasBarcode: true,
    supplierArticleNumber: "KYM-VB-11907",
    purchasePriceExcl: 18.4,
    salePriceIncl: 41.95,
    vatRate: 21,
    minStock: 6,
    supplierIndex: 0,
    fitsModels: "Kymco Agility 125-150, People S 125",
    location: "A2-05",
  },
  {
    key: "rollenset-sym",
    name: "Rollenset variateur",
    category: Category.SCOOTER_PART,
    brand: "SYM",
    sku: "SCO-SYM-005",
    hasBarcode: true,
    supplierArticleNumber: "SYM-RL-3320",
    purchasePriceExcl: 9.9,
    salePriceIncl: 23.95,
    vatRate: 21,
    minStock: 4,
    supplierIndex: 0,
    fitsModels: "SYM Symphony 125-150",
  },
  {
    key: "remkabel-agm",
    name: "Remkabel achter",
    category: Category.SCOOTER_PART,
    brand: "AGM",
    sku: "SCO-AGM-006",
    hasBarcode: true,
    purchasePriceExcl: 6.25,
    salePriceIncl: 16.5,
    vatRate: 21,
    minStock: 5,
    supplierIndex: 0,
  },
  {
    key: "voorband-rieju",
    name: "Voorband 100/80-16",
    category: Category.SCOOTER_PART,
    brand: "Rieju",
    sku: "SCO-RIE-007",
    hasBarcode: true,
    supplierArticleNumber: "NZ-TYR-10080-16",
    purchasePriceExcl: 28.0,
    salePriceIncl: 63.95,
    vatRate: 21,
    minStock: 4,
    supplierIndex: 1,
    fitsModels: "Rieju MRT 50-125",
    location: "B1-03",
  },

  // --- MOTOR_PART ---------------------------------------------------------
  {
    key: "koppelingsveren-brixton",
    name: "Koppelingsverenset",
    category: Category.MOTOR_PART,
    brand: "Brixton",
    sku: "MOT-BRI-008",
    hasBarcode: true,
    supplierArticleNumber: "BRX-CLS-4471",
    purchasePriceExcl: 14.5,
    salePriceIncl: 33.95,
    vatRate: 21,
    minStock: 4,
    supplierIndex: 0,
    fitsModels: "Brixton Crossfire 125-500",
  },
  {
    key: "bougie-mt",
    name: "Bougie",
    category: Category.MOTOR_PART,
    brand: "MT",
    sku: "MOT-MT-009",
    hasBarcode: true,
    supplierArticleNumber: "NGK-CR7HSA",
    purchasePriceExcl: 3.75,
    salePriceIncl: 10.5,
    vatRate: 21,
    minStock: 10,
    supplierIndex: 0,
    fitsModels: "MT Distar 125, Echo 125",
  },
  {
    key: "achterband-benelli",
    name: "Achterband 120/70-12",
    category: Category.MOTOR_PART,
    brand: "Benelli",
    sku: "MOT-BEN-010",
    hasBarcode: true,
    supplierArticleNumber: "NZ-TYR-12070-12",
    purchasePriceExcl: 31.0,
    salePriceIncl: 69.95,
    vatRate: 21,
    minStock: 3,
    supplierIndex: 1,
    fitsModels: "Benelli 125-300 modellen met 12 inch velg",
  },
  {
    key: "kettingset-hanway",
    name: "Kettingset (ketting + tandwielen)",
    category: Category.MOTOR_PART,
    brand: "Hanway",
    sku: "MOT-HAN-011",
    hasBarcode: true,
    supplierArticleNumber: "HW-CHK-125-300",
    purchasePriceExcl: 42.0,
    salePriceIncl: 95.95,
    vatRate: 21,
    minStock: 3,
    supplierIndex: 0,
    fitsModels: "Hanway Furious 125-300",
  },
  {
    key: "startmotor-aprilia",
    name: "Startmotor",
    category: Category.MOTOR_PART,
    brand: "Aprilia",
    sku: "MOT-APR-012",
    hasBarcode: true,
    supplierArticleNumber: "APR-SM-58021",
    purchasePriceExcl: 55.0,
    salePriceIncl: 119.95,
    vatRate: 21,
    minStock: 2,
    supplierIndex: 0,
    fitsModels: "Aprilia SR 125-150, RS 125",
  },

  // --- EBIKE_PART -----------------------------------------------------
  {
    key: "accu12v-niu",
    name: "Accupack 12V lithium",
    category: Category.EBIKE_PART,
    brand: "NIU",
    sku: "EBK-NIU-013",
    hasBarcode: true,
    supplierArticleNumber: "NIU-BAT-12L-04",
    purchasePriceExcl: 145.0,
    salePriceIncl: 299,
    vatRate: 21,
    minStock: 3,
    supplierIndex: 3,
    fitsModels: "NIU NQi, MQi, UQi series",
    location: "C1-01",
  },
  {
    key: "controller-supersoco",
    name: "Motorcontroller",
    category: Category.EBIKE_PART,
    brand: "Super Soco",
    sku: "EBK-SSO-014",
    hasBarcode: true,
    supplierArticleNumber: "SSO-CTRL-72V-02",
    purchasePriceExcl: 89.0,
    salePriceIncl: 192.5,
    vatRate: 21,
    minStock: 2,
    supplierIndex: 3,
    fitsModels: "Super Soco CUx, CPx",
  },
  {
    key: "laadkabel-segway",
    name: "Laadkabel met adapter",
    category: Category.EBIKE_PART,
    brand: "Segway",
    sku: "EBK-SEG-015",
    hasBarcode: true,
    supplierArticleNumber: "SEG-CHG-A21",
    purchasePriceExcl: 22.0,
    salePriceIncl: 47.95,
    vatRate: 21,
    minStock: 4,
    supplierIndex: 3,
    fitsModels: "Segway Ninebot e-scooters",
  },
  {
    key: "middenmotor-knaap",
    name: "Middenmotor 250W",
    category: Category.EBIKE_PART,
    brand: "Knaap",
    sku: "EBK-KNA-016",
    hasBarcode: true,
    supplierArticleNumber: "KNP-MM-250W",
    purchasePriceExcl: 165.0,
    salePriceIncl: 349,
    vatRate: 21,
    minStock: 2,
    supplierIndex: 3,
    fitsModels: "Knaap fatbike-modellen",
  },
  {
    key: "display-phatfour",
    name: "LCD-display eenheid",
    category: Category.EBIKE_PART,
    brand: "Phatfour",
    sku: "EBK-PHF-017",
    hasBarcode: true,
    supplierArticleNumber: "PHF-DSP-FLX2",
    purchasePriceExcl: 34.0,
    salePriceIncl: 77.95,
    vatRate: 21,
    minStock: 3,
    supplierIndex: 3,
    fitsModels: "Phatfour FL/FLX-serie",
  },

  // --- MOBILITY_PART -----------------------------------------------------
  {
    key: "accu-scootmobiel-riva",
    name: "Accupack scootmobiel 24V",
    category: Category.MOBILITY_PART,
    brand: "Riva",
    sku: "MOB-RIV-018",
    hasBarcode: true,
    supplierArticleNumber: "RIV-BAT-24V-33",
    purchasePriceExcl: 98.0,
    salePriceIncl: 209,
    vatRate: 21,
    minStock: 2,
    supplierIndex: 3,
    fitsModels: "Riva scootmobielen, algemeen 24V",
  },
  {
    key: "band-scootmobiel-boxer",
    name: "Band scootmobiel 3.00-8",
    category: Category.MOBILITY_PART,
    brand: "Boxer",
    sku: "MOB-BOX-019",
    hasBarcode: true,
    purchasePriceExcl: 19.5,
    salePriceIncl: 44.95,
    vatRate: 21,
    minStock: 4,
    supplierIndex: 3,
  },
  {
    key: "stuurhoes-art",
    name: "Stuurhoes scootmobiel",
    category: Category.MOBILITY_PART,
    brand: "Art",
    sku: "MOB-ART-020",
    hasBarcode: true,
    supplierArticleNumber: "ART-SHS-0091",
    purchasePriceExcl: 7.5,
    salePriceIncl: 19.5,
    vatRate: 21,
    minStock: 4,
    supplierIndex: 3,
  },
  {
    key: "voetenplateau-sym",
    name: "Voetenplateau rubber",
    category: Category.MOBILITY_PART,
    brand: "SYM",
    sku: "MOB-SYM-021",
    hasBarcode: true,
    supplierArticleNumber: "SYM-FP-2288",
    purchasePriceExcl: 11.0,
    salePriceIncl: 25.95,
    vatRate: 21,
    minStock: 3,
    supplierIndex: 3,
  },

  // --- HELMET -----------------------------------------------------------
  {
    key: "integraalhelm-shark",
    name: "Integraalhelm maat M",
    category: Category.HELMET,
    brand: "Shark",
    sku: "HEL-SHA-022",
    hasBarcode: true,
    supplierArticleNumber: "SHK-D-SKWAL-M",
    purchasePriceExcl: 95.0,
    salePriceIncl: 215,
    vatRate: 21,
    minStock: 3,
    supplierIndex: 2,
    location: "D1-01",
  },
  {
    key: "jethelm-roof",
    name: "Jethelm maat L",
    category: Category.HELMET,
    brand: "Roof",
    sku: "HEL-ROO-023",
    hasBarcode: true,
    supplierArticleNumber: "ROF-RO9-L",
    purchasePriceExcl: 72.0,
    salePriceIncl: 169,
    vatRate: 21,
    minStock: 4,
    supplierIndex: 2,
  },
  {
    key: "croshelm-beon",
    name: "Crosshelm maat S",
    category: Category.HELMET,
    brand: "Beon",
    sku: "HEL-BEO-024",
    hasBarcode: true,
    supplierArticleNumber: "BEO-B701-S",
    purchasePriceExcl: 38.0,
    salePriceIncl: 89.95,
    vatRate: 21,
    minStock: 3,
    supplierIndex: 2,
  },

  // --- ACCESSORY ----------------------------------------------------------
  {
    key: "topkoffer-piaggio",
    name: "Topkoffer 32L",
    category: Category.ACCESSORY,
    brand: "Piaggio",
    sku: "ACC-PIA-025",
    hasBarcode: true,
    supplierArticleNumber: "PIA-TC-32L",
    purchasePriceExcl: 44.0,
    salePriceIncl: 99.95,
    vatRate: 21,
    minStock: 3,
    supplierIndex: 2,
  },
  {
    key: "handvatverwarming-kymco",
    name: "Handvatverwarmingsset",
    category: Category.ACCESSORY,
    brand: "Kymco",
    sku: "ACC-KYM-026",
    hasBarcode: true,
    supplierArticleNumber: "KYM-HG-5501",
    purchasePriceExcl: 21.0,
    salePriceIncl: 47.95,
    vatRate: 21,
    minStock: 3,
    supplierIndex: 2,
  },
  {
    key: "telefoonhouder-super73",
    name: "Telefoonhouder stuur",
    category: Category.ACCESSORY,
    brand: "Super73",
    sku: "ACC-S73-027",
    hasBarcode: true,
    supplierArticleNumber: "S73-PH-002",
    purchasePriceExcl: 9.5,
    salePriceIncl: 23.95,
    vatRate: 21,
    minStock: 5,
    supplierIndex: 2,
  },
  {
    key: "spiegel-links-btc",
    name: "Spiegel links",
    category: Category.ACCESSORY,
    brand: "BTC",
    sku: "ACC-BTC-028",
    hasBarcode: true,
    supplierArticleNumber: "BTC-MIR-L-08",
    purchasePriceExcl: 6.75,
    salePriceIncl: 16.95,
    vatRate: 21,
    minStock: 4,
    supplierIndex: 2,
  },
  {
    key: "spiegel-rechts-mt",
    name: "Spiegel rechts",
    category: Category.ACCESSORY,
    brand: "MT",
    sku: "ACC-MT-029",
    hasBarcode: true,
    supplierArticleNumber: "MT-MIR-R-08",
    purchasePriceExcl: 6.75,
    salePriceIncl: 16.95,
    vatRate: 21,
    minStock: 4,
    supplierIndex: 2,
  },

  // --- CONSUMABLE ----------------------------------------------------------
  {
    key: "kettingspray-aprilia",
    name: "Kettingspray 400ml",
    category: Category.CONSUMABLE,
    brand: "Aprilia",
    sku: "CON-APR-030",
    hasBarcode: true,
    supplierArticleNumber: "APR-CS-400",
    purchasePriceExcl: 4.5,
    salePriceIncl: 11.95,
    vatRate: 21,
    minStock: 8,
    supplierIndex: 1,
  },
  {
    key: "poetsmiddel-niu",
    name: "Poetsmiddel kunststof 500ml",
    category: Category.CONSUMABLE,
    brand: "NIU",
    sku: "CON-NIU-031",
    hasBarcode: true,
    purchasePriceExcl: 3.9,
    salePriceIncl: 10.5,
    vatRate: 21,
    minStock: 6,
    supplierIndex: 1,
  },

  // --- OTHER ----------------------------------------------------------------
  {
    key: "bandenplakset-vespa",
    name: "Bandenplakset",
    category: Category.OTHER,
    brand: "Vespa",
    sku: "OTH-VES-032",
    hasBarcode: true,
    purchasePriceExcl: 5.5,
    salePriceIncl: 14.95,
    vatRate: 21,
    minStock: 5,
    supplierIndex: 0,
  },
  {
    key: "reservesleutel-peugeot",
    name: "Reservesleutel contactslot (blanco)",
    category: Category.OTHER,
    brand: "Peugeot",
    sku: "OTH-PEU-033",
    hasBarcode: false,
    purchasePriceExcl: 8.0,
    salePriceIncl: 19.95,
    vatRate: 21,
    minStock: 3,
    supplierIndex: 0,
  },

  // --- UNIVERSELE ONDERDELEN (brandId null) --------------------------------
  {
    key: "motorolie-4takt",
    name: "Motorolie 10W-40 4-takt 1L",
    category: Category.CONSUMABLE,
    brand: null,
    sku: "UNI-OIL-034",
    hasBarcode: true,
    supplierArticleNumber: "VD-OIL-1040-1L",
    purchasePriceExcl: 5.2,
    salePriceIncl: 12.95,
    vatRate: 21,
    minStock: 15,
    supplierIndex: 1,
    fitsModels: "Geschikt voor de meeste 4-takt scooters en motoren",
    location: "E1-01",
  },
  {
    key: "motorolie-2takt",
    name: "Motorolie 2-takt zelfmengolie 1L",
    category: Category.CONSUMABLE,
    brand: null,
    sku: "UNI-OIL-035",
    hasBarcode: true,
    supplierArticleNumber: "VD-OIL-2T-1L",
    purchasePriceExcl: 4.8,
    salePriceIncl: 11.95,
    vatRate: 21,
    minStock: 15,
    supplierIndex: 1,
    fitsModels: "Geschikt voor de meeste 2-takt scooters",
  },
  {
    key: "remvloeistof-dot4",
    name: "Remvloeistof DOT4 500ml",
    category: Category.CONSUMABLE,
    brand: null,
    sku: "UNI-OIL-036",
    hasBarcode: true,
    supplierArticleNumber: "VD-BF-DOT4-500",
    purchasePriceExcl: 3.5,
    salePriceIncl: 9.5,
    vatRate: 21,
    minStock: 10,
    supplierIndex: 1,
    fitsModels: "Universeel toepasbaar op hydraulische remsystemen",
  },
  {
    key: "universeel-knipperlicht",
    name: "Universeel LED-knipperlicht",
    category: Category.ACCESSORY,
    brand: null,
    sku: "UNI-ACC-037",
    hasBarcode: true,
    supplierArticleNumber: "VD-LED-IND-12V",
    purchasePriceExcl: 6.9,
    salePriceIncl: 17.5,
    vatRate: 21,
    minStock: 6,
    supplierIndex: 2,
    fitsModels: "Past op de meeste scooters met een 10mm bevestigingsbout",
  },
  {
    key: "universele-binnenband",
    name: "Binnenband 3.00/3.50-10",
    category: Category.SCOOTER_PART,
    brand: null,
    sku: "UNI-BND-038",
    hasBarcode: true,
    purchasePriceExcl: 6.0,
    salePriceIncl: 15.5,
    vatRate: 21,
    minStock: 6,
    supplierIndex: 1,
    fitsModels: "Scooters met 10 inch velg, diverse merken",
  },
  {
    key: "universeel-stuurslot",
    name: "Universeel stuurslot",
    category: Category.OTHER,
    brand: null,
    sku: "UNI-LCK-039",
    hasBarcode: true,
    supplierArticleNumber: "VD-LCK-1830",
    purchasePriceExcl: 14.0,
    salePriceIncl: 32.95,
    vatRate: 21,
    minStock: 4,
    supplierIndex: 2,
    fitsModels: "Universeel, klembereik 18-30mm",
  },
  {
    key: "universele-remblokken",
    name: "Remblokkenset universeel (scooter)",
    category: Category.SCOOTER_PART,
    brand: null,
    sku: "UNI-REM-040",
    hasBarcode: false,
    purchasePriceExcl: 7.9,
    salePriceIncl: 19.5,
    vatRate: 21,
    minStock: 8,
    supplierIndex: 0,
    fitsModels: "Diverse Chinese scootermerken, 220mm remschijf",
  },
];

// Onderdelen die bewust ONDER hun minimumvoorraad gezet worden (T03: minimaal 5).
// We nemen er 6 om ruim boven het minimum te zitten.
const LOW_STOCK_KEYS = [
  "remblokken-voor-vespa",
  "vsnaar-kymco",
  "accu12v-niu",
  "voorband-rieju",
  "integraalhelm-shark",
  "kettingset-hanway",
] as const;

// ---------------------------------------------------------------------------
// Barcodes: deterministisch en gegarandeerd uniek (opklimmende reeks per index).
// ---------------------------------------------------------------------------
function makeBarcode(index: number): string {
  // Begint met een niet-bestaand EAN-prefix (fictief), telt op met een vaste stap
  // zodat elke waarde uniek is, ongeacht de rest van de random-reeks.
  const base = 8_710_000_000_000 + index * 97;
  return String(base);
}

// ---------------------------------------------------------------------------
// Seed-logica
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`Seed gestart (vaste RNG-seed: ${SEED})`);

  // 1. Opruimen in de volgorde die de foreign keys voorschrijven: StockMutation en
  //    Sale eerst (beide verwijzen naar Part, met onDelete: Restrict), dan Part
  //    (verwijst naar Brand/Supplier), dan Supplier en Brand. Zo is de seed
  //    idempotent: twee keer draaien geeft geen duplicaten en geen
  //    foreign-key-fouten.
  await prisma.stockMutation.deleteMany({});
  await prisma.sale.deleteMany({});
  await prisma.part.deleteMany({});
  await prisma.supplier.deleteMany({});
  await prisma.brand.deleteMany({});

  // 2. Merken
  const brandIdByName = new Map<string, string>();
  for (const name of BRAND_NAMES) {
    const brand = await prisma.brand.create({ data: { name } });
    brandIdByName.set(name, brand.id);
  }
  console.log(`  ${brandIdByName.size} merken aangemaakt`);

  // 3. Leveranciers
  const supplierIds: string[] = [];
  for (const supplier of SUPPLIERS) {
    const created = await prisma.supplier.create({ data: supplier });
    supplierIds.push(created.id);
  }
  console.log(`  ${supplierIds.length} leveranciers aangemaakt`);

  // 4. Onderdelen: eerst de beginvoorraad per onderdeel bepalen (deterministisch),
  //    dan de verkopen simuleren tegen die voorraad (nooit negatief door clamping),
  //    en daarna de 6 gekozen onderdelen bewust onder hun minimumvoorraad zetten.
  const initialStockByKey = new Map<string, number>();
  for (const part of PARTS) {
    const range: [number, number] =
      part.category === Category.CONSUMABLE
        ? [20, 60]
        : part.category === Category.EBIKE_PART || part.category === Category.MOBILITY_PART
          ? [8, 25]
          : part.category === Category.HELMET
            ? [6, 18]
            : [15, 45];
    initialStockByKey.set(part.key, randInt(range[0], range[1]));
  }

  type SalePlan = {
    partKey: string;
    quantity: number;
    channel: SaleChannel;
    reference: string | null;
    soldAt: Date;
  };

  const bestsellerKeys = ["remblokken-voor-vespa", "vsnaar-kymco", "accu12v-niu"] as const;

  const now = new Date();
  const TOTAL_SALES = 86; // > 80 vereist door T03
  const stockCounter = new Map(initialStockByKey);
  const salePlans: SalePlan[] = [];
  let workOrderCounter = 350;

  let attempts = 0;
  while (salePlans.length < TOTAL_SALES && attempts < TOTAL_SALES * 6) {
    attempts++;

    const isBestseller = rand() < 0.45;
    // pick() mag NIET binnen de find-predicate staan: die wordt per element uitgevoerd
    // en koos dus telkens opnieuw een andere sleutel, waardoor find meestal niets vond.
    // Het non-null assertion "!" liet dat undefined vervolgens stilletjes door, tot het
    // een regel later op .key stukliep. Sleutel nu één keer kiezen, en netjes falen.
    let part: (typeof PARTS)[number];
    if (isBestseller) {
      const bestsellerKey = pick(bestsellerKeys);
      const found = PARTS.find((p) => p.key === bestsellerKey);
      if (!found) {
        throw new Error(`Bestseller-sleutel bestaat niet in PARTS: ${bestsellerKey}`);
      }
      part = found;
    } else {
      part = pick(PARTS);
    }

    const desiredQty = isBestseller ? randInt(1, 4) : randInt(1, 3);
    const available = stockCounter.get(part.key) ?? 0;
    const quantity = Math.min(desiredQty, available);
    if (quantity < 1) {
      continue; // dit onderdeel heeft nu geen voorraad meer over voor deze simulatie
    }
    stockCounter.set(part.key, available - quantity);

    const isWorkshop = rand() < 1 / 3;
    const channel: SaleChannel = isWorkshop ? SaleChannel.WORKSHOP : SaleChannel.COUNTER;
    let reference: string | null = null;
    if (isWorkshop) {
      workOrderCounter += randInt(1, 5);
      reference = `WO-2026-${String(workOrderCounter).padStart(4, "0")}`;
    }

    const daysAgo = randInt(0, 89);
    const soldAt = new Date(now);
    soldAt.setDate(soldAt.getDate() - daysAgo);
    soldAt.setHours(randInt(9, 18), randInt(0, 59), randInt(0, 59), 0);

    salePlans.push({ partKey: part.key, quantity, channel, reference, soldAt });
  }

  if (salePlans.length < 80) {
    // Zou met de gekozen ranges niet moeten gebeuren, maar wees expliciet i.p.v. een
    // seed die stilzwijgend onder het vereiste aantal verkopen blijft.
    throw new Error(
      `Seed kon maar ${salePlans.length} verkopen plannen (minimaal 80 vereist); vergroot de beginvoorraad of TOTAL_SALES.`,
    );
  }

  // Totaal verkochte stuks per onderdeel; nodig om beginstand en eindstand op elkaar
  // te laten sluiten in het grootboek.
  const soldByKey = new Map<string, number>();
  for (const plan of salePlans) {
    soldByKey.set(plan.partKey, (soldByKey.get(plan.partKey) ?? 0) + plan.quantity);
  }

  // Bewust ondergewaardeerde voorraad voor een vaste selectie onderdelen (minimaal 5
  // vereist door T03). Dit gebeurt NA de verkoopsimulatie en is losgekoppeld van het
  // toeval daarin, zodat het gegarandeerd altijd >= 5 onderdelen oplevert die onder
  // hun minimumvoorraad zitten, met een niet-negatieve voorraad.
  //
  // Sinds T17 wordt de lage eindstand NIET meer los bovenop de simulatie gezet: dat
  // zou het grootboek onverklaarbaar maken (de mutaties zouden op een andere stand
  // uitkomen dan het onderdeel). In plaats daarvan wordt de BEGINSTAND verlaagd naar
  // `gewenste eindstand + alles wat er verkocht is`, zodat INITIAL + alle verkopen
  // precies op de gewenste lage eindstand uitkomen.
  const startStockByKey = new Map(initialStockByKey);
  const finalStockByKey = new Map(stockCounter);
  const minStockByKey = new Map(PARTS.map((p) => [p.key, p.minStock] as const));
  for (const key of LOW_STOCK_KEYS) {
    const sold = soldByKey.get(key) ?? 0;
    // Minimaal 1 stuk beginstand, anders zou de INITIAL-mutatie een delta van 0
    // krijgen en die weigert de database (CHECK "delta" <> 0).
    const forcedStock = sold > 0 ? randInt(0, 3) : randInt(1, 3);
    finalStockByKey.set(key, forcedStock);
    startStockByKey.set(key, forcedStock + sold);
    minStockByKey.set(key, forcedStock + randInt(2, 6));
  }

  // Onderdelen aanmaken met de definitieve voorraad/minimumvoorraad.
  const partIdByKey = new Map<string, string>();
  let barcodeIndex = 0;
  for (const part of PARTS) {
    const created = await prisma.part.create({
      data: {
        name: part.name,
        brandId: part.brand ? (brandIdByName.get(part.brand) ?? null) : null,
        category: part.category,
        sku: part.sku,
        barcode: part.hasBarcode ? makeBarcode(barcodeIndex) : null,
        supplierArticleNumber: part.supplierArticleNumber ?? null,
        purchasePriceExcl: part.purchasePriceExcl,
        salePriceIncl: part.salePriceIncl,
        vatRate: part.vatRate,
        stockQuantity: finalStockByKey.get(part.key) ?? 0,
        minStock: minStockByKey.get(part.key) ?? 0,
        supplierId: part.supplierIndex !== null ? supplierIds[part.supplierIndex] : null,
        fitsModels: part.fitsModels ?? null,
        location: part.location ?? null,
        description: part.description ?? null,
      },
    });
    partIdByKey.set(part.key, created.id);
    barcodeIndex++;
  }
  console.log(`  ${partIdByKey.size} onderdelen aangemaakt`);

  const lowStockCount = PARTS.filter((p) => {
    const stock = finalStockByKey.get(p.key) ?? 0;
    const min = minStockByKey.get(p.key) ?? 0;
    return min > 0 && stock <= min;
  }).length;
  console.log(`  waarvan ${lowStockCount} onder hun minimumvoorraad`);

  // 5. Het voorraadgrootboek opent met de beginstand per onderdeel (T17). Dit
  //    gebeurt VOOR de verkopen, en met een datum die voor het verkoopvenster van 90
  //    dagen ligt, zodat de chronologie van het grootboek klopt.
  const ledgerStart = new Date(now);
  ledgerStart.setDate(ledgerStart.getDate() - LEDGER_START_DAYS_AGO);
  ledgerStart.setHours(8, 0, 0, 0);

  // Draaiende voorraadstand per onderdeel; hiermee worden `quantityBefore` en
  // `quantityAfter` van elke mutatie bepaald.
  const runningStock = new Map<string, number>();

  let mutationCount = 0;
  for (const part of PARTS) {
    const startStock = startStockByKey.get(part.key) ?? 0;
    runningStock.set(part.key, startStock);
    await prisma.stockMutation.create({
      data: {
        partId: partIdByKey.get(part.key)!,
        delta: startStock,
        quantityBefore: 0,
        quantityAfter: startStock,
        reason: StockMutationReason.INITIAL,
        note: "Beginstand bij het aanleggen van het onderdeel (seed-data).",
        createdAt: ledgerStart,
      },
    });
    mutationCount++;
  }
  console.log(`  ${mutationCount} INITIAL-voorraadmutaties aangemaakt`);

  // 6. Verkopen aanmaken met de historische prijzen van het onderdeel op dat moment,
  //    en per verkoop meteen de bijbehorende voorraadmutatie.
  //    (In deze seed is er geen prijshistorie gesimuleerd, dus de *AtSale-velden
  //    komen overeen met de huidige prijs van het onderdeel — dat is toegestaan, de
  //    velden bestaan zodat toekomstige prijswijzigingen de marge niet vervuilen.)
  //
  //    De verkopen worden CHRONOLOGISCH doorlopen (de simulatie hierboven koos de
  //    datums in willekeurige volgorde). Anders zou de voorraadketen in het grootboek
  //    heen en weer springen en zouden `quantityBefore`/`quantityAfter` niet op de
  //    tijdlijn kloppen.
  const chronologicalPlans = [...salePlans].sort(
    (a, b) => a.soldAt.getTime() - b.soldAt.getTime(),
  );

  let workshopCount = 0;
  let counterCount = 0;
  for (const plan of chronologicalPlans) {
    const part = PARTS.find((p) => p.key === plan.partKey);
    const partId = partIdByKey.get(plan.partKey);
    if (!part || !partId) {
      throw new Error(`Onbekend onderdeel in verkoopplan: ${plan.partKey}`);
    }

    const sale = await prisma.sale.create({
      data: {
        partId,
        quantity: plan.quantity,
        // Verkoopprijs INCL. btw, inkoopprijs EXCL. btw (SPEC §3 regel 0, v2.0).
        // De seed geeft geen korting: betaalde prijs = normale prijs (T26).
        salePriceInclAtSale: part.salePriceIncl,
        listPriceInclAtSale: part.salePriceIncl,
        purchasePriceExclAtSale: part.purchasePriceExcl,
        vatRateAtSale: part.vatRate,
        channel: plan.channel,
        reference: plan.reference,
        soldAt: plan.soldAt,
      },
      select: { id: true },
    });

    const before = runningStock.get(plan.partKey) ?? 0;
    const after = before - plan.quantity;
    if (after < 0) {
      // Zou niet kunnen: de simulatie clampt al op de beschikbare voorraad. Toch
      // expliciet, want een negatieve stand in het grootboek is stille datavervuiling
      // (en de database weigert hem via een CHECK-constraint).
      throw new Error(
        `Voorraad van ${plan.partKey} zou negatief worden (${before} - ${plan.quantity}).`,
      );
    }
    runningStock.set(plan.partKey, after);

    await prisma.stockMutation.create({
      data: {
        partId,
        delta: -plan.quantity,
        quantityBefore: before,
        quantityAfter: after,
        // Werkplaatsverbruik krijgt zijn eigen reden, zodat het grootboek zonder
        // join naar `Sale` te lezen is.
        reason:
          plan.channel === SaleChannel.WORKSHOP
            ? StockMutationReason.WORKSHOP
            : StockMutationReason.SALE,
        note: plan.reference,
        saleId: sale.id,
        createdAt: plan.soldAt,
      },
    });
    mutationCount++;

    if (plan.channel === SaleChannel.WORKSHOP) {
      workshopCount++;
    } else {
      counterCount++;
    }
  }
  console.log(
    `  ${salePlans.length} verkopen aangemaakt (${counterCount} balie, ${workshopCount} werkplaats)`,
  );
  console.log(`  ${mutationCount} voorraadmutaties in totaal`);

  // 7. Het grootboek narekenen: de laatste stand uit de mutatiereeks MOET gelijk zijn
  //    aan de `stockQuantity` die op het onderdeel staat. Zonder deze controle zou
  //    een fout in de beginstand of in de verkoopsimulatie een grootboek opleveren
  //    dat er plausibel uitziet maar niet op de voorraad uitkomt — precies het soort
  //    fout dat pas maanden later bij een telling opvalt.
  for (const part of PARTS) {
    const fromLedger = runningStock.get(part.key) ?? 0;
    const onPart = finalStockByKey.get(part.key) ?? 0;
    if (fromLedger !== onPart) {
      throw new Error(
        `Grootboek klopt niet voor ${part.key}: mutaties komen uit op ${fromLedger}, ` +
          `maar het onderdeel staat op ${onPart}.`,
      );
    }
  }
  console.log("  grootboek sluit aan op de voorraadstand van elk onderdeel");

  // Bestseller-check (log-only, ter controle): totaal verkochte stuks per onderdeel.
  const totalsByKey = new Map<string, number>();
  for (const plan of salePlans) {
    totalsByKey.set(plan.partKey, (totalsByKey.get(plan.partKey) ?? 0) + plan.quantity);
  }
  const top3 = [...totalsByKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log("  Top 3 bestsellers (stuks verkocht):");
  for (const [key, total] of top3) {
    const part = PARTS.find((p) => p.key === key)!;
    console.log(`    - ${part.name} (${part.brand ?? "universeel"}): ${total} stuks`);
  }

  console.log("Seed voltooid.");
}

main()
  .catch((error: unknown) => {
    console.error("Seed mislukt:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
