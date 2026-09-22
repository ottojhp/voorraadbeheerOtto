# PROGRESS — bouwlogboek

De bouwsessie schrijft hier na **elke** afgeronde taak een notitie. De
projectmanager-sessie leest deze notitie samen met de diff en keurt de taak goed of af
in `docs/TASKS.md`.

Nieuwste notitie bovenaan.

## [FIX] Voorraadpagina: pure helpers uit client-module gehaald — 2026-09-22
**Status:** klaar voor review

**Aangemaakte bestanden:**
- `src/app/(app)/onderdelen/search-params.ts`

**Gewijzigde bestanden:**
- `src/app/(app)/onderdelen/PartsFilters.tsx`
- `src/app/(app)/onderdelen/page.tsx`
- `src/app/(app)/onderdelen/PartsPagination.tsx`
- `src/lib/__tests__/parts-overview.test.ts`
- `docs/PROGRESS.md` (deze notitie)

**Wat er kapot was:** `/onderdelen` crashte bij elk bezoek met `Error: Attempted to
call normalizeSearchParams() from the server but normalizeSearchParams is on the
client. It's not possible to invoke a client function from the server, it can only be
rendered as a Component or passed to props of a Client Component.` `PartsFilters.tsx`
begint met `"use client"`, maar exporteerde naast het component ook pure hulpfuncties
(`RawSearchParams`, `firstParam`, `normalizeSearchParams`, `UNBRANDED_FILTER_VALUE`,
`GROUP_BY_BRAND_VALUE`, `parsePartsSearchParams`, `buildPartsQuery`). Next.js maakt van
élke export uit een `"use client"`-module een client-referentie — ook van gewone
functies en constanten, niet alleen componenten — dus de servercomponent `page.tsx` kon
die functies niet rechtstreeks aanroepen. Hetzelfde patroon zat al eens eerder in dit
project bij `"use server"`-bestanden (zie de T16- en de daaropvolgende notitie
hierboven); dit is de spiegelversie ervan bij `"use client"`.

**Oplossing:** de pure logica ongewijzigd verplaatst naar een nieuw bestand zonder
`"use client"` (`search-params.ts`). `PartsFilters.tsx` houdt alleen het client
component (`PartsFilters`, `PartsFiltersProps`) over en importeert wat het nodig heeft
uit `./search-params`, zonder die functies opnieuw te exporteren (een re-export uit een
`"use client"`-module geeft dezelfde fout terug). `page.tsx` en `PartsPagination.tsx`
importeren nu rechtstreeks uit `./search-params`; de test
`src/lib/__tests__/parts-overview.test.ts` idem. Geen wijziging aan gedrag, opmaak of
queries — uitsluitend de client/server-scheiding.

**Audit elders:** alle `"use client"`-bestanden onder `src/app/**` gecontroleerd op
dezelfde fout (niet-Component-exports die door een servercomponent worden aangeroepen),
met nadruk op rapportages, verkoop, leveranciers, merken en onderdelen.
`src/app/(app)/rapportages/report-filters.ts` bleek al correct gescheiden: het heeft
geen `"use client"`, en zowel de servercomponent (`page.tsx`) als het client component
(`ReportsFilters.tsx`) en de CSV-export-route (`export/route.ts`) importeren de pure
functies (`normalizeSearchParams`, `buildReportsQuery`, `parseReportSearchParams`, …)
eruit — precies het patroon dat nu ook voor `onderdelen` is toegepast. Alle overige
`"use client"`-bestanden (`error.tsx`, `ArchiveSupplierButton.tsx`, `SupplierForm.tsx`,
`BrandRow.tsx`, `NewBrandForm.tsx`, `ArchivePartButton.tsx`, `BarcodeField.tsx`,
`PartForm.tsx`, `ReportsFilters.tsx`, `RevenueBarChart.tsx`, `QuantityStepper.tsx`,
`SaleScreen.tsx`) exporteren uitsluitend componenten en `interface`/`type`-declaraties
(die bij compilatie wegvallen) — geen overtredingen gevonden. `PartsTable.tsx` bevat
géén `"use client"`-directive (de tekst "Geen `use client`" staat alleen in een
commentaarregel die dat expliciet toelicht); dat bestand is terecht een Server
Component.

**Verificatie:**
- `npx tsc --noEmit`: **0 fouten.**
- `npx vitest run`: **331/331 tests groen** (13 testbestanden).
- `npx next build` (rechtstreeks, niet via `npm run build`): **slaagt volledig**,
  inclusief "Generating static pages (7/7)".
- Rendertest tegen de echte database (40 onderdelen, 86 verkopen) via de draaiende
  dev-server op poort 3111, met een geldig sessiecookie (`vb_session`, aangemaakt met
  `createSessionValue()` uit `src/lib/auth.ts` en `SESSION_SECRET` uit `.env`; geen
  wachtwoord ingetypt). Alle zeven pagina's gaven **HTTP 200**:
  `/onderdelen`, `/onderdelen/nieuw`, `/`, `/verkoop`, `/leveranciers`, `/merken`,
  `/rapportages`. (Tussentijds corrumpeerde de rechtstreekse `next build`-stap de
  `.next`-map die de dev-server gebruikte — server herstart om de dev-build opnieuw te
  laten genereren, waarna alle zeven routes opnieuw en foutloos zijn opgehaald.) De
  dev-serverlogs na de herstart tonen geen `normalizeSearchParams`-fout meer en alleen
  succesvolle `GET ... 200`-regels met de bijbehorende Prisma-queries.

## [FIX] Dynamisch renderen voor beschermde routes — 2026-09-22
**Status:** klaar voor review

**Gewijzigde bestanden:**
- `src/app/(app)/layout.tsx`
- `docs/PROGRESS.md` (deze notitie)

**Wat er kapot was:** `npx next build` compileerde en typechecte prima, maar faalde
daarna bij "Generating static pages" op route `/` (`src/app/(app)/page.tsx`, het
dashboard) met `PrismaClientInitializationError: Can't reach database server at
`localhost:5432``. Next.js 15 probeert paginas die geen `dynamic`-export hebben tijdens
de build statisch te prerenderen, en voerde daarbij de databasequeries van het dashboard
uit. Dat is fundamenteel fout, niet alleen omdat er tijdens de build geen database
beschikbaar is: een statisch geprerenderd dashboard zou de cijfers van het buildmoment
voor altijd blijven tonen, terwijl voorraadstanden, lage-voorraadmeldingen en
bestsellers per verzoek vers moeten zijn. Hetzelfde geldt voor het voorraadoverzicht, de
leveranciers, de merken, het verkoopscherm en de rapportages — en de hele applicatie zit
sowieso achter een login, dus statisch renderen levert daar nergens iets op.

**Oplossing:** `export const dynamic = "force-dynamic";` toegevoegd in
`src/app/(app)/layout.tsx`, met een Nederlandse comment erboven die de reden uitlegt.
Deze route-segment-config in de layout geldt voor de hele beschermde routegroep
`(app)`, dus alle onderliggende paginas (dashboard, onderdelen, leveranciers, merken,
verkoop, rapportages) worden voortaan per verzoek server-side gerenderd in plaats van
tijdens de build geprerenderd. Geen wijziging aan gedrag, opmaak, queries, componenten
of validatie — uitsluitend de renderingstrategie. De loginpagina en de API-routes onder
`src/app/api/` raken de database niet tijdens de build en zijn niet aangepast; die
faalden ook niet.

**Verificatie:**
- `npx tsc --noEmit`: **0 fouten.**
- `npx vitest run`: **331/331 tests groen** (13 testbestanden).
- `npx next build` (rechtstreeks, niet via `npm run build`, zonder database beschikbaar):
  **slaagt volledig**, inclusief "Generating static pages (7/7)". Routetabel uit de
  build:

  ```
  Route (app)                              Size     First Load JS
  ┌ ƒ /                                    174 B           109 kB
  ├ ○ /_not-found                          979 B           106 kB
  ├ ƒ /api/auth/login                      151 B           106 kB
  ├ ƒ /api/auth/logout                     151 B           106 kB
  ├ ƒ /leveranciers                        174 B           109 kB
  ├ ƒ /leveranciers/[id]                   1.04 kB         110 kB
  ├ ƒ /leveranciers/[id]/bewerken          1.95 kB         107 kB
  ├ ƒ /leveranciers/nieuw                  1.65 kB         107 kB
  ├ ƒ /login                               151 B           106 kB
  ├ ƒ /merken                              2.27 kB         108 kB
  ├ ƒ /onderdelen                          2.83 kB         112 kB
  ├ ƒ /onderdelen/[id]                     1.07 kB         110 kB
  ├ ƒ /onderdelen/[id]/bewerken            743 B           117 kB
  ├ ƒ /onderdelen/nieuw                    173 B           116 kB
  ├ ƒ /rapportages                         2.23 kB         111 kB
  ├ ƒ /rapportages/export                  151 B           106 kB
  └ ƒ /verkoop                             3.92 kB         117 kB
  + First Load JS shared by all            105 kB
    ├ chunks/4bd1b696-0fab572f2f77338e.js  52.9 kB
    ├ chunks/517-5021c938f23a78a7.js       50.5 kB
    └ other shared chunks (total)          1.98 kB

  ƒ Middleware                             32.8 kB

  ○  (Static)   prerendered as static content
  ƒ  (Dynamic)  server-rendered on demand
  ```

  Alle routes onder `(app)` zijn `ƒ` (dynamisch); alleen `/_not-found` blijft `○`
  (statisch), wat verwacht en onschadelijk is — die pagina bestaat buiten de `(app)`-
  routegroep en raakt de database niet.

## [FIX] use server-exports gesplitst, productiebuild hersteld — 2026-09-22
**Status:** klaar voor review (met één openstaande, buiten-scope bevinding — zie
Verificatie hieronder)
**Aangemaakte bestanden:**
- `src/app/(app)/leveranciers/form-state.ts`
- `src/app/(app)/onderdelen/form-state.ts`
- `src/app/(app)/merken/form-state.ts`

**Gewijzigde bestanden:**
- `src/app/(app)/leveranciers/actions.ts`, `src/app/(app)/onderdelen/actions.ts`,
  `src/app/(app)/merken/actions.ts`
- `src/app/(app)/onderdelen/PartForm.tsx`, `src/app/(app)/onderdelen/ArchivePartButton.tsx`
- `src/app/(app)/leveranciers/SupplierForm.tsx`,
  `src/app/(app)/leveranciers/ArchiveSupplierButton.tsx`
- `src/app/(app)/merken/BrandRow.tsx`, `src/app/(app)/merken/NewBrandForm.tsx`
- `docs/PROGRESS.md` (deze notitie)

**Wat er kapot was:** in Next.js 15 mag een bestand met `"use server"` bovenaan
uitsluitend async functies exporteren; type-exports verdwijnen bij het compileren en
zijn dus toegestaan, maar een geëxporteerde `const` met een object niet. Precies dit
patroon (al eerder gesignaleerd in de T16-notitie hierboven) zat in drie bestanden:
`initialSupplierFormState` + `initialArchiveSupplierFormState` in
`leveranciers/actions.ts`, `initialPartFormState` + `initialArchivePartFormState` in
`onderdelen/actions.ts`, en `initialBrandActionState` in `merken/actions.ts`. Daardoor
faalde `next build` bij het verzamelen van paginadata voor `/leveranciers/[id]` met
`Error: A "use server" file can only export async functions, found object.`

**Oplossing:** per map de betrokken `interface`s én hun `initial*State`-constanten
verplaatst naar een nieuw bestand zonder `"use server"` (`form-state.ts`). De
`actions.ts`-bestanden importeren de types daaruit met `import type` en exporteren ze
niet opnieuw (een re-export van een non-async waarde uit een `"use server"`-bestand
geeft dezelfde fout terug). De zes client components die de constanten gebruikten
(`PartForm.tsx`, `ArchivePartButton.tsx`, `SupplierForm.tsx`,
`ArchiveSupplierButton.tsx`, `BrandRow.tsx`, `NewBrandForm.tsx`) halen de constanten nu
uit `./form-state` in plaats van `./actions`; de server actions zelf (`createPartAction`
e.d.) blijven gewoon uit `./actions` komen. Puur een verplaatsing: dezelfde
statuswaarden, dezelfde veldnamen, dezelfde foutafhandeling, geen gedragswijziging.
Met `grep` over heel `src/` gecontroleerd dat er geen andere importeurs van deze vijf
constanten waren dan de zes genoemde bestanden, en breed gezocht (`grep -rln '"use
server"' src`) naar andere overtredingen: `src/app/(app)/verkoop/actions.ts` en
`src/lib/queries/barcode-lookup.ts` hebben ook `"use server"`, maar exporteren beide al
uitsluitend een `interface`/`type` en async functies — geen overtreding, niet
aangeraakt. `src/app/(app)/verkoop/SaleScreen.tsx` matchte de grep alleen omdat de
tekst `"use server"` in een commentaarregel voorkomt (het is een `"use client"`-bestand)
— evenmin een overtreding.

**Verificatie:**
- `npx tsc --noEmit`: **0 fouten.**
- `npx vitest run`: **331/331 tests groen** (13 testbestanden).
- `npx next build` (rechtstreeks, niet via `npm run build`): de gerapporteerde bug is
  **verholpen** — compileren en typechecken slagen ("✓ Compiled successfully"), en het
  verzamelen van paginadata voor `/leveranciers/[id]` breekt niet langer op de
  `"use server"`-fout. De build komt nu wél verder, tot aan "Generating static pages",
  waar het prerenderen van route `/` ((app)/page.tsx, het dashboard) faalt omdat Prisma
  geen databaseverbinding kan maken:
  `PrismaClientInitializationError: Can't reach database server at `localhost:5432`.`
  Dit is **geen gevolg van deze fix** en valt buiten de toegestane scope van deze taak
  (geen `src/lib/**`, geen gedragswijziging zoals het forceren van dynamic rendering op
  de dashboardpagina) — deze omgeving heeft, zoals vooraf aangegeven, geen draaiende
  database, en `(app)/page.tsx` haalt op dit moment altijd data op tijdens het
  prerenderen (geen `export const dynamic = "force-dynamic"` aanwezig). Met een
  bereikbare Postgres-database op `DATABASE_URL` zou deze stap wel moeten slagen.

## [T16] Deploy naar Vercel en README — 2026-09-22
**Status:** niet klaar voor review — `npx next build` faalt (zie hieronder)
**Gewijzigde bestanden:** package.json (alleen `scripts.build`), README.md (volledig
herschreven), docs/PROGRESS.md. Geen broncode onder `src/` of `prisma/` aangeraakt, zoals
opgedragen.
**package.json:** `"build"` is nu `"prisma generate && prisma migrate deploy && next build"`,
zodat een Vercel-deploy de Prisma-client genereert én openstaande migraties toepast
vóórdat `next build` draait. `postinstall` (`prisma generate`) stond al goed en is
ongewijzigd. `db:seed` (`tsx prisma/seed.ts`) en de `prisma.seed`-config kloppen met
elkaar; hier is niets aan gewijzigd. Overige scripts ongewijzigd.
**README.md:** volledig herschreven in het Nederlands: wat de app doet, vereisten (Node
≥ 18.18, Postgres via Neon/Vercel Postgres — de losse Node 22 uit de bouwomgeving is
bewust NIET vermeld, dat is een lokaal hulpmiddel van deze sessie), lokaal opstarten
stap voor stap, alle vier de omgevingsvariabelen uit SPEC §6 met uitleg en hoe je een
`SESSION_SECRET` genereert (`openssl rand -base64 32`), hoe `APP_PASSWORD` gewijzigd
wordt (met expliciete waarschuwing dat bestaande sessies dan **niet** verlopen — daarvoor
moet ook `SESSION_SECRET` wijzigen, relevant bij uitdiensttreding), deployen naar Vercel
(env vars incl. `DIRECT_URL` voor Neon-migraties, build draait de migraties), een
expliciete sectie dat camerascan HTTPS vereist (werkt op Vercel en op
`http://localhost`, niet op een LAN-IP zoals `http://192.168.1.20:3000`), een
schermenoverzicht, de vastgelegde werkafspraken (prijzen excl. btw + `vatRate`, balie +
werkplaats verlagen beide de voorraad, archiveren i.p.v. verwijderen), verwijzingen naar
SPEC/TASKS/PROGRESS, en een sectie "Bekende beperkingen" (in-memory rate limiting op
serverless, geen verkoop terugdraaien in v1, geen gebruikersaccounts).
**Verificatie:**
- `npx tsc --noEmit`: **0 fouten.**
- `npx vitest run`: **331/331 tests groen** (13 testbestanden), zoals verwacht.
- `npx next build` (rechtstreeks, NIET via `npm run build`, want dat zou nu
  `prisma migrate deploy` aanroepen en dat faalt hier zonder bereikbare database — dit is
  bewust zo getest): **faalt**, en dit is geen gevolg van de ontbrekende database. De
  compile-stap slaagt ("✓ Compiled successfully"), maar het verzamelen van paginadata
  breekt op `/leveranciers/[id]` met:
  `Error: A "use server" file can only export async functions, found object.` Oorzaak:
  `src/app/(app)/leveranciers/actions.ts` (en, hetzelfde patroon, ook
  `src/app/(app)/onderdelen/actions.ts` en `src/app/(app)/merken/actions.ts`) heeft
  `"use server"` bovenaan het bestand, maar exporteert naast de server actions ook
  gewone `const`-objecten (`initialSupplierFormState`, `initialArchivePartFormState`,
  `initialBrandActionState`, e.d.) die als initiële formulierstatus in client components
  worden geïmporteerd. Next.js 15 staat dat niet toe vanuit een `"use server"`-bestand.
  Dit is een bestaand bug in broncode van eerdere taken (T09/T12 e.d.), niet in T16's
  eigen scope — deze sessie heeft géén bestanden onder `src/` aangeraakt om dit op te
  lossen, conform de opdracht. **Acceptatiecriterium "productie-build draait schoon"
  is hierdoor niet gehaald**, en dit moet als aparte fix (bijv. de `initial*State`-
  constanten verplaatsen naar een los bestand zonder `"use server"`) opgepakt worden
  vóór T16 als "klaar voor review" kan gelden.
**Bewust niet gedaan:** geen `vercel.json` aangemaakt (niet nodig, Next.js wordt
automatisch herkend door Vercel); geen wijzigingen aan `.env.example` (was al compleet
en correct volgens SPEC §6); geen wijziging aan broncode om de build-fout op te lossen.

## [T14] Dashboard (F1) — 2026-09-22
**Status:** klaar voor review
**Gewijzigde bestanden:** src/app/(app)/page.tsx (vervangen, was placeholder uit T05),
src/lib/__tests__/dashboard.test.ts (nieuw), docs/PROGRESS.md. `src/lib/queries/dashboard.ts`
is **niet** gewijzigd — zie hieronder.
**Aangetroffen in `src/lib/queries/dashboard.ts`:** een eerdere sessie had dit bestand
(~19 kB) al volledig en correct afgerond, inclusief alle acceptatiecriteria van T14:
`getStockValue` (voorraadwaarde inkoop/verkoop via één `$queryRaw`-som, niet-gearchiveerd,
`COALESCE(...,0)` tegen een lege database), `getDashboardTotals` (unieke onderdelen,
totaal aantal stuks, lage-voorraadtelling), `listLowStockParts` (gesorteerd op grootste
tekort via `sortByShortage`, met leverancier), `listBestsellers` (top N over een periode
of all-time, balie + werkplaats samen, gearchiveerde onderdelen gemarkeerd via
`isArchived`), `listDashboardRecentSales` (hergebruikt `listRecentSales` uit
`@/lib/queries/sales`, verrijkt met archiefstatus) en `getDashboardData` die alles
parallel ophaalt met `Promise.all`. De cruciale hulpfunctie `rawNumericToNumber` (ruwe
`$queryRaw`-waarde — `string`/`Decimal`/`bigint`/`null` — naar een schone `number`, nooit
`NaN`) was al aanwezig en wordt inmiddels ook door `reports.ts` (T15) hergebruikt. Ik heb
dit bestand dus **niet aangevuld**: er ontbrak niets aantoonbaars ten opzichte van
SPEC §F1 en de T14-acceptatiecriteria.
**Consistentiegarantie lage voorraad:** `dashboard.ts` roept voor de lage-voorraadtelling
en -lijst zelf géén eigen `where`-conditie aan, maar hergebruikt letterlijk
`buildPartWhere({ lowStockOnly: true })` uit `@/lib/queries/parts.ts` via de lokale
helper `lowStockWhere()`. Daardoor kunnen dashboard en `/onderdelen?lowStockOnly=1` per
constructie nooit een ander aantal tonen — een toekomstige wijziging aan de definitie
(bv. het randgeval `minStock = 0`) schuift automatisch op beide plekken mee. In
`dashboard.test.ts` bewijs ik dat `prisma.part.count` en `prisma.part.findMany` exact
worden aangeroepen met `buildPartWhere({ lowStockOnly: true })` als `where`; het
randgeval `minStock = 0` zelf is al gedekt in `parts.test.ts` en is hier bewust niet
gedupliceerd.
**`src/app/(app)/page.tsx`:** vervangt de T05-placeholder door het echte dashboard.
Kerncijfers-kaarten (voorraadwaarde inkoop/verkoop, unieke onderdelen, totaal aantal
stuks, aantal onder minimumvoorraad — de laatste als klikbare kaart naar
`/onderdelen?lowStockOnly=1`, opvallend oranje bij een aantal > 0), lage-voorraadlijst
met leverancier en tekort (tabel ≥ md, kaarten < md, zoals `rapportages/page.tsx`),
bestsellers 30 dagen en all-time naast elkaar, laatste 10 verkopen met kanaal via
`getSaleChannelLabel` uit `@/lib/labels`. Alle bedragen via `formatEuro`, met expliciete
"exclusief btw"-tekst in de paginabeschrijving. Eén `getDashboardData()`-aanroep (die
zelf al parallel aggregeert); lege lijsten/nullen geven `EmptyState`s, nooit een crash of
"€ NaN". Op 375px: `grid-cols-2`/`grid-cols-1` en de `Table`/kaart-omschakeling van het
bestaande `Table`-component, dus geen horizontaal scrollen.
**Tests (`dashboard.test.ts`, 30 stuks, `vi.mock("@/lib/db")`):** `rawNumericToNumber`
(null/undefined/NaN/Infinity/string/bigint/Decimal), `readStockValueRows` (lege database
→ 0/0), `getStockValue` tegen een gemockte `$queryRaw`, `sortByShortage` (sortering +
tiebreak + geen mutatie), `rankBestsellers` (optellen per onderdeel, top N, `null`-som →
0), `getDashboardTotals`/`listLowStockParts` (inclusief de where-consistentiecheck
hierboven), `listBestsellers` (verrijking + archiefmarkering + periodefilter), en een
end-to-end `getDashboardData` met een volledig lege, gemockte database die overal nette
nulwaarden/lege lijsten teruggeeft. De gemockte Prisma-client moest `part.fields.minStock`
bevatten (een stand-in field-reference, zoals in `parts.test.ts`) — zonder die marker
crasht `buildPartWhere` op `undefined`, en dat liet in eerste instantie ook
mock-queue-vervuiling zien tussen tests (een nooit-geconsumeerde `mockResolvedValueOnce`
lekte door naar de volgende test); opgelost door de marker toe te voegen zodat elke
aanroep zijn eigen once-mock consumeert.
**Verificatie:** `npx tsc --noEmit` → 0 fouten (hele repo). `npx vitest run` → 331/331
groen (301 bestaand + 30 nieuw), geen flake in `auth.test.ts` opgetreden.
`npx eslint "src/app/(app)/page.tsx" src/lib/queries/dashboard.ts` → schoon.
**Alleen met een echte database te verifiëren:** de dev-server op poort 3111 draait
zonder Postgres-verbinding (`Can't reach database server at localhost:5432`), en dat
raakt in deze omgeving elke pagina (ook `/leveranciers` en `/onderdelen`), niet iets
specifieks aan het dashboard. Niet geverifieerd met echte data: het daadwerkelijke
uiterlijk van de kaarten/tabellen met rijen, of `€ NaN` echt nergens verschijnt bij een
gevulde database, en de visuele mobiele weergave op 375px in de browser.

## [T15] Rapportages (F6) — 2026-09-22
**Status:** klaar voor review
**Gewijzigde bestanden:** src/lib/reporting-period.ts (gerepareerd, zie hieronder),
src/lib/csv.ts (nieuw), src/lib/queries/reports.ts (nieuw),
src/app/(app)/rapportages/page.tsx (nieuw),
src/app/(app)/rapportages/report-filters.ts (nieuw),
src/app/(app)/rapportages/ReportsFilters.tsx (nieuw),
src/app/(app)/rapportages/RevenueBarChart.tsx (nieuw),
src/app/(app)/rapportages/export/route.ts (nieuw),
src/lib/__tests__/reports.test.ts (nieuw), docs/PROGRESS.md
**Eerst gerepareerd — halfafgemaakt `reporting-period.ts`:** een eerdere sessie was
door een API-limiet afgebroken en liet dit bestand (~13 kB, verder grotendeels
compleet en goed gedocumenteerd) achter met 4 TypeScript-fouten op de regels rond
281–304. `PeriodPreset` bevat `"7d" | "30d" | "90d" | "ytd" | "custom"`, maar de
interne helper `presetPeriod()` accepteert bewust alleen de vier vaste presets
(`custom` heeft daar geen betekenis: die tak berekent `from`/`to` uit expliciete
datums, niet uit "N dagen terug"). De concrete breuk zat in
`export const DEFAULT_PRESET: PeriodPreset = "30d";` — door hem als het BREDERE
`PeriodPreset` te typeren (in plaats van het literal te laten staan) verloor
TypeScript de garantie dat `DEFAULT_PRESET` nooit `"custom"` kan zijn, en kon de
compiler de aanroepen `presetPeriod(DEFAULT_PRESET, today)` dus niet meer goedkeuren.
Twee andere plekken casten `presetRaw as Exclude<PeriodPreset, "custom">` inline,
wat prima werkt maar de constructie op drie plekken herhaalde. Opgelost met een
eigen benoemd type `FixedPeriodPreset = Exclude<PeriodPreset, "custom">`, `presetPeriod`
en `DEFAULT_PRESET` daarop hertypeerd, en de twee `as`-casts naar dat ene type
verwezen — geen enkele gedragswijziging, puur het type-onderscheid netjes gemaakt.
De rest van het bestand (kalenderdatum-hulpjes, de Amsterdam⇄UTC-conversie via
`Intl.DateTimeFormat`, `resolveReportingPeriod` met terugval bij ongeldige invoer,
`enumerateDayBuckets`/`enumerateWeekBuckets`) was inhoudelijk al goed en is
overgenomen zoals hij was.
**Tijdzone- en grensconventie:** de server draait op UTC, de winkel in
Europe/Amsterdam. `from`/`to` worden bepaald als 00:00:00.000 resp. 23:59:59.999
Amsterdamse lokale tijd, omgerekend naar de bijbehorende UTC-instant via het
DST-bewuste offset op dát moment (`Intl.DateTimeFormat` met
`timeZone: "Europe/Amsterdam"`, geen vaste UTC+1/+2-aanname en geen tijdzone-library
als dependency). Alle rapportagequery's vergelijken met `soldAt >= from AND soldAt <=
to` (gesloten interval aan beide kanten); dat is veilig omdat `to` op
23:59:59.999 ligt en opeenvolgende periodes dus nooit dezelfde milliseconde-grens
delen. Getest met concrete UTC-instanten in zowel zomertijd (CEST, UTC+2, 1 juli) als
wintertijd (CET, UTC+1, 15 januari) in `reports.test.ts`.
**`$queryRaw`-gebruik en waarom het veilig is:** omzet en marge zijn allebei een som
van een PRODUCT van twee kolommen (`quantity * salePriceAtSale`, resp.
`quantity * (salePriceAtSale - purchasePriceAtSale)`) — dat kan Prisma's
`aggregate`/`groupBy` niet (die sommeren maar één kolom), dus `getReportSummary`,
`getChannelBreakdown`, `getBestsellers`, `getRevenueByBrand`, `getRevenueByCategory`
en `getRevenueOverTime` in `src/lib/queries/reports.ts` gebruiken allemaal
`$queryRaw` met Prisma's tagged template, via een gedeelde `buildWhereSql()` die
`Prisma.sql`/`Prisma.join` gebruikt (zelfde patroon als de bestaande
`getStockValue` in `dashboard.ts`, hier hergebruikt/geïmporteerd i.p.v. gedupliceerd
voor `rawNumericToNumber`). Elke variabele waarde (periode, kanaal, categorie,
limiet) gaat als `${...}` de template in, wat Prisma tot een GEBONDEN
queryparameter maakt — nergens wordt een stuk van de querytekst zelf (kolomnaam,
tabelnaam, filterwaarde) via gewone string-concatenatie opgebouwd. Getest in
`reports.test.ts` ("geeft filterwaarden als queryparameter mee, nooit als tekst in
de SQL zelf"): de test pakt de daadwerkelijke argumenten waarmee de gemockte
`prisma.$queryRaw` is aangeroepen, en controleert dat `"COUNTER"`/`"HELMET"` in het
`values`-array van het `Prisma.Sql`-object staan en NERGENS in de SQL-teksfragmenten
zelf voorkomen. Marge komt overal uit `salePriceAtSale - purchasePriceAtSale` (de
historische prijzen op `Sale`), nooit uit `Part.purchasePrice`/`salePrice`.
**CSV-keuzes (`src/lib/csv.ts`):** puntkomma als kolomscheiding en komma als
decimaalteken (Nederlandse Excel-conventie — Excel-NL gebruikt de komma al als
decimaalteken, dus het kolomscheidingsteken moet iets anders zijn), een UTF-8 BOM
vooraan het bestand (zonder BOM neemt Excel op Windows het systeem-ANSI-codepage aan
en toont "€" en accenten als rommelvinkjes) en CRLF-regeleinden. Elke cel wordt
RFC 4180-gequote (aanhalingstekens verdubbeld) zodra hij het scheidingsteken, een
aanhalingsteken of een regeleinde bevat. De bestandsnaam bevat de periode
(`bestsellers_2026-09-01_2026-09-22.csv`) zodat twee downloads elkaar niet
overschrijven. Toegelicht in een code-comment bij de exportknop op de
rapportagepagina en in `src/lib/csv.ts` zelf.
**Bewust niet gedaan:** geen channel-filter (balie/werkplaats) in de UI, hoewel
`getReportSummary`/`getBestsellers`/etc. dat als optionele parameter wél
ondersteunen — SPEC §F6 vraagt om een UITSPLITSING balie/werkplaats (getoond via
`getChannelBreakdown`, die het kanaalfilter zelf negeert zodat beide rijen altijd
zichtbaar blijven), niet om er los op te filteren; een filter zou de uitsplitsing
zinloos maken. Geen grafiekbibliotheek: de omzetverloop-staafjes zijn eigen
`div`'s/CSS (`RevenueBarChart.tsx`), zoals opgedragen.
**Verificatie:** `npx tsc --noEmit` schoon (incl. de 4 fouten in
`reporting-period.ts` die aan het begin van deze taak stonden). `npx vitest run`:
301/301 tests groen (12 testbestanden: de 266 bestaande + 35 nieuwe in
`reports.test.ts` — periodegrenzen per preset met expliciete UTC-instanten in
zomer- en wintertijd, eigen datumbereik, ongeldige invoer/terugval, `enumerateDay/
WeekBuckets`, CSV-quoting/decimaalkomma/BOM, margeberekening uit rauwe
Postgres-numeric-waarden (string/bigint) en omzet 0 → margepercentage 0 zonder NaN).
Bij een van de `npx vitest run`-runs faalde eenmalig een test in het BESTAANDE
`auth.test.ts` ("weigert een geknoeide handtekening"), niet aangeraakt door deze
taak; in isolatie en bij drie volgende volledige runs slaagde hij steeds — lijkt een
pre-existente flaky test, geen regressie door dit werk.
`npx eslint "src/app/(app)/rapportages" src/lib/queries/reports.ts
src/lib/reporting-period.ts src/lib/csv.ts` schoon. `npx tsc`/`npx vitest`/`npx
eslint` zijn de enige uitgevoerde commando's; `npm run build` is bewust niet
gedraaid (opdracht).
**Openstaand / risico's — alleen met een echte database te verifiëren:** (a) de
daadwerkelijke SQL-uitvoering van alle zes `$queryRaw`-query's (hier alleen tegen
een gemockte `prisma.$queryRaw` getest, die de queryTEKST en -parameters controleert
maar niet of Postgres ze ook echt correct uitvoert); met name de enum-casts
(`::"SaleChannel"`, `::"Category"`) en de `date_trunc(... AT TIME ZONE 'UTC' AT TIME
ZONE 'Europe/Amsterdam')`-expressie voor de dag/week-buckets, die ik alleen tegen de
gedocumenteerde Postgres-semantiek heb geredeneerd, niet tegen een echte server. (b)
Of `date_trunc('week', ...)` in de gebruikte Postgres-versie inderdaad ISO-weken
(maandag) gebruikt zoals de Postgres-documentatie stelt — moet matchen met
`isoWeekStart()` in `reporting-period.ts`. (c) De pagina en de CSV-download zijn
niet visueel in de browser doorlopen (geen database in deze omgeving, en
`/rapportages` staat achter de auth-middleware); de 375px-review is gedaan door de
bestaande Tailwind-patronen (`Table`/mobiele `Card`-grid, zoals `PartsTable.tsx`) te
volgen, niet door de pagina te laden. (d) Prestatie bij een grote `Sale`-tabel is
niet gemeten.

## [T11] Barcode scannen in het onderdeelformulier — 2026-09-22
**Status:** klaar voor review
**Gewijzigde bestanden:** src/app/(app)/onderdelen/PartForm.tsx (uitgebreid),
src/app/(app)/onderdelen/BarcodeField.tsx (nieuw),
src/lib/queries/barcode-lookup.ts (nieuw),
src/lib/__tests__/barcode-lookup.test.ts (nieuw), docs/PROGRESS.md
**Wat is gebouwd:** Het barcodeveld van `PartForm` is afgesplitst naar `BarcodeField`:
een gewoon tekstveld (handmatig invoeren blijft altijd werken, ook zonder camera) met
ernaast een knop "Scan barcode" (min. 44×44px, via de bestaande `Button`) die de T10
`BarcodeScanner` opent. Een geslaagde scan vult het veld en sluit de scanner meteen
(`onScan` roept `onChange(code)` aan en zet `open` op `false`, zoals de props-API van
T10 voorschrijft). Daarnaast controleert `BarcodeField` na een korte stilte na typen of
scannen (400ms debounce) server-side of de barcode al aan een ANDER onderdeel hangt,
via de nieuwe server action `findBarcodeConflict` in `src/lib/queries/barcode-lookup.ts`.
Bij een conflict verschijnt een rode waarschuwing met de naam van dat onderdeel en een
link naar `/onderdelen/[id]`, en wordt de opslaanknop uitgeschakeld totdat de barcode
gewijzigd is. Alle teksten zijn Nederlands; de rij (invoerveld + knop) is een flexrij
die op 375px meepast, net als de rest van het formulier.
**Keuzes en afwijkingen:** (1) **Barcodeveld controlled gemaakt**: het stond als
ongecontroleerd veld (`defaultValue`) in `PartForm`, wat een scan niet programmatisch
kon vullen. Het is nu gecontroleerd met `useState(initialValues?.barcode ?? "")` —
zelfde patroon als de al gecontroleerde prijs-/btw-velden — zodat de waarde na een
serverfout net zo behouden blijft als voorheen (state, niet `defaultValue`, overleeft
een `useActionState`-round-trip zolang de component niet remount). (2) **Eigen-id-
uitsluiting bij bewerken zonder een pagina aan te raken**: `PartForm` kent het `id`
van het onderdeel-in-bewerking niet als prop — dat zit alleen gebonden in de
`action`-prop (`updatePartAction.bind(null, part.id)`), niet uitleesbaar vanuit JS —
en `[id]/bewerken/page.tsx`/`nieuw/page.tsx` vielen buiten de bestanden die voor deze
taak gewijzigd mochten worden. Opgelost met `usePathname()`: een regex
(`/^\/onderdelen\/([^/]+)\/bewerken\/?$/`) leest het id uit het pad zelf. Op
`/onderdelen/nieuw` matcht dit niet (geen eigen id nodig) en op de bewerkpagina levert
het exact het onderdeel-id op dat `.bind()` ook gebruikt — geen prop-wijziging nodig.
Dit is de expliciet genoemde valkuil van de taak; getest in
`barcode-lookup.test.ts` ("sluit het eigen onderdeel-id uit" / "geeft nog steeds het
conflict van een ANDER onderdeel terug als excludePartId is meegegeven"). (3)
**`findBarcodeConflict` filtert NIET op `archivedAt`**, in tegenstelling tot de
bestaande `findPartByBarcode` in `@/lib/queries/parts.ts` (die T12/het verkoopscherm
bedient en gearchiveerde onderdelen bewust uitsluit). De unique constraint op
`Part.barcode` (schema.prisma) geldt óók voor gearchiveerde onderdelen, dus een
barcode van een gearchiveerd onderdeel zou bij opslaan alsnog een P2002 geven — die
wilde ik hier juist wél vooraf signaleren. (4) `findBarcodeConflict` staat als losse
`"use server"`-module in `src/lib/queries/barcode-lookup.ts` (niet in `actions.ts`,
dat was verboden terrein voor deze taak) zodat de client component het rechtstreeks
kan aanroepen; de bestaande P2002-afhandeling in `actions.ts` is ongewijzigd en blijft
het laatste vangnet.
**Bewust niet gedaan:** Geen debounce-annulering op formuliersubmit op zich (race:
snel typen + direct op "Opslaan" klikken vóórdat de 400ms-check terug is) — de
opslaanknop wordt pas na de servercontrole uitgeschakeld. Dat is bewust: de
vriendelijke controle is UX-hulp, de echte garantie is de bestaande P2002-afhandeling
in `actions.ts`, die dit venster altijd dichttimmert.
**Verificatie:** `npx tsc --noEmit` schoon. `npx vitest run`: 266/266 tests groen
(11 testbestanden), incl. de 7 nieuwe in `barcode-lookup.test.ts` (lege/ontbrekende
barcode → null zonder db-aanroep, conflict met een ander onderdeel, eigen barcode bij
bewerken → geen conflict, trimmen, en dat `excludePartId` een écht conflict niet
verbergt). `npx eslint "src/app/(app)/onderdelen" src/lib/queries/barcode-lookup.ts`
schoon. Er is geen database en geen camera in deze omgeving, dus het formulier zelf
kon niet in de browser doorlopen worden (`/onderdelen/nieuw` redirect zonder sessie/db
naar login); de review op 375px is gedaan door de bestaande Tailwind-patronen in het
formulier te volgen (flexrij met `flex-1`/`shrink-0`, zelfde opbouw als de
prijzenvelden hierboven), niet door de pagina visueel te laden.
**Openstaand / risico's:** Op een echt toestel/met database nog te verifiëren: (a) de
scanknop en het formulier op een telefoon van 375px breed (of de knoptekst niet
afbreekt/omvalt naast het invoerveld); (b) het volledige scanpad met camera
(BarcodeScanner zelf is T10's verantwoordelijkheid en hier ongewijzigd, alleen
aangesloten); (c) de dubbele-barcodecontrole live tegen Postgres (hier alleen tegen
een gemockte Prisma-client getest) — met name het bewerk-scenario waarbij het eigen
onderdeel zijn eigen barcode behoudt zonder valse waarschuwing.

## Sjabloon

```
## [Txx] Titel — <datum>
**Status:** klaar voor review
**Gewijzigde bestanden:** pad/naar/bestand.ts, pad/naar/ander.tsx
**Wat is gebouwd:** 2-5 zinnen.
**Keuzes en afwijkingen:** wat wijkt af van SPEC/TASKS en waarom.
**Bewust niet gedaan:** wat buiten de acceptatiecriteria viel.
**Verificatie:** uitkomst van build, tsc, lint en tests; hoe mobiel is gecontroleerd.
**Openstaand / risico's:** wat de reviewer extra moet bekijken.
```

---

## [T07] Voorraadoverzicht (F2) — 2026-09-22
**Status:** klaar voor review
**Gewijzigde bestanden:** src/app/(app)/onderdelen/page.tsx (nieuw),
src/app/(app)/onderdelen/loading.tsx (nieuw),
src/app/(app)/onderdelen/PartsFilters.tsx (nieuw),
src/app/(app)/onderdelen/PartsTable.tsx (nieuw),
src/app/(app)/onderdelen/PartsPagination.tsx (nieuw),
src/lib/__tests__/parts-overview.test.ts (nieuw), docs/PROGRESS.md
**Wat is gebouwd:** `/onderdelen` (server component) leest `searchParams` (in
Next.js 15 een Promise, dus `await`) en haalt daarmee direct de juiste pagina op via
de bestaande `listParts` (T06) — er wordt hier zelf niets gefilterd, gesorteerd of
berekend. ALLE filterstatus staat in de URL: `search`, `brandId` (of
`brandId=unbranded` voor "zonder merk / universeel"), `category`, `supplierId`,
`lowStockOnly`, `sort` (naam/voorraad/marge), `sortDir`, `page` en `group=merk`
(groepering per merk als toggle). `PartsFilters` (client) bevat het zoekveld,
merk/categorie/leverancier-dropdowns (merk- en leverancierslijst uit
`listBrandsWithPartCounts`/`listSuppliers`), de "alleen lage voorraad"- en
"groeperen per merk"-checkboxen en de sorteerbesturing; elke wijziging navigeert
naar een nieuwe URL, dus de pagina blijft deelbaar/herlaadbaar. `PartsTable` toont
naam, merk (of "Universeel"), categorie (NL-label via `labels.ts`), sku, inkoop,
verkoop excl. btw mét incl.-prijs erbij, marge in € en %, voorraad, minimumvoorraad
en leverancier — met `formatEuro` en de al-berekende `margin`/`marginPct`/
`salePriceInclVat`/`isLowStock` uit de `PartDTO`, zonder zelf te rekenen. Lage
voorraad is gemarkeerd met het bestaande `Badge`-component plus een lichte
achtergrondtint op de rij/kaart. Onder `md` toont dezelfde data een kaart per
onderdeel (geen brede tabel, geen horizontaal scrollen); elke kaart is als geheel
een link naar `/onderdelen/[id]`, op desktop is dat de naam-link (zelfde patroon als
het leveranciersoverzicht uit T13). `PartsPagination` (pageSize 50, uit `listParts`)
toont "X–Y van Z onderdelen — pagina P van N" met Vorige/Volgende-links die de
overige filters behouden. Lege resultaten tonen `EmptyState` met een tekst die
onderscheidt tussen "nog geen onderdelen" (geen enkel filter actief) en "geen
onderdelen gevonden" (met een "Filters wissen"-link) — geen extra databasequery
nodig, want dat volgt uit `listParts`' `total` gecombineerd met of er filters actief
zijn.
**Keuzes en afwijkingen:** (1) **Debounce (400ms) i.p.v. zoekknop**: de overige
filters (dropdowns/checkboxes) navigeren al direct bij elke keuze; een aparte
zoekknop zou daarmee inconsistent aanvoelen en een extra tik kosten, terwijl bij
elke toetsaanslag navigeren de lijst en de scrollpositie voortdurend zou laten
springen. Zie de comment bij `handleSearchChange` in `PartsFilters.tsx`. (2) **Pure
URL-logica in `PartsFilters.tsx`, niet in `page.tsx`**: `page.tsx` importeert
`listParts`/`listSuppliers` (en daarmee uiteindelijk Prisma) en mag dus niet
geïmporteerd worden door een client component; `PartsFilters.tsx` importeert alleen
types (`import type`, weggecompileerd) en is dus veilig te delen met
`PartsTable`/`PartsPagination` én rechtstreeks te testen zonder database. (3)
**Sorteren via dropdowns i.p.v. klikbare kolomkoppen**: bij groepering per merk komt
er per merk een eigen `<table>` met eigen kop; twee onafhankelijke sorteerbestellingen
(kolom + richting) als één set dropdowns bovenaan is dan eenduidiger dan
kolomkoppen die in elke groep opnieuw zouden moeten linken. (4) **Groepering
per merk**: elke merkgroep krijgt een eigen kop + eigen tabel/kaartenset;
"Universeel (geen merk)" staat altijd als laatste groep, merken zelf alfabetisch
(NL-collatie) — puur getest via `groupPartsByBrand` in `PartsTable.tsx`.
**Bewust niet gedaan:** geen infinite scroll (SPEC laat "paginering of oneindige
lijst" toe; paginering aansluitend bij de al gebouwde `listParts`-paginering uit T06).
Geen aparte "leeg door filter" vs. "écht leeg" databasequery: afgeleid uit `total`
+ of er filters actief zijn, zoals hierboven beschreven.
**Verificatie:** `npx tsc --noEmit` schoon, `npx eslint "src/app/(app)/onderdelen"`
geen fouten, `npx vitest run` groen (236/236 tests, inclusief de 25 nieuwe in
`parts-overview.test.ts` en alle tests van andere taken). Geen database beschikbaar
in deze omgeving, dus niet met echte data gecontroleerd (verwacht, zie opdracht);
mobiele weergave (375px) beoordeeld op de JSX/Tailwind-classes volgens hetzelfde
patroon als het bestaande leveranciersoverzicht (`hidden md:block` /
`grid gap-3 md:hidden`), niet in een browser met live data.
**Openstaand / risico's:** de reviewer moet met echte (seed-)data controleren of
(a) de URL-parameternamen precies aansluiten op wat `listParts`/`ListPartsParams`
verwacht (`search`, `brandId`, `brandIsNull`, `category`, `supplierId`,
`lowStockOnly`, `sort`, `sortDir`, `page` — 1-op-1 overgenomen), (b) de link naar
`/onderdelen/[id]` daadwerkelijk werkt zodra die route bestaat (T08 bouwt die
gelijktijdig), en (c) de kaartweergave op een echt toestel van 375px prettig
scrolt met langere merknamen/pasvormteksten.

---

## [T08] Onderdeel toevoegen en bewerken (F3) — 2026-09-22
**Status:** klaar voor review
**Gewijzigde bestanden:** src/app/(app)/onderdelen/nieuw/page.tsx (nieuw),
src/app/(app)/onderdelen/[id]/page.tsx (nieuw),
src/app/(app)/onderdelen/[id]/bewerken/page.tsx (nieuw),
src/app/(app)/onderdelen/actions.ts (nieuw),
src/app/(app)/onderdelen/PartForm.tsx (nieuw),
src/app/(app)/onderdelen/ArchivePartButton.tsx (nieuw),
src/lib/validation/parts.ts (nieuw), src/lib/__tests__/parts-form.test.ts (nieuw),
docs/PROGRESS.md
**Wat is gebouwd:** `/onderdelen/nieuw` en `/onderdelen/[id]/bewerken` delen één
client component `PartForm` met alle velden uit het datamodel (SPEC §4): merk,
categorie en leverancier als dropdown (merk/leverancier mogen leeg, categorie
verplicht; de leveranciersdropdown gebruikt `listSuppliers()` uit T13, die
gearchiveerde leveranciers al uitsluit). Btw-tarief is invulbaar met standaard 21.
Tijdens het typen worden marge (€ en %) en de verkoopprijs incl. btw live herberekend
met de bestaande helpers uit `@/lib/money`, duidelijk gelabeld als "(excl. btw)" /
"(incl. btw)". `actions.ts` bevat `createPartAction`, `updatePartAction` en
`archivePartAction` ("use server", Zod-validatie via `@/lib/validation/parts`,
veldgebonden foutmeldingen, `revalidatePath` voor `/onderdelen` en de detailpagina,
redirect naar de detailpagina met een bevestigingsbanner via `?opgeslagen=`).
`[id]/page.tsx` toont alle gegevens, marge, prijzen excl./incl. btw, voorraad,
leverancier (link naar `/leveranciers/[id]`) en een duidelijke "Gearchiveerd"-badge.
Archiveren kan met bevestiging vanaf zowel de detail- als de bewerkpagina
(`ArchivePartButton`, zelfde patroon als `ArchiveSupplierButton` uit T13) en zet
alleen `archivedAt` — nooit een hard delete, dat zou bovendien vastlopen op
`Sale.partId (onDelete: Restrict)` zodra er verkopen tegen het onderdeel geboekt zijn.
**Keuzes en afwijkingen:** (1) **Lege optionele velden → `null`, nooit `""`**, met
name kritiek voor `barcode`: de kolom heeft `@unique` en Postgres behandelt
meerdere `NULL`-waarden als niet-gelijk maar twee lege strings wél als duplicaat. Een
tweede onderdeel zonder barcode zou anders een valse duplicaatfout krijgen. (2)
**Bedragen accepteren komma én punt**: `moneyField`/`vatRateField` in
`@/lib/validation/parts.ts` normaliseren `"12,50"` en `"12.50"` naar dezelfde
puntnotatie vóór de regex-check op maximaal 2 decimalen; alleen niet-negatieve
getallen matchen, dus de `>= 0`-eis is impliciet in de regex voor gehele aantallen en
expliciet (`.refine`) voor bedragen. (3) **P2002 → veld**: `fieldErrorFromUniqueConstraint`
(puur, geen I/O) leest `error.meta.target`, ondersteunt zowel een array van
kolomnamen als een string (kommagescheiden of een constraintnaam als
`"Part_sku_key"`), en zoekt daarin naar `"sku"`/`"barcode"` — zo blijft de vertaling
werken ongeacht hoe de gebruikte Postgres-driver de target teruggeeft. Bij een
onherkenbare P2002 (ander veld) valt de action terug op de generieke foutmelding in
plaats van een 500. (4) Alleen de drie prijs-/btw-velden zijn gecontroleerde inputs
(voor de live berekening); de overige velden gebruiken `defaultValue` zoals
`SupplierForm`, wat ingevulde waarden na een serverfout vanzelf laat staan omdat React
de DOM-inputs niet remount. (5) Bevestiging na opslaan/archiveren loopt via een
`?opgeslagen=aangemaakt|bijgewerkt|gearchiveerd`-queryparameter op de detailpagina in
plaats van een losse toast-component (die bestaat nog niet in `src/components/`).
**Bewust niet gedaan:** geen camerascanknop in het formulier (T11, na deze taak).
`PartForm` is er wel op voorbereid: het barcodeveld staat in een eigen
`<div className="flex items-end gap-2">` met de `Input` op `flex-1`, zodat T11 een
scanknop ernaast kan zetten zonder de rest van het formulier aan te passen. Geen
eigen leesqueries gebouwd: hergebruikt `getPartById` (T06),
`listBrandsWithPartCounts` (T09) en `listSuppliers` (T13). `/onderdelen`,
`loading.tsx`, `PartsFilters.tsx`, `PartsTable.tsx`, `PartsPagination.tsx` zijn niet
aangeraakt (bouwt een andere agent gelijktijdig, T07).
**Verificatie:** `npx tsc --noEmit` schoon. `npx vitest run`: 211/211 tests groen (8
bestanden), inclusief 24 nieuwe tests in `parts-form.test.ts` (Zod-schema: lege
naam/sku, ongeldige categorie, negatieve prijzen, >2 decimalen, "12,50" → 12.5, leeg
btw-tarief → 21, niet-geheel/negatief aantal, leeg merk/leverancier toegestaan, lege
barcode → `null`; en de P2002-vertaler voor zowel `sku` als `barcode`, in array- en
stringvorm van `meta.target`). `npx eslint "src/app/(app)/onderdelen" src/lib/validation/parts.ts`
geeft geen meldingen. `npm run build` bewust niet gedraaid (volgens opdracht). Mobiel
(375px) niet in een browser gecontroleerd — wel doorlopen op basis van de bestaande
`Input`/`Select`/`Textarea`/`Button`-componenten, die al 44px-raakvlakken en
responsive gedrag afdwingen; `purchasePrice`/`salePrice` gebruiken
`inputMode="decimal"`, `stockQuantity`/`minStock` gebruiken `inputMode="numeric"`.
**Openstaand / risico's:** de reviewer moet controleren of `/onderdelen` (T07, elders
in opbouw) daadwerkelijk linkt naar `/onderdelen/nieuw` en `/onderdelen/[id]`, en of
de dropdown-datalagen (`listBrandsWithPartCounts`, `listSuppliers`) niet tegelijk
door T09/T13 zijn gewijzigd op een manier die hier niet meer klopt. De
duplicaatdetectie op `sku`/`barcode` leunt volledig op `error.meta.target`; mocht een
toekomstige Prisma- of Postgres-versie die vorm veranderen, dan valt de vertaling
stil terug op de generieke foutmelding (geen 500, maar ook geen veldgebonden
melding) — dat is bewust de veilige kant, maar goed om te weten.

---

## [T10] Herbruikbare barcodescanner-component — 2026-09-21
**Status:** klaar voor review
**Gewijzigde bestanden:** src/components/BarcodeScanner.tsx (nieuw),
src/lib/barcode.ts (nieuw), src/components/__tests__/barcode-scanner.test.ts (nieuw),
docs/PROGRESS.md
**Wat is gebouwd:** `BarcodeScanner` is een client component dat de camera opent en
een gescande code via `onScan(code)` teruggeeft. Props: `open: boolean`,
`onScan: (code: string) => void`, `onClose?: () => void`,
`formats?: readonly BarcodeFormatName[]` (standaard EAN-13, EAN-8, Code-128 en QR) en
`title?: string`. Beide scanpaden zijn echt geïmplementeerd: `BarcodeDetector` wanneer
de browser die heeft (inclusief `getSupportedFormats()` om de formaten te filteren) en
anders `BrowserMultiFormatReader` uit `@zxing/browser` met `POSSIBLE_FORMATS`-hints.
De pure hulplogica staat in `src/lib/barcode.ts` (formaatvertaling, foutcode →
Nederlandse melding, ontdubbeling van scans) zodat die zonder DOM testbaar is.
**Keuzes en afwijkingen:** (1) **@zxing wordt uitsluitend dynamisch geïmporteerd**
(`await import("@zxing/browser")` / `@zxing/library`) binnen het effect; alleen de
types komen via `import type` binnen en die verdwijnen bij het compileren. De
bibliotheek belandt dus niet in de initiële bundle en het serverrenderen blijft
werken. (2) TypeScript kent `BarcodeDetector` niet: er staat een minimale eigen
typedeclaratie bovenin `BarcodeScanner.tsx`, bewust zónder `declare global` (zo botst
hij niet met een andere agent die hetzelfde nodig heeft) en zonder `any` of
`@ts-ignore`. (3) **Race bij het opruimen**: `getUserMedia` en de dynamische import
zijn async, dus de gebruiker kan het scherm al verlaten hebben voordat de toestemming
binnen is. Het effect houdt een `cancelled`-vlag bij die de cleanup op `true` zet; na
elke `await` wordt die gecontroleerd, en een stream die daarná alsnog binnenkomt wordt
meteen gestopt (`track.stop()` op alle tracks) in plaats van bewaard. `stopEverything`
stopt daarnaast de zxing-controls, de detector-timer en zet `video.srcObject` op
`null` (anders houdt Safari de stream vast). (4) **Ontdubbeling** via `createScanGate`:
dezelfde (genormaliseerde) code wordt binnen 2 seconden genegeerd, maar het venster
schuift niet mee, zodat een code die continu in beeld ligt niet voor altijd
geblokkeerd raakt. (5) De scanner sluit zichzelf **niet** na een scan: het aanroepende
scherm zet `open` op `false` (T11: veld invullen en sluiten) of laat hem open staan
voor de volgende scan (T12). `open={false}` rendert niets én garandeert dat de camera
uit staat. (6) Valt het BarcodeDetector-pad vijf keer achter elkaar om, dan stapt het
component alsnog over op @zxing in plaats van stil te blijven falen. (7) Achtercamera
via `facingMode: { ideal: "environment" }` — bewust `ideal` en niet `exact`, zodat een
laptop met alleen een frontcamera blijft werken. (8) Het videobeeld gebruikt
`playsInline` en `muted` (anders speelt iOS niet af) en een mislukte `play()` breekt
de scan niet af.
**Bewust niet gedaan:** geen koppeling aan het onderdeelformulier (T11) of aan
`/verkoop` (T12) — het component is bewust alleen een bouwsteen. Geen zaklamp/torch,
geen camerakeuze, geen handmatig-invoerveld ín de scanner (de meldingen verwijzen naar
handmatige invoer, die hoort in het aanroepende scherm). Geen wijziging aan
`vitest.config.ts`, `package.json` of welk bestand dan ook buiten de drie hierboven.
**Verificatie:** `npx tsc --noEmit` schoon. `npx vitest run`: **187 tests in 7
bestanden slagen**, waarvan 29 nieuw in `barcode-scanner.test.ts` (formaatmapping incl.
een controle tegen de échte `BarcodeFormat`-enum van `@zxing/library`, filtering op
`getSupportedFormats`, alle foutcodes → melding, normalisatie en ontdubbeling).
`npx eslint` op de drie bestanden: geen meldingen; `npx prettier --check`: schoon.
Omdat Vitest hier in `environment: "node"` draait (en die config niet van deze taak
is) staat er géén DOM-test in de repo; het component is wél buiten de repo om
gecontroleerd met een wegwerp-jsdom-run in de scratchpad, waarin vijf gevallen slagen:
`open={false}` rendert niets en vraagt geen camera, unmounten terwijl `getUserMedia`
nog loopt stopt de stream zodra die alsnog binnenkomt (de race), `open` van `true`
naar `false` stopt de stream, `NotAllowedError` toont de Nederlandse melding met de
terugval op handmatig invoeren, en bij `isSecureContext === false` wordt de camera
helemaal niet gevraagd. Mobiel: de UI is een schermvullende overlay zonder vaste
breedtes (richtkader `w-11/12 max-w-sm`), knoppen zijn minimaal 44×44px; niet in een
echte browser op 375px bekeken.
**Openstaand / risico's:** (1) **Alleen op een echt toestel te verifiëren:** of er
daadwerkelijk een code gelezen wordt, hoe snel dat gaat, en of het beeld scherp genoeg
is — Android/Chrome loopt via `BarcodeDetector`, Safari op iOS via @zxing. Ook de
`playsInline`/`muted`-afhandeling en het daadwerkelijk doven van het cameralampje bij
sluiten zijn alleen fysiek te controleren. (2) Camerascannen vereist https; op
`localhost` werkt het, op een LAN-IP zonder certificaat niet — dat geeft nu een nette
melding in plaats van een vage fout. (3) De @zxing-fallback wordt pas bij het eerste
gebruik gedownload; op een trage verbinding duurt de eerste scan daardoor iets langer
(daarna staat hij in de browsercache). (4) `onScan` krijgt bij een QR-code gewoon de
tekst uit die QR — het aanroepende scherm (T12) bepaalt zelf wat een geldige barcode
is en meldt "geen match".

---

## [T13] Leveranciers (F5) — 2026-09-21
**Status:** klaar voor review
**Gewijzigde bestanden:** src/lib/queries/suppliers.ts (nieuw),
src/lib/validation/suppliers.ts (nieuw), src/app/(app)/leveranciers/page.tsx (nieuw),
src/app/(app)/leveranciers/nieuw/page.tsx (nieuw),
src/app/(app)/leveranciers/[id]/page.tsx (nieuw),
src/app/(app)/leveranciers/[id]/bewerken/page.tsx (nieuw),
src/app/(app)/leveranciers/actions.ts (nieuw),
src/app/(app)/leveranciers/SupplierForm.tsx (nieuw),
src/app/(app)/leveranciers/ArchiveSupplierButton.tsx (nieuw),
src/lib/__tests__/suppliers.test.ts (nieuw), docs/PROGRESS.md (deze notitie).
**Wat is gebouwd:** SPEC §F5 volledig: overzicht (`/leveranciers`) met naam,
contactpersoon, `tel:`-telefoonlink, `mailto:`-e-maillink en aantal gekoppelde
ACTIEVE onderdelen (gefilterde relatie-`_count` in Prisma, geen aparte groupBy
nodig), met kaartweergave onder `md` en EmptyState bij nul leveranciers.
Aanmaken/bewerken via server actions (`createSupplierAction`,
`updateSupplierAction`) met server-side Zod-validatie
(`src/lib/validation/suppliers.ts`) en veldgebonden foutmeldingen; na opslaan
`revalidatePath` + redirect naar de detailpagina. Detailpagina toont
contactgegevens en de gekoppelde actieve onderdelen (naam, sku, voorraad,
minimumvoorraad, verkoopprijs) met links naar `/onderdelen/[id]` (T08, route bestaat
nog niet — link staat er vast). Archiveren (`archiveSupplierAction`, soft delete via
`archivedAt`) vanaf de detail- én de bewerkpagina, met een inline
bevestigingsstap (`ArchiveSupplierButton`, client component). Eigen DTO-types en
mappers in `suppliers.ts` (geen gedeeld types-bestand aangemaakt, zoals gevraagd) en
de pure archiveerregel `canArchiveSupplier(activePartCount)`.
**Keuzes en afwijkingen:**
(1) Archiveerregel is dubbel geborgd maar telt maar één keer echt: de server action
`archiveSupplierAction(id, prevState, formData)` roept zelf éérst
`countActivePartsForSupplier(id)` aan en toetst dat met de pure functie
`canArchiveSupplier` — dit gebeurt ONAFHANKELIJK van wat de client meestuurt (er
wordt zelfs niets uit `formData` gebruikt voor deze check). Bij een tekort komt er
een Nederlandse melding terug met het exacte aantal ("Deze leverancier heeft nog N
actieve onderdelen gekoppeld…") in plaats van archivering. De UI heeft geen eigen
(zwakkere) voorcontrole — er is dus maar één plek waar de regel geldt, en dat is de
server.
(2) `getSupplierById` sluit gearchiveerde leveranciers NIET uit (een directe link
naar een gearchiveerde leverancier blijft werken en toont een "Gearchiveerd"-badge,
met de archiveerknop dan verborgen); alleen `listSuppliers` (het overzicht) sluit ze
uit, conform "gearchiveerde leveranciers verschijnen niet in het overzicht".
(3) Voor de "Nieuwe leverancier"/"Bewerken"-knoppen die naar een andere pagina
linken is bewust géén `<Button>` gebruikt (die rendert een `<button>`, niet
geschikt om in een `<a>` te nestelen) maar een `next/link` met dezelfde Tailwind-
klassen als de primary/secondary `Button`-varianten, om de bestaande stijl over te
nemen zonder `src/components/Button.tsx` aan te raken (buiten mijn bestandenlijst).
(4) Eigen types in `suppliers.ts` importeren bewust niets uit
`src/lib/queries/types.ts` (dat bestand hoort bij T06/parts en wordt gelijktijdig
door een andere taak bewerkt) — geen gedeelde afhankelijkheid, zoals gevraagd.
**Bewust niet gedaan:** geen wijziging aan het onderdeelformulier (T08, andere
agent) om gearchiveerde leveranciers uit de dropdown te weren — dat moet in T08's
eigen leverancierslijst-query gebeuren, niet hier. Geen unieke-naamcontrole voor
leveranciers (SPEC/T13 vraagt dat niet; alleen `Brand.name` is uniek in het
datamodel).
**Verificatie:** `npx tsc --noEmit` schoon. `npx vitest run`: 188/188 tests groen,
inclusief 12 nieuwe tests in `suppliers.test.ts` (Zod-schema: lege naam, naam met
alleen spaties, ongeldig/leeg e-mailadres, lege strings → `null`; de archiveerregel
als pure functie; de DTO-mapper Decimal→number en Date→ISO-string) — geen van de
tests van andere taken (T06 parts, T04 auth, T05 money, barcode-scanner) is geraakt.
`npx eslint` op alle eigen bestanden: 0 errors (één ronde nodig: `no-unused-vars` op
de ongebruikte `prevState`/`formData` in `archiveSupplierAction`, opgelost met
expliciete `void`-statements in plaats van een onderdrukte regel). `npm run build`
NIET gedraaid (opdracht). Mobiel (375px) alleen visueel gecontroleerd via de
Tailwind-klassen (kaartweergave onder `md`, `min-h-[44px]` op alle interactieve
elementen via de bestaande `Button`/`Input`-primitives) — er is geen database, dus
de pagina's zijn niet met echte data in de browser gerenderd.
**Openstaand / risico's:** (a) geen enkele pagina is tegen een echte database
gerenderd (geen DATABASE_URL in deze omgeving) — de reviewer moet
`listSuppliers`/`getSupplierById`/`countActivePartsForSupplier` en de drie server
actions functioneel narekijken zodra er een database beschikbaar is, met name de
gefilterde `_count`-relatie in `listSuppliers` (Prisma-syntax `_count: { select: {
parts: { where: { archivedAt: null } } } }`) en de `bind(null, id)`-patronen voor
`updateSupplierAction`/`archiveSupplierAction` die als prop naar een client
component gaan. (b) De link naar `/onderdelen/[id]` op de detailpagina is ongetest
totdat T08 die route oplevert. (c) `useActionState` (React 19) is hier voor het
eerst in deze codebase gebruikt voor een formulier met server actions — er was nog
geen bestaand voorbeeld om te volgen; graag extra aandacht van de reviewer op dit
patroon omdat latere taken (T08, T09, T12) het vermoedelijk hergebruiken.

---

## [T06] Datalaag onderdelen (queries en DTO's) — 2026-09-21
**Status:** klaar voor review
**Gewijzigde bestanden:** src/lib/queries/parts.ts (nieuw), src/lib/queries/types.ts
(nieuw), src/lib/__tests__/parts.test.ts (nieuw), docs/PROGRESS.md (deze notitie).
**Wat is gebouwd:** De datalaag voor onderdelen die T07 (voorraadoverzicht), T12
(verkoop) en T14 (dashboard) gaan gebruiken. `src/lib/queries/types.ts` bevat de
gedeelde DTO-types (`PartDTO`, `PartSaleOptionDTO`, `BrandFilterOptionDTO`,
`SupplierFilterOptionDTO`, `PaginatedResult<T>`, `PartSort`, `SortDir`) en importeert
met opzet niets uit `@prisma/client`, zodat client components die types mogen
importeren zonder de Prisma-runtime mee te bundelen; de `Category`-union komt uit
`@/lib/labels`. `src/lib/queries/parts.ts` bevat de mapper `toPartDTO` plus
`listParts`, `getPartById`, `findPartByBarcode`, `searchPartsForSale` en
`countUnbrandedParts`, plus de los testbare bouwstenen `buildPartWhere`, `buildPartOrderBy`, `normalizePagination`
en `isLowStock`. Marge, margepercentage en de prijs incl. btw komen uit
`@/lib/money` (`calcMargin`, `calcMarginPct`, `priceWithVat`) — niet opnieuw
geïmplementeerd. Zoeken is case-insensitive (`mode: "insensitive"`) op naam, sku,
barcode én pasvorm; gearchiveerde onderdelen zijn standaard uitgesloten;
`brandIsNull: true` filtert de universele artikelen; paginering staat standaard op
50 rijen (SPEC §F2) met een bovengrens van 200.
**Keuzes en afwijkingen:**
(1) `Decimal` → `number` via `.toNumber()`, niet via `Number(decimal)`. Beide geven
hier hetzelfde antwoord (decimal.js heeft een `valueOf()`), maar `Number()` is een
impliciete conversie die stilletjes `NaN` oplevert zodra de waarde géén Decimal is;
`.toNumber()` is de expliciete API. Precisieverlies speelt niet: de kolommen zijn
`Decimal(10,2)`/`Decimal(5,2)`, dus maximaal 99.999.999,99, ruim binnen
`Number.MAX_SAFE_INTEGER`. Datums gaan als ISO-string naar buiten
(`archivedAt` blijft `null` als het onderdeel niet gearchiveerd is).
(2) `lowStockOnly` vergelijkt twee kolommen (`stockQuantity <= minStock` ÉN
`minStock > 0`). Opgelost met Prisma's **field references**
(`prisma.part.fields.minStock`, GA sinds Prisma 5 — dit project draait 6.2.1). Dat
levert echte SQL op, blijft combineerbaar met de overige filters en houdt `count`,
`orderBy`, `skip` en `take` intact. `$queryRaw` zou de hele where-clause in ruwe SQL
dupliceren en na-filteren in JavaScript zou `total` laten afwijken van wat de
database telde — dus beide afgewezen. De conditie wordt expliciet getest.
(3) Sorteren op marge kan Postgres niet zelf (afgeleide waarde, Prisma's `orderBy`
accepteert geen expressies). Gekozen: twee queries. Stap 1 haalt van álle rijen die
aan het filter voldoen alleen `id`, `name`, `purchasePrice` en `salePrice` op; stap 2
sorteert in JavaScript op marge in euro's, bepaalt `total`, snijdt de gevraagde
pagina eruit en haalt alleen díe rijen volledig op (met herstel van de volgorde,
want `id: { in: [...] }` garandeert geen volgorde). Hiermee blijft paginering
correct. Het alternatief "na-sorteren binnen de pagina" is bewust verworpen: pagina 2
zou dan de 51e t/m 100e rij op náám zijn, binnen die willekeurige deelverzameling op
marge gesorteerd — dat is geen sortering. Consequentie: bij sorteren op marge leest
stap 1 alle gefilterde rijen (drie kleine kolommen, geen relaties). Voor het
assortiment van één winkel verwaarloosbaar; bij tienduizenden rijen is de volgende
stap een gegenereerde margekolom met index, niet ruwe SQL in de datalaag. Sorteren
gebeurt op marge in **euro's** (excl. btw), niet op percentage.
(4) Elke `orderBy` eindigt op `id`, zodat Postgres rijen met dezelfde naam of
voorraad niet per query anders mag ordenen — zonder die tiebreaker kan een rij
tussen twee pagina's verdwijnen of dubbel verschijnen.
(5) `getPartById` geeft óók gearchiveerde onderdelen terug (de bewerkpagina van T08
moet erbij); `findPartByBarcode` sluit ze juist uit, zodat T12 geen gearchiveerd
onderdeel kan verkopen. `searchPartsForSale` zoekt op naam/sku/barcode maar bewust
NIET op pasvorm — aan de balie zoek je het artikel zelf en een vrij pasvormveld geeft
daar vooral ruis; het voorraadoverzicht zoekt wél op pasvorm.
(6) Van de gevraagde hulpfuncties voor T07 is alleen `countUnbrandedParts()`
overgebleven. Tijdens deze taak leverden de agents van T09 en T10 hun eigen datalaag
op, met exact dezelfde tellingen: `listBrandsWithPartCounts()` in
`src/lib/queries/brands.ts` en `listSuppliers()` in `src/lib/queries/suppliers.ts`
(beide alfabetisch, beide met `_count` over `archivedAt: null`). Ik had eerst
`listBrandsWithCounts()` en `listSuppliersForFilter()` gebouwd, maar die weer
verwijderd: twee bijna identieke functies per filterdropdown is precies de rommel die
de opdracht wilde vermijden. T07 haalt de filterdropdowns dus uit `./brands` en
`./suppliers`; "onderdelen zonder merk" is géén merk en heeft geen rij in `Brand`,
dus die telling blijft hier.
(7) Extra ten opzichte van de opdracht: `includeArchived` op `listParts` (nodig voor
de rapportages van T13/T14) en een bovengrens op `pageSize` (200) en op de limiet van
`searchPartsForSale` (50) tegen een opgeblazen URL-parameter. `pageCount` is `0` bij
een leeg resultaat, zodat T07 daarop een EmptyState kan tonen.
**Bewust niet gedaan:** geen queries voor verkopen, dashboard-kerncijfers of
rapportages (T14/T13) — dit bestand gaat alleen over onderdelen. Geen mutaties
(aanmaken/bewerken/archiveren, T08) en geen Zod-schema's: die horen bij de
server actions. Geen groepering per merk in de datalaag; T07 kan dat over het
resultaat van `listParts` doen. Geen caching/`unstable_cache`. Niets buiten
`src/lib/queries/**` en `src/lib/__tests__/parts.test.ts` aangeraakt.
**Verificatie:** `npx tsc --noEmit` schoon. `npx vitest run`: 187 tests groen in 7
bestanden, waarvan 53 nieuw in `parts.test.ts`; de tests van andere agents (auth,
money, barcode-scanner, brands, suppliers, smoke) blijven groen en zijn niet
aangeraakt.
`npx eslint src/lib/queries src/lib/__tests__/parts.test.ts` geeft geen fouten of
waarschuwingen; de drie nieuwe bestanden zijn met Prettier geformatteerd. `npm run
build` is **niet** gedraaid (andere agents werken tegelijk in `src/app/**`, dus een
build zou hun tussenstand meebeoordelen). Er is geen database, dus er zijn bewust
geen integratietests: de mapper, de where/orderBy-opbouw en de paginering worden
puur getest, en de queryfuncties draaien tegen een gemockte `@/lib/db`. Niets
visueels in deze taak, dus geen 375px-controle.
**Openstaand / risico's:**
- De `lowStockOnly`-conditie is alleen tegen een gemockte client getest: dat bewijst
  dat er een field reference in de `where` terechtkomt, niet dat Postgres de
  gegenereerde SQL accepteert. Zodra er een database is: één query met
  `lowStockOnly: true` draaien en controleren dat `stockQuantity <= minStock` echt
  kolom-tegen-kolom vergelijkt en dat `minStock = 0` er niet in zit.
- Zoeken gebruikt `contains` met `mode: "insensitive"`; dat wordt in Postgres een
  `ILIKE '%term%'` en kan geen index gebruiken. Prima bij enkele duizenden
  onderdelen, maar als de lijst traag wordt is een `pg_trgm`-index (of full-text
  search) de volgende stap — dat is een migratie en dus niet van deze taak.
- Sorteren op marge leest alle gefilterde rijen (zie keuze 3). Reviewer mag bepalen
  of die grens voor v1 acceptabel is.
- Overlap met de buren in `src/lib/queries/`: `brands.ts` en `suppliers.ts` dekken
  nu de filterdropdowns van T07. Reviewer moet nakijken of T07 daar inderdaad naartoe
  wijst en of `PartDTO.brand` / `PartDTO.supplier` (id + naam) genoeg zijn naast die
  lijsten.
- `PartDTO.category` wordt met `as Category` gecast van de Prisma-enum naar de
  string-union uit `@/lib/labels`. Die twee lijsten moeten gelijk blijven; als
  iemand een categorie aan `prisma/schema.prisma` toevoegt, moet `labels.ts` mee.

---

## [T09] Merken beheren — 2026-09-21
**Status:** klaar voor review
**Gewijzigde bestanden:** src/lib/queries/brands.ts, src/lib/validation/brands.ts,
src/app/(app)/merken/page.tsx, src/app/(app)/merken/actions.ts,
src/app/(app)/merken/NewBrandForm.tsx, src/app/(app)/merken/BrandRow.tsx,
src/lib/__tests__/brands.test.ts, docs/PROGRESS.md
**Wat is gebouwd:** `/merken` toont alle merken alfabetisch met het aantal gekoppelde
ACTIEVE onderdelen (`listBrandsWithPartCounts`, `_count` met `where: { archivedAt:
null }`), een formulier om een merk toe te voegen, en per merk inline hernoemen en
verwijderen — alles via server actions (`createBrandAction`, `renameBrandAction`,
`deleteBrandAction` in `src/app/(app)/merken/actions.ts`) met `revalidatePath("/merken")`
na elke mutatie. De datalaag (`src/lib/queries/brands.ts`) geeft uitsluitend plain
DTO's terug (`BrandDTO`/`BrandWithPartCountDTO`), datums als ISO-string. Validatie zit
in `src/lib/validation/brands.ts`: een Zod-schema (naam verplicht, getrimd, niet leeg,
max. 100 tekens, Nederlandse meldingen) plus twee pure businessregels die los van de
database getest zijn: `evaluateBrandDeletion(linkedPartCount)` (weigert bij > 0,
correct enkelvoud/meervoud) en `isUniqueConstraintViolation`/`isRecordNotFoundError`
(Prisma-foutcodes P2002/P2025 herkennen). De pagina legt in de omschrijving uit dat
merken bij onderdelen gebruikt worden (bereikbaarheidseis uit de taak); de koppeling
vanuit het onderdeelformulier zelf hoort bij T08 en is niet aangeraakt.
**Keuzes en afwijkingen:** Duplicaatnaam wordt dubbel geborgd: eerst een voorafgaande
`findBrandByName`-controle voor een snelle melding in het gangbare pad, en bij zowel
aanmaken als hernoemen ook een `catch` op Prisma-code `P2002` rond de mutatie zelf —
die vangt de race op waarbij twee verzoeken tussen controle en insert dezelfde naam
aanmaken. Verwijderen controleert `countPartsForBrand(id).total` (dus inclusief
gearchiveerde onderdelen, zoals de taak vereist) vóór `prisma.brand.delete`; het schema
staat `onDelete: SetNull` toe op `Part.brand`, dus de database zou het verwijderen zelf
toestaan en onderdelen merkloos maken — de applicatielaag blokkeert dat bewust. Deze
verwijdercontrole kent, anders dan de naamcontrole, geen expliciete tweede vangnet
tegen een race (een onderdeel dat tussen controle en delete aan het merk gekoppeld
wordt); dat risico is klein bij een garage met één balie en is niet in de
acceptatiecriteria geëist, maar wel het benoemen waard voor de reviewer. Verwijderen
gebruikt een `window.confirm`-bevestiging in plaats van een eigen modal-component, want
er is geen Modal-primitive in `src/components/` en die bouwen viel buiten de scope van
deze taak.
**Bewust niet gedaan:** geen link vanuit het onderdeelformulier naar `/merken` (T08),
geen wijziging aan `AppNav`/navigatie (buiten scope, niet aangeraakt), geen aparte
detailpagina per merk (niet gevraagd in de acceptatiecriteria).
**Verificatie:** `npx tsc --noEmit` schoon. `npx vitest run`: 176/176 tests groen over
alle 6 testbestanden (inclusief de 21 nieuwe in `brands.test.ts`), geen enkele van een
andere agent gebroken. `npx eslint "src/app/(app)/merken" src/lib/queries/brands.ts
src/lib/validation/brands.ts` geeft geen meldingen. Geen database beschikbaar, dus
`listBrandsWithPartCounts`/`getBrandById`/`countPartsForBrand`/`findBrandByName` zijn
alleen gecontroleerd op typering en tegen het schema gelezen, niet tegen een echte
Postgres; niet met de dev-server op poort 3111 visueel gecontroleerd op 375px, alleen
via de Tailwind-classes van de bestaande primitives (`flex-col`/`sm:flex-row`, dezelfde
patronen als T05/T07).
**Openstaand / risico's:** de reviewer moet met een echte database controleren dat (1)
de duplicaatmelding ook verschijnt bij een `P2002` die alleen via de race-catch
getriggerd wordt (moeilijk handmatig te forceren, wel logisch afgeleid), (2)
`listBrandsWithPartCounts` het juiste aantal telt zodra T06/T08 echte onderdelen
aanmaken, en (3) de merkloze-race bij verwijderen (zie boven) acceptabel is voor v1.

---

## [T03] Seed-data — 2026-09-21
**Status:** klaar voor review
**Gewijzigde bestanden:** prisma/schema.prisma, prisma/migrations/20260921000000_init/migration.sql,
prisma/migrations/migration_lock.toml, prisma/seed.ts, docs/PROGRESS.md
**Wat is gebouwd:** Twee door de reviewer besloten schemacorrecties in
`prisma/schema.prisma`: `@@index([barcode])` verwijderd uit `Part` (de `@unique` op
`barcode` dekt dat al) en `@@index([archivedAt])` toegevoegd aan `Supplier` (voor de
gefilterde leveranciersoverzichten). De migratie in
`prisma/migrations/20260921000000_init/migration.sql` is opnieuw gegenereerd met
`prisma migrate diff --from-empty --to-schema-datamodel` zodat hij deze wijzigingen
bevat, en onderaan aangevuld met vijf handgeschreven CHECK-constraints als
verdediging in de diepte naast de Zod-validatie (SPEC §3 regels 6 en 7):
`Sale.quantity > 0`, `Part.stockQuantity >= 0`, en `Part.purchasePrice`,
`Part.salePrice`, `Part.vatRate >= 0`. `prisma/migrations/migration_lock.toml`
(provider `postgresql`) aangemaakt, want die ontbrak nog. Daarnaast `prisma/seed.ts`:
alle 25 merken van de opdrachtgever, 4 verzonnen leveranciers met volledige
contactgegevens (example.com-domeinen, geen echte bedrijven), 40 onderdelen (33
merkgebonden + 7 universele zonder merk) verdeeld over alle 8 `Category`-waarden
(9× SCOOTER_PART, 5× MOTOR_PART, 5× EBIKE_PART, 4× MOBILITY_PART, 3× HELMET,
6× ACCESSORY, 5× CONSUMABLE, 3× OTHER), waarvan 6 bewust onder hun minimumvoorraad
zitten, en 86 verkopen verspreid over de laatste 90 dagen (ca. een derde `WORKSHOP`
met een `WO-2026-xxxx`-werkorderreferentie zonder persoonsgegevens, de rest
`COUNTER`) met een duidelijke top-3 bestseller. Alle willekeur komt uit één
handgeschreven, seeded mulberry32-generator (vaste seed `20260921`), geen extern
pakket zoals faker. De seed ruimt eerst op in de vereiste volgorde (`Sale` → `Part`
→ `Supplier`/`Brand`) en is daarmee idempotent.
**Keuzes en afwijkingen:** Voorraad wordt niet blind willekeurig ingevuld: elk
onderdeel krijgt een deterministische beginvoorraad, de 86 geplande verkopen worden
daar in volgorde tegenaan gesimuleerd met een hoeveelheid die geclamped wordt op de
resterende voorraad (nooit negatief), en pas ná die simulatie wordt voor 6 gekozen
onderdelen de voorraad bewust laag gezet (0-3 stuks) met een `minStock` daarboven —
zo is "minimaal 5 onder minimumvoorraad" gegarandeerd door constructie in plaats van
kans. De `*AtSale`-velden op `Sale` gebruiken de huidige prijs/btw van het onderdeel
op seedmoment (er is geen prijswijziging-historie gesimuleerd); dat is toegestaan,
de velden bestaan zodat toekomstige prijswijzigingen de marge in rapportages niet
vervuilen. Verkoopdata staat relatief tot de actuele datum (`new Date()`) zodat
"laatste 90 dagen" altijd klopt; de RNG-seed maakt de *verdeling* daarbinnen
reproduceerbaar, niet de absolute datums.
**Bewust niet gedaan:** Alleen de twee door de reviewer aangewezen schemacorrecties
zijn doorgevoerd; verder niets aan `prisma/schema.prisma` gewijzigd. Geen queries,
UI, validatie of andere bestanden onder `src/` aangeraakt — dat viel buiten de
opdracht en is van andere agents.
**Verificatie:** `npx prisma validate` slaagt. `npx prisma generate` slaagt.
`npx tsc --noEmit` draait project-breed schoon (geen fouten, ook niet in bestanden
van andere agents). `npx eslint prisma/seed.ts` geeft geen meldingen. **De seed zelf
kon niet gedraaid worden: er is geen database beschikbaar in deze sessie**
(`prisma migrate dev/deploy`, `prisma db push` en `tsx prisma/seed.ts` tegen een
echte Postgres zijn niet uitgevoerd, zoals aangegeven in de opdracht). De
seed-logica (uniciteit van sku/barcode/keys, verdeling over merken en categorieën,
aantal verkopen) is wel met scriptcontroles (grep/telling) buiten de database om
nagelopen.
**Openstaand / risico's:** (1) T02's migratie is nu compleet inclusief de
CHECK-constraints; de reviewer kan dat nogmaals bevestigen zodra er een echte
database beschikbaar is (`prisma migrate deploy` tegen een lege Postgres was in
deze sessie niet mogelijk). (2) De seed zelf is nooit end-to-end tegen een
database gedraaid — de eerste keer dat dat gebeurt (lokaal of in CI) is het
belangrijkste controlepunt: controleer `npm run db:seed`, en dat een tweede run
idempotent blijft. (3) Barcodes zijn fictieve, deterministisch gegenereerde
13-cijferige reeksen (geen echte EAN's) — prima voor testdata, niet geschikt om
per ongeluk als échte barcode te gebruiken.

---

## [T05] App-shell, navigatie en UI-basis — 2026-09-21
**Status:** klaar voor review
**Gewijzigde bestanden:** src/lib/money.ts, src/lib/__tests__/money.test.ts,
src/lib/labels.ts, src/components/Button.tsx, src/components/Input.tsx,
src/components/Select.tsx, src/components/Textarea.tsx, src/components/Card.tsx,
src/components/Table.tsx, src/components/Badge.tsx, src/components/EmptyState.tsx,
src/components/ErrorMessage.tsx, src/components/PageHeader.tsx,
src/components/icons.tsx, src/components/AppNav.tsx, src/components/LogoutButton.tsx,
src/app/(app)/layout.tsx, src/app/(app)/page.tsx, src/app/(app)/loading.tsx,
src/app/(app)/error.tsx (src/app/page.tsx verwijderd, verplaatst naar
src/app/(app)/page.tsx).
**Wat is gebouwd:** De geldlaag `src/lib/money.ts` (`formatEuro`, `calcMargin`,
`calcMarginPct`, `priceWithVat`) met Vitest-tests voor het nuloverzicht (verkoop = 0
→ 0%, geen NaN/Infinity), negatieve marge en btw op 21% en 9%. `src/lib/labels.ts`
met Nederlandse labels voor `Category` en `SaleChannel` als string-unions (geen
Prisma-import, dus ook bruikbaar in client components). Negen herbruikbare
UI-primitives in `src/components/` (Button, Input, Select, Textarea, Card, Table
incl. TableHead/Body/HeaderCell/Cell, Badge, EmptyState, ErrorMessage, PageHeader),
allemaal server components zonder `"use client"` (geen hooks nodig) en met een
raakvlak van minimaal 44×44px. De gedeelde app-shell in `src/app/(app)/layout.tsx`
met een zijbalk op desktop/tablet en een vaste onderbalk met vijf iconen/labels op
mobiel (`src/components/AppNav.tsx`, client component wegens `usePathname` voor de
actieve-routemarkering), plus `loading.tsx` en een client `error.tsx` met een
"Opnieuw proberen"-knop die `reset()` aanroept.
**Keuzes en afwijkingen:** Uitloggen is een puur HTML `<form method="post"
action="/api/auth/logout">` (`src/components/LogoutButton.tsx`) zonder
client-JavaScript — werkt ook zonder JS en hoeft dus geen `"use client"` te zijn; de
route zelf bouwt de authenticatietaak. Geen icon-library toegevoegd (package.json is
niet van mij): `src/components/icons.tsx` bevat zelf getekende inline SVG-iconen.
`Table` is een set primitives (Table/TableHead/TableBody/TableHeaderCell/TableCell)
in plaats van een kant-en-klare kaartweergave, met uitgebreide JSDoc-documentatie
in het bestand die precies toont hoe een feature (bv. T07) ernaast een mobiele
`Card`-lijst met dezelfde data bouwt — een generieke tabel→kaart-transformatie voor
willekeurige kolommen leek overkill op primitive-niveau. Mobiele navigatie: vaste
onderbalk (`fixed bottom-0`) met de vijf hoofdroutes; de uitlogknop staat daarom in
een aparte compacte topbalk op mobiel (icoon-only) en onderaan de zijbalk op
desktop. Actieve route: exacte match voor `/`, `startsWith(href + "/")` voor de
overige, zodat subroutes (bv. `/onderdelen/nieuw`) ook de juiste navigatie-item
markeren.
**Bewust niet gedaan:** geen daadwerkelijke content op `/onderdelen`, `/verkoop`,
`/leveranciers`, `/rapportages` — die links lopen bewust vooruit op latere taken.
Geen BarcodeScanner (T10). Geen datalaag/queries (T06). `src/app/layout.tsx`,
`src/middleware.ts`, `src/lib/auth.ts`, `src/app/login/**`, `src/app/api/**`,
`prisma/**`, `src/lib/db.ts` en configbestanden zijn niet aangeraakt.
**Verificatie:** `npx tsc --noEmit` schoon. `npx vitest run`: 72 tests slagen (17
nieuwe in `money.test.ts`, incl. de bestaande `smoke.test.ts` en de 54 tests van een
andere agent in `auth.test.ts`, niet door mij gewijzigd). `npx eslint src/components
src/lib/money.ts src/lib/labels.ts "src/app/(app)"` geeft geen fouten of
waarschuwingen. Mobiel gecontroleerd door de layoutstructuur na te lopen op 375px:
zijbalk is `hidden` onder `md`, de onderbalk is `fixed` en `md:hidden`, `main` heeft
`pb-24` op mobiel zodat content niet achter de onderbalk verdwijnt, en er staat
nergens een vaste breedte of `overflow-x` die op 375px zou kunnen scrollen (Table
heeft een eigen `overflow-x-auto`-wrapper, maar wordt pas met echte brede content
gebruikt vanaf T07). Geen visuele browsercontrole uitgevoerd (geen dev server
gestart, op verzoek van de opdracht) — reviewer wordt aangeraden dit alsnog met
`npm run dev` op 375px te bekijken zodra T04 (auth) ook klaar is, aangezien de
beschermde routes nu nog niet bereikbaar zijn zonder login.
**Openstaand / risico's:** (1) `.next/types` bevatte een stale cache die verwees
naar het verplaatste `src/app/page.tsx` (van een eerdere `next dev`-run van een
andere agent); die map is verwijderd omdat hij gitignored en regenereerbaar is — dit
blokkeerde `tsc --noEmit` totdat hij weg was. (2) De navigatielinks in `AppNav.tsx`
verwijzen naar routes die pas in latere taken bestaan (404 tot dan). (3)
`npm run build` is bewust niet gedraaid (opdracht); reviewer kan dat na afronding
van T04 alsnog doen. (4) `Table`-primitives zijn nog niet in een echte feature
gebruikt; de mobiele kaartweergave-aanpak is alleen gedocumenteerd, niet bewezen met
echte data — T07 is de eerste echte gebruiker en de aanpak verdient dan een
steekproef op 375px.

---

## [T04] Wachtwoordbeveiliging voor de hele site — 2026-09-21
**Status:** klaar voor review
**Gewijzigde bestanden:** src/lib/auth.ts, src/lib/rate-limit.ts, src/middleware.ts,
src/app/login/page.tsx, src/app/api/auth/login/route.ts,
src/app/api/auth/logout/route.ts, src/lib/__tests__/auth.test.ts, docs/PROGRESS.md
**Wat is gebouwd:** SPEC §F7 volledig. `src/lib/auth.ts` maakt en verifieert een
sessiewaarde `<base64url(payload)>.<base64url(HMAC-SHA-256)>` met `SESSION_SECRET`; de
payload is `v1:<vervaltijdstip>` en de geldigheid is 30 dagen. Het cookie `vb_session`
is `httpOnly`, `sameSite=lax`, `path=/` en `secure` in productie.
`src/lib/rate-limit.ts` telt mislukte loginpogingen per IP (max 10 per 15 minuten) en
ruimt verlopen entries op. `src/middleware.ts` beschermt alles behalve `/login`, de twee
auth-endpoints en statische assets, en stuurt zonder geldig cookie door naar
`/login?next=<pad+query>`. De loginpagina is een server component met een gewoon
HTML-formulier (werkt zonder JavaScript), en de route handlers doen rate limit →
constant-time wachtwoordcontrole → cookie zetten → redirect (303).
**Keuzes en afwijkingen:** (1) **Edge-compatibiliteit**: middleware draait op de Edge
runtime, waar `node:crypto` niet bestaat. Alle cryptografie gebruikt daarom uitsluitend
de Web Crypto API (`crypto.subtle.importKey`/`sign`, HMAC-SHA-256) en base64url via
`btoa`/`atob` in plaats van `Buffer`. Daardoor zijn de onderteken- en verifieerfuncties
`async`. De build bevestigt dit: `ƒ Middleware 32.8 kB` compileert zonder
Node-module-fout. (2) **Constant-time vergelijking**: zelfgeschreven
`timingSafeEqualBytes` die over `max(a.length, b.length)` loopt, nooit vroegtijdig
afbreekt en alle verschillen (inclusief het lengteverschil) in één XOR-accumulator
verzamelt. Voor het wachtwoord worden invoer én `APP_PASSWORD` eerst gehasht met een
procesgebonden willekeurige HMAC-sleutel, zodat beide kanten altijd 32 bytes zijn en ook
de *lengte* van het wachtwoord niet lekt. (3) **Open redirect**: `isSafeNextPath`
accepteert alleen een pad dat met precies één `/` begint — `//evil.example`,
`/\evil.example`, backslashes, control-tekens en absolute URL's vallen terug op `/`. De
controle zit zowel in de middleware-flow als in de login-route. (4) Het pad is
`src/app/login/` geworden in plaats van de routegroep `(auth)/login` uit SPEC §7; de
URL is identiek en de routegroep voegt zonder tweede publieke pagina niets toe.
(5) Redirects na POST gebruiken status **303**, zodat de browser met GET verder gaat en
de POST niet herhaalt. (6) Formulierinvoer wordt server-side met Zod gevalideerd
(SPEC §3 regel 7); een leeg veld krijgt exact dezelfde generieke melding als een fout
wachtwoord. (7) De 10e mislukte poging toont al de blokkademelding: de poging is dan
wél gecontroleerd, maar de teller staat daarna op het maximum. (8) Bij een
configuratiefout (ontbrekende env var) logt de route alleen de foutmelding — nooit de
waarde — en toont de pagina een neutrale beheerdersmelding.
**Bewust niet gedaan:** geen gebruikersaccounts, rollen of wachtwoordwijziging (SPEC:
één gedeeld wachtwoord). Geen uitlogknop in de UI — die hoort bij de app-shell van T05;
de endpoint `/api/auth/logout` is er al en verwacht een POST. Geen redirect van een
ingelogde gebruiker weg van `/login` (staat niet in de acceptatiecriteria). Geen
gedeelde rate-limitstore (zie risico's). `package.json`, `tsconfig.json`, `layout.tsx`,
`prisma/**` en de configbestanden zijn niet aangeraakt.
**Verificatie:** `npx vitest run src/lib/__tests__/auth.test.ts` → **54 tests, alle
geslaagd** (geldige waarde, geknoeide handtekening, geknoeide payload, verlopen waarde,
ander secret, tien soorten rommel-invoer en vijf niet-string waarden, cookie-attributen,
wachtwoordcontrole, open-redirect-paden en de rate limiter). `npx tsc --noEmit` is
schoon voor de hele repo. `npx eslint` op de zeven T04-bestanden: 0 problemen.
`npx next build` slaagt. Daarnaast een end-to-end rooktest tegen `next start`:
beschermde route zonder cookie → 307 naar `/login?next=%2Fvoorraad%3Fq%3Dremblok`; fout
wachtwoord → `?error=onjuist`; `next=//evil.example` → redirect naar `/` in plaats van
naar het externe domein; juist wachtwoord → `Set-Cookie ... Max-Age=2592000; Secure;
HttpOnly; SameSite=lax` en redirect naar `/voorraad?q=remblok`; beschermde route mét
cookie → 200; geknoeid en onzin-cookie → terug naar `/login`; uitloggen → `Max-Age=0` en
redirect naar `/login`; twaalf foute pogingen vanaf één IP → vanaf de 10e de
blokkademelding, terwijl een ander IP gewoon door kan. Mobiel gecontroleerd op 375×812:
`scrollWidth === clientWidth === 375` (geen horizontaal scrollen), invoerveld en knop
allebei 48px hoog.
**Openstaand / risico's:** (1) De rate limiter staat in het geheugen van één
serverinstantie; op Vercel heeft elke instantie een eigen teller en verdwijnt de stand
bij een koude start. Bewust geaccepteerd voor v1 (SPEC §F7), maar het is géén
waterdichte bescherming — voor productie is een gedeelde store of de rate limiting van
de hostingprovider nodig. Dit staat als comment bovenaan `src/lib/rate-limit.ts`.
(2) Het client-IP komt uit `x-forwarded-for`; achter een proxy die die header niet zet
of doorlaat vallen alle bezoekers samen onder één sleutel (`onbekend`) en delen ze dus
één teller. (3) De middleware valideert alleen de handtekening en de vervaldatum; er is
geen serverside intrekking, dus een gestolen cookie blijft 30 dagen geldig en het
draaien van `SESSION_SECRET` is de enige manier om alle sessies ongeldig te maken.
(4) De losstaande test `src/lib/__tests__/money.test.ts` (T05, niet van deze taak)
faalt op `formatEuro(-5)`: verwacht `-€ 5,00`, krijgt `€ -5,00` van
`Intl.NumberFormat('nl-NL')`. Bewust niet gerepareerd — ander bestand, andere taak.
(5) T04 is niet op `review` gezet in `docs/TASKS.md`: dat bestand valt buiten de
bestanden van deze sessie.

---

## [T02] Prisma + Postgres + schema en migratie — 2026-09-21
**Status:** klaar voor review
**Gewijzigde bestanden:** prisma/schema.prisma, src/lib/db.ts, docs/PROGRESS.md
**Wat is gebouwd:** Het volledige datamodel uit SPEC §4 (v1.1) in
`prisma/schema.prisma`: datasource `postgresql` met `DATABASE_URL` + `DIRECT_URL`,
generator `prisma-client-js`, de modellen `Brand`, `Supplier`, `Part` en `Sale`, en de
enums `Category` (8 waarden) en `SaleChannel` (`COUNTER` | `WORKSHOP`). Geldvelden zijn
`Decimal @db.Decimal(10,2)` en bevatten bedragen **exclusief btw**; `Part.vatRate` en
`Sale.vatRateAtSale` zijn `Decimal @db.Decimal(5,2)`, met default 21 op `Part`. Soft
delete via `archivedAt` op `Part` en `Supplier`. Daarnaast `src/lib/db.ts`: één gedeelde
`PrismaClient` met het `globalThis`-patroon, zodat hot reload in development geen
connecties lekt; getypeerd zonder `any` en werkend onder `strict: true`.
**Keuzes en afwijkingen:** onDelete-keuzes: `Sale.part` → **Restrict** (SPEC §3 regel 4:
verkoophistorie mag nooit verdwijnen, dus de database weigert het hard verwijderen van
een onderdeel dat in de historie voorkomt; archiveren is de enige weg). `Part.brand` en
`Part.supplier` → **SetNull**, passend bij de optionele relaties: een merk of leverancier
verwijderen maakt het onderdeel universeel/leverancierloos in plaats van het mee te
slepen. `quantity > 0` is bewust géén database-constraint maar wordt in de Zod-laag
afgedwongen (SPEC §3 regel 7); dat is een keuze die de reviewer mag terugdraaien met een
check-constraint in de migratie. Verder geen afwijkingen van SPEC §4 — geen extra
velden, geen extra indexen (ook niet op `Supplier.archivedAt`, dat SPEC niet noemt).
Korte Nederlandse comments staan bij de niet-vanzelfsprekende keuzes (excl. btw,
optioneel merk, betekenis van `WORKSHOP`, AVG bij `Sale.reference`).
**Bewust niet gedaan:** geen seed (`prisma/seed.ts`, dat is T03), geen queries/datalaag,
geen validatieschema's, geen auth, geen UI. `package.json`, `tsconfig.json` en de
app-skeletbestanden zijn niet aangeraakt (eigendom van T01).
**Verificatie:** **De migratie is NIET gegenereerd en NIET gedraaid.** In deze sessie
waren er geen `node_modules` en geen database (geen Postgres, geen Docker, geen
`DATABASE_URL`), dus `npm install`, `npx prisma generate`, `prisma migrate dev` en
`prisma migrate deploy` konden niet draaien. Ook `npm run build`, `npx tsc --noEmit`,
`npm run lint` en de tests zijn daardoor niet uitgevoerd. Het schema is met de hand
geschreven en regel voor regel nagelopen tegen SPEC §4 en de acceptatiecriteria van T02.
**Openstaand / risico's:** (1) **Migratie ontbreekt nog** — `prisma/migrations/**` moet
alsnog gegenereerd worden (`npm run db:migrate`) en `npx prisma migrate deploy` moet
schoon draaien tegen een lege database; dit acceptatiecriterium van T02 staat open.
(2) `@prisma/client` is nog niet gegenereerd, dus het `PrismaClient`-type in
`src/lib/db.ts` is nu nog niet oplosbaar voor `tsc`; dat lost zich op na
`npm install` + `prisma generate` (het `postinstall`-script doet dit al).
(3) `Part.barcode` heeft zowel `@unique` als `@@index([barcode])`; de unique index maakt
de losse index strikt genomen overbodig, maar SPEC §4 noemt `barcode` expliciet in de
indexlijst — reviewer mag beslissen of de losse index eruit mag.
(4) Er is nog geen `DATABASE_URL` naar een echte Neon-/Vercel Postgres-database.

---

## [T01] Projectsetup Next.js + TypeScript + Tailwind — 2026-09-21
**Status:** klaar voor review
**Gewijzigde bestanden:** package.json, tsconfig.json, next-env.d.ts, next.config.ts,
tailwind.config.ts, postcss.config.mjs, eslint.config.mjs, .prettierrc,
.prettierignore, vitest.config.ts, src/app/layout.tsx, src/app/page.tsx,
src/app/globals.css, src/lib/__tests__/smoke.test.ts, .env.example, .gitignore,
README.md
**Wat is gebouwd:** Het complete projectskelet uit T01: Next.js 15 App Router,
TypeScript in `strict` modus met padalias `@/*` → `./src/*`, Tailwind CSS 3 (met
tailwind-directives in `globals.css` en een utility-class op de placeholderpagina),
een flat ESLint-config op basis van `eslint-config-next`, Prettier, en Vitest met één
slagende voorbeeldtest. `.env.example` met de vier verplichte variabelen uit SPEC §6,
en een `.gitignore` die `node_modules`, `.next`, `.env*` (behalve `.env.example`) en
Prisma-artefacten uitsluit. README met vereiste Node-versie en de belangrijkste
commando's.
**Keuzes en afwijkingen:** Alle versies zijn exact vastgepind (geen `^`/`~`), conform
opdracht. Voor `db:seed` is `tsx` als extra, gepinde devDependency toegevoegd
(`tsx prisma/seed.ts`, met bijbehorende `"prisma": { "seed": ... }`-config in
`package.json`) omdat er geen TypeScript-seedrunner in de gevraagde dependencylijst
stond; `prisma/seed.ts` zelf bestaat nog niet en volgt in T03. Voor de flat
ESLint-config is `@eslint/eslintrc` (FlatCompat) toegevoegd, wat nodig is om
`eslint-config-next` — dat nog een legacy config exporteert — in ESLint 9's flat
config te gebruiken; dit is standaardpraktijk bij Next.js 15 + ESLint 9. Vitest draait
in `environment: "node"` omdat T01 bewust geen DOM-test bevat. `next-env.d.ts` is met
de hand aangemaakt (normaal genereert `next dev` dit bestand) en staat, net als in een
standaard Next.js-project, wél in `.gitignore` maar wél op schijf, zodat `tsc` de
Next.js-types kan vinden.
**Bewust niet gedaan:** geen Prisma-schema, geen database, geen authenticatie, geen
features — dat is T02 en later. Geen `node_modules`/lockfile: die ontstaan pas bij een
echte `npm install` op een machine met Node ≥ 18.18.
**Verificatie:** `npm run dev`, `npm run build`, `npx tsc --noEmit`, `npm run lint` en
`npm run test` konden **niet** gedraaid worden in deze sessie: de machine heeft alleen
Node v16.14.2, terwijl Next.js 15 Node ≥ 18.18 vereist. Alle bestanden zijn met de
hand geschreven en handmatig nagelopen tegen de Next.js 15 / TypeScript 5.7 /
Tailwind 3 / ESLint 9 / Vitest 2-conventies (geen scaffolding-tool gebruikt). De
reviewer moet build/typecheck/lint/test alsnog draaien op een machine met Node ≥ 18.18
voordat T01 als `done` gemarkeerd wordt.
**Openstaand / risico's:** (1) Build/tests zijn niet uitgevoerd — dit is het
belangrijkste controlepunt voor de reviewer, zie hierboven. (2) `tsx` is een
toegevoegde dependency die niet in de oorspronkelijke versielijst stond; controleer of
dat akkoord is of dat een andere seed-runner (bv. `ts-node`) de voorkeur heeft. (3) Bij
de eerste echte `npm install` kan npm nog subtiele peer-dependency-waarschuwingen geven
tussen React 19 / eslint-config-next 15.1.6 / eslint 9; die zijn bij handmatig schrijven
niet te verifiëren.

---

## [T00b] Spec aangescherpt op de opdrachtgever — 2026-09-21
**Status:** n.v.t. (projectmanager)
**Gewijzigde bestanden:** docs/SPEC.md (naar v1.1), docs/TASKS.md
**Wat is gebouwd:** Na onderzoek naar de opdrachtgever (Amsterdamse tweewielerzaak,
sinds 1933, ruim 20 merken, eigen werkplaats die ook vreemde merken bedient) is de spec
op vier punten aangepast en is een btw-fout hersteld. Nog geen applicatiecode.
**Keuzes en afwijkingen:** (1) alle prijzen excl. btw + `vatRate` per product — de
oude spec vergeleek inkoop excl. met verkoop incl., waardoor marges ~21% te hoog
uitvielen; (2) `Part.brandId` optioneel voor universele onderdelen; (3) `Category`-enum
omdat het assortiment ook fatbikes, scootmobielen, helmen en accessoires omvat;
(4) `Sale.channel` (balie/werkplaats) zodat onderdelen die in reparaties verdwijnen ook
van de voorraad af gaan; (5) `fitsModels` als vrij pasvormveld.
**Bewust niet gedaan:** besteladvies gegroepeerd per leverancier en meerdere barcodes
per onderdeel staan nog open in TASKS.md onder Nieuwe wensen / observaties.
**Verificatie:** n.v.t.
**Openstaand / risico's:** T02 moet het schema volgens SPEC 1.1 bouwen, niet 1.0. De
werkorderreferentie mag geen klantnaam of kenteken bevatten (AVG).

---

## [T00] Projectkader opgezet — 2026-09-21
**Status:** n.v.t. (projectmanager)
**Gewijzigde bestanden:** docs/SPEC.md, docs/TASKS.md, docs/PROGRESS.md,
.claude/agents/zoeker.md, .claude/agents/test-runner.md, .claude/agents/doc-updater.md
**Wat is gebouwd:** Specificatie, taakverdeling (T01–T16) en de drie subagents voor de
bouwsessie. Nog geen applicatiecode; de repo bevatte alleen `.gitattributes`.
**Keuzes en afwijkingen:** Dashboard (F1) en rapportages (F6) staan achteraan in de
planning omdat ze verkoopdata nodig hebben. Merkenbeheer is als extra taak T09
toegevoegd. `Sale` bewaart ook de historische inkoopprijs, anders is marge in
rapportages niet reconstrueerbaar.
**Bewust niet gedaan:** geen applicatiecode, geen dependencies geïnstalleerd.
**Verificatie:** n.v.t.
**Openstaand / risico's:** `DATABASE_URL` naar een Neon- of Vercel Postgres-database is
nodig voordat T02 afgerond kan worden.
