# TASKS — Voorraadbeheer Scooter- & Motoronderdelen

Bron: `docs/SPEC.md`. Bouwsessie werkt taken **van boven naar beneden** af.

## Werkwijze voor de bouwer

1. Pak de bovenste taak met status `todo` waarvan alle afhankelijkheden `done` zijn.
2. Zet de status op `in-progress` (via de `doc-updater` subagent).
3. Bouw alleen wat in de acceptatiecriteria staat. Zie je iets anders dat beter moet?
   Meld het onderaan in **Nieuwe wensen / observaties** — bouw het niet.
4. Schrijf na afloop een notitie in `docs/PROGRESS.md` (sjabloon staat daar).
5. Zet de status op `review`. De projectmanager-sessie controleert en zet `done`
   of voegt feedbackpunten toe en zet terug op `todo`.

Statussen: `todo` → `in-progress` → `review` → `done`. Afgekeurd werk gaat terug naar
`todo` met feedbackpunten onder de taak.

Delegeren (goedkoop): zoekvragen → `zoeker`, build/tests → `test-runner`,
statusupdates in docs → `doc-updater`.

**Planningsnotitie:** de gevraagde featurevolgorde was 2→6. Feature 1 (dashboard) en de
rapportages staan achteraan omdat beide verkoopdata nodig hebben; ze zijn pas zinvol te
bouwen en te testen als F4 verkopen produceert. Merkenbeheer (T09) is toegevoegd omdat
onderdelen een verplicht merk hebben en seed-data alleen niet volstaat voor dagelijks
gebruik.

---

## T01 — Projectsetup Next.js + TypeScript + Tailwind
**Status:** review
**Afhankelijk van:** —

**Beschrijving**
Initialiseer de Next.js-applicatie in de repo-root: App Router, TypeScript strict,
Tailwind, ESLint, Prettier, Vitest. Voeg `.env.example`, `.gitignore` en npm-scripts
toe. Nog geen features, alleen een werkend skelet.

**Acceptatiecriteria**
- [ ] `npm run dev` start zonder fouten; `/` toont een placeholderpagina.
- [ ] `npm run build` en `npx tsc --noEmit` draaien schoon; `strict: true` staat aan.
- [ ] Tailwind werkt (aantoonbaar met een utility class op de placeholderpagina).
- [ ] `npm run lint` geeft geen errors.
- [ ] `npm run test` draait Vitest met minimaal één voorbeeldtest die slaagt.
- [ ] `.env.example` bevat `DATABASE_URL`, `DIRECT_URL`, `APP_PASSWORD`, `SESSION_SECRET`
      met dummywaarden; `.env*` (behalve `.env.example`) staat in `.gitignore`.
- [ ] `node_modules`, `.next` en Prisma-artefacten staan in `.gitignore`.

---

## T02 — Prisma + Postgres + schema en migratie
**Status:** review
**Afhankelijk van:** T01

**Beschrijving**
Zet Prisma op met Postgres en implementeer het datamodel uit SPEC §4
(Brand, Supplier, Part, Sale, enums `Category` en `SaleChannel`) inclusief relaties,
indexen, unieke constraints, `Decimal(10,2)` voor geld en `archivedAt` voor soft
delete. Maak een Prisma client
singleton in `src/lib/db.ts` die in dev geen connecties lekt.

**Acceptatiecriteria**
- [ ] `prisma/schema.prisma` bevat alle vier de modellen exact volgens SPEC §4.
- [ ] Geldvelden zijn `Decimal @db.Decimal(10,2)` en bevatten bedragen **excl. btw**;
      `Part` heeft `vatRate Decimal(5,2) @default(21)`.
- [ ] `Part.brandId` is **optioneel** (universele onderdelen zonder merk).
- [ ] `Part` heeft `category` (enum `Category`, verplicht) en `fitsModels String?`.
- [ ] `Sale` heeft `salePriceAtSale`, `purchasePriceAtSale`, `vatRateAtSale`,
      `channel` (enum `SaleChannel`: `COUNTER` | `WORKSHOP`) en `reference String?`.
- [ ] Enum `Category` bevat exact de waarden uit SPEC §4.
- [ ] Unieke constraints op `Brand.name`, `Part.sku`, `Part.barcode` (nullable-uniek).
- [ ] Indexen op `Part.brandId`, `Part.supplierId`, `Part.barcode`, `Part.archivedAt`,
      `Part.category`, `Sale.partId`, `Sale.soldAt`, `Sale.channel`.
- [ ] Een migratie is aangemaakt en `npx prisma migrate deploy` draait tegen een lege
      database zonder fouten.
- [ ] `src/lib/db.ts` exporteert één gedeelde PrismaClient (global singleton in dev).
- [ ] `npm run db:migrate` en `npm run db:studio` staan als scripts in `package.json`.

---

## T03 — Seed-data
**Status:** review
**Afhankelijk van:** T02

**Beschrijving**
Schrijf `prisma/seed.ts` met realistische testdata zodat volgende taken meteen iets te
tonen hebben: merken, leveranciers, onderdelen (waarvan enkele onder minimumvoorraad)
en verkopen verspreid over de afgelopen 90 dagen.

**Acceptatiecriteria**
- [ ] De merken van de opdrachtgever staan erin: Vespa, Piaggio, Peugeot, Kymco, SYM,
      AGM, BTC, Brixton, MT, Rieju, Benelli, Hanway, Aprilia, NIU, Super Soco, Segway,
      Knaap, Phatfour, Super73, Art, Shark, Roof, Beon, Boxer, Riva.
- [ ] Minimaal 3 leveranciers met volledig ingevulde contactgegevens.
- [ ] Minimaal 30 onderdelen verdeeld over de merken, met barcodes, uiteenlopende
      prijzen (excl. btw) en marges; minimaal 5 staan onder hun minimumvoorraad.
- [ ] Alle categorieën uit de `Category`-enum komen voor, inclusief helmen en
      accessoires.
- [ ] Minimaal 5 universele onderdelen **zonder merk** (olie, remblokken, kabels,
      lampjes, bandenspul), waarvan enkele met een gevuld `fitsModels`-veld.
- [ ] Minimaal 80 verkopen verspreid over de laatste 90 dagen, met een duidelijk
      herkenbare top-3 bestseller en historische prijzen in `*AtSale`.
- [ ] Circa een derde van die verkopen heeft `channel = WORKSHOP` met een
      werkorderreferentie zonder persoonsgegevens (bv. "WO-2026-0412").
- [ ] Seed is idempotent of ruimt eerst op: twee keer draaien geeft geen duplicaten
      en geen crash.
- [ ] `npm run db:seed` werkt en is gedocumenteerd in de README.

---

## T04 — Wachtwoordbeveiliging voor de hele site
**Status:** review
**Afhankelijk van:** T01

**Beschrijving**
Implementeer SPEC §F7: één gedeeld wachtwoord uit `APP_PASSWORD`, ondertekend
sessiecookie, middleware voor alle routes, loginpagina en uitloggen.

**Acceptatiecriteria**
- [ ] `/login` toont een wachtwoordformulier; juist wachtwoord logt in, fout wachtwoord
      geeft een nette foutmelding zonder te verklappen of het veld leeg was.
- [ ] Sessiecookie is `httpOnly`, `secure` in productie, `sameSite=lax`, 30 dagen
      geldig, en bevat een HMAC-handtekening met `SESSION_SECRET`.
- [ ] Een geknoeid of verlopen cookie wordt geweigerd en leidt naar `/login`.
- [ ] Middleware beschermt alle routes behalve `/login`, de login-endpoint en statische
      assets; na inloggen keert de gebruiker terug naar de oorspronkelijke URL.
- [ ] Wachtwoordvergelijking is constant in tijd; `APP_PASSWORD` komt niet in de client
      bundle terecht en wordt niet gelogd.
- [ ] Rate limiting: na 10 mislukte pogingen vanaf hetzelfde IP binnen 15 minuten volgt
      een blokkademelding.
- [ ] Uitloggen wist het cookie en leidt naar `/login`.
- [ ] Vitest-tests voor het ondertekenen/verifiëren van de cookie, inclusief geknoeide
      en verlopen waarden.

---

## T05 — App-shell, navigatie en UI-basis
**Status:** review
**Afhankelijk van:** T04

**Beschrijving**
Bouw de gedeelde layout voor de beschermde routes: responsive navigatie
(Dashboard, Voorraad, Verkoop, Leveranciers, Rapportages), uitlogknop, en de
herbruikbare UI-primitives en helpers die de features nodig hebben.

**Acceptatiecriteria**
- [ ] Layout met navigatie op alle beschermde routes; actieve route is gemarkeerd.
- [ ] Op mobiel (375px) is de navigatie bruikbaar (bijvoorbeeld onderbalk of
      hamburgermenu) zonder horizontaal scrollen.
- [ ] `src/lib/money.ts` bevat `formatEuro`, `calcMargin` en `calcMarginPct` met
      Vitest-tests, inclusief het randgeval verkoopprijs = 0.
- [ ] Basiscomponenten aanwezig en gebruikt: Button, Input, Select, Card, Table,
      Badge, EmptyState, ErrorMessage.
- [ ] Interactieve elementen zijn minimaal 44×44px.
- [ ] Een gedeelde laad- en foutstatus (`loading.tsx`, `error.tsx`) voor de app-routes.

---

## T06 — Datalaag onderdelen (queries en DTO's)
**Status:** review
**Afhankelijk van:** T02, T05

**Beschrijving**
Bouw `src/lib/queries/parts.ts`: ophalen van onderdelen met zoeken, filteren,
sorteren en paginering, plus de DTO-mapping die `Decimal` naar `number` omzet.
Dit is de basis voor T07, T12 en T14.

**Acceptatiecriteria**
- [ ] `listParts({ search, brandId, category, supplierId, lowStockOnly, sort, page })`
      geeft gepagineerde resultaten plus het totaal aantal.
- [ ] Zoeken werkt case-insensitive op naam, sku, barcode en `fitsModels`.
- [ ] Filteren op onderdelen **zonder merk** is mogelijk (universele artikelen).
- [ ] Gearchiveerde onderdelen zijn standaard uitgesloten.
- [ ] `getPartById` en `findPartByBarcode` bestaan en geven `null` bij geen match.
- [ ] Alle queries geven plain DTO's terug: geen `Decimal`, geen `Date`-objecten die
      client components binnengaan zonder serialisatie.
- [ ] DTO bevat de berekende marge in euro's en procenten (excl. btw) én de
      verkoopprijs inclusief btw als afgeleide waarde.
- [ ] Vitest-tests voor de DTO-mapper en de margeberekening.

---

## T07 — Voorraadoverzicht (F2)
**Status:** review
**Afhankelijk van:** T06

**Beschrijving**
Implementeer `/onderdelen` volgens SPEC §F2: tabel met zoeken, filters, sortering,
groepering per merk en lage-voorraadmarkering.

**Acceptatiecriteria**
- [ ] Tabel toont naam, merk, categorie, sku, inkoopprijs, verkoopprijs excl. btw met
      de incl.-prijs erbij, marge (€ en %), voorraad, minimumvoorraad en leverancier.
- [ ] Zoekveld filtert op naam, sku, barcode, leveranciersartikelnummer en pasvorm; filterstatus staat in de URL zodat de
      pagina deelbaar en herlaadbaar is.
- [ ] Filteren op merk, op categorie, op leverancier en op "alleen lage voorraad"
      werkt en is combineerbaar met zoeken; merkloze onderdelen zijn apart filterbaar.
- [ ] Sorteren op naam, voorraad en marge werkt.
- [ ] Toggle voor groepering per merk.
- [ ] Onderdelen onder minimumvoorraad zijn visueel gemarkeerd.
- [ ] Paginering vanaf 50 rijen.
- [ ] Op 375px kaartweergave in plaats van brede tabel; geen horizontaal scrollen.
- [ ] Lege zoekresultaten tonen een EmptyState, geen blanco scherm.

---

## T08 — Onderdeel toevoegen en bewerken (F3)
**Status:** review
**Afhankelijk van:** T07

**Beschrijving**
Formulieren voor nieuw en bestaand onderdeel met Zod-validatie, server actions,
merk- en leverancierkeuze, handmatige barcode-invoer en archiveren.
Camerascan volgt in T11.

**Acceptatiecriteria**
- [ ] `/onderdelen/nieuw` maakt een onderdeel aan; `/onderdelen/[id]/bewerken` wijzigt
      een bestaand onderdeel; beide via server actions.
- [ ] Alle velden uit SPEC §4 zijn invulbaar; merk, categorie en leverancier via
      dropdown. Merk en leverancier mogen leeg blijven, categorie is verplicht.
- [ ] Btw-tarief is invulbaar met standaardwaarde 21; pasvorm (`fitsModels`) is een
      vrij tekstveld.
- [ ] Zod-validatie op de server: naam en sku verplicht, prijzen ≥ 0, voorraad en
      minimumvoorraad gehele getallen ≥ 0.
- [ ] Duplicate sku of barcode geeft een veldgebonden foutmelding, geen 500.
- [ ] Tijdens het invullen worden live getoond: marge in € en %, en de verkoopprijs
      inclusief btw. Duidelijk gelabeld welk bedrag excl. en welk incl. btw is.
- [ ] Archiveren zet `archivedAt` na een bevestigingsdialoog; gearchiveerde onderdelen
      verdwijnen uit het overzicht.
- [ ] Na opslaan volgt een redirect naar de detail-/overzichtspagina met bevestiging,
      en het overzicht toont de wijziging direct (cache gerevalideerd).
- [ ] Formulier is bruikbaar op 375px.

---

## T09 — Merken beheren
**Status:** review
**Afhankelijk van:** T08

**Beschrijving**
Kleine CRUD voor merken (`/merken`), zodat een nieuw merk kan worden toegevoegd zonder
seed of database-toegang.

**Acceptatiecriteria**
- [ ] Overzicht van merken met het aantal gekoppelde onderdelen.
- [ ] Merk aanmaken en hernoemen werkt; dubbele naam geeft een nette foutmelding.
- [ ] Merk verwijderen kan alleen als er geen onderdelen aan gekoppeld zijn; anders een
      duidelijke melding.
- [ ] Vanuit het onderdeelformulier is het merkenbeheer bereikbaar.

---

## T10 — Herbruikbare barcodescanner-component
**Status:** review
**Afhankelijk van:** T05

**Beschrijving**
Bouw `components/BarcodeScanner.tsx`: camerascan in de browser met `BarcodeDetector`
waar beschikbaar en `@zxing/library` als fallback. Levert een gescande code op via een
callback. Wordt gebruikt door T11 en T12.

**Acceptatiecriteria**
- [ ] Component vraagt cameratoestemming, toont een live camerabeeld en roept
      `onScan(code)` aan bij een geslaagde scan.
- [ ] Gebruikt `BarcodeDetector` wanneer beschikbaar, anders `@zxing/library`; beide
      paden zijn aantoonbaar geïmplementeerd.
- [ ] Ondersteunt EAN-13, EAN-8, Code-128 en QR.
- [ ] Geweigerde toestemming, ontbrekende camera of onveilige context (geen HTTPS)
      geven een duidelijke melding met terugval op handmatig invoeren — geen crash.
- [ ] Camerastream wordt gestopt bij sluiten/unmount (geen camera die aan blijft).
- [ ] Achtercamera heeft de voorkeur op telefoons.
- [ ] Component is client-side (`"use client"`) en blokkeert de server render niet.

---

## T11 — Barcode scannen in het onderdeelformulier
**Status:** review
**Afhankelijk van:** T08, T10

**Beschrijving**
Koppel de scanner uit T10 aan het barcodeveld van het onderdeelformulier.

**Acceptatiecriteria**
- [ ] Knop "Scan barcode" naast het barcodeveld opent de scanner.
- [ ] Een geslaagde scan vult het veld en sluit de scanner.
- [ ] Als de gescande barcode al aan een ander onderdeel hangt, volgt een waarschuwing
      met een link naar dat onderdeel, en wordt opslaan geblokkeerd.
- [ ] Handmatige invoer blijft volledig werken zonder camera.

---

## T12 — Verkoop registreren (F4)
**Status:** review
**Afhankelijk van:** T06, T10

**Beschrijving**
Implementeer `/verkoop` volgens SPEC §F4: zoeken of scannen, aantal kiezen, bevestigen,
en in één transactie voorraad verlagen en de verkoop loggen. Dit is het belangrijkste
baliescherm.

**Acceptatiecriteria**
- [ ] Onderdeel vinden via zoekveld (naam/sku/barcode) én via camerascan.
- [ ] Een scan die precies één onderdeel matcht, selecteert dat onderdeel direct;
      geen match geeft een duidelijke melding met de gescande code.
- [ ] Geselecteerd onderdeel toont naam, merk, huidige voorraad en verkoopprijs excl.
      én incl. btw.
- [ ] Kanaalkeuze balie (standaard) of werkplaats; bij werkplaats kan een vrije
      werkorderreferentie worden ingevuld. Het formulier waarschuwt dat daar geen
      klantnaam of kenteken in hoort (AVG).
- [ ] Aantal instelbaar met plus/min-knoppen en handmatige invoer, standaard 1.
- [ ] Bevestigen verlaagt de voorraad en maakt een `Sale` aan in één
      `prisma.$transaction`, met `salePriceAtSale`, `purchasePriceAtSale`,
      `vatRateAtSale` en `channel` gevuld vanuit het onderdeel en de keuze op dat
      moment.
- [ ] Verkoop van meer stuks dan op voorraad wordt geweigerd met een melding; de
      voorraad blijft ongewijzigd. Dit wordt server-side gecontroleerd binnen de
      transactie, niet alleen in de UI.
- [ ] Gearchiveerde onderdelen zijn niet selecteerbaar.
- [ ] Dubbelklikken op bevestigen registreert niet twee verkopen.
- [ ] Na succes: bevestiging met de nieuwe voorraadstand en het scherm staat direct
      klaar voor de volgende verkoop.
- [ ] Volledige flow bedienbaar op 375px met één hand.
- [ ] Vitest-test op de verkoopactie: succespad balie, succespad werkplaats, te weinig
      voorraad, aantal ≤ 0.

---

## T13 — Leveranciers (F5)
**Status:** review
**Afhankelijk van:** T05, T06

**Beschrijving**
Implementeer `/leveranciers` volgens SPEC §F5: overzicht, detail, aanmaken, bewerken,
archiveren, met koppeling naar onderdelen.

**Acceptatiecriteria**
- [ ] Overzicht toont naam, contactpersoon, telefoon, e-mail en het aantal gekoppelde
      actieve onderdelen.
- [ ] Aanmaken en bewerken via server actions met Zod-validatie; naam verplicht,
      e-mail gevalideerd indien ingevuld.
- [ ] Detailpagina toont de gekoppelde onderdelen met voorraad, met links naar de
      onderdeelpagina's.
- [ ] Archiveren zet `archivedAt`; dat lukt alleen als er geen actieve onderdelen aan
      hangen, anders een duidelijke melding.
- [ ] Gearchiveerde leveranciers zijn niet kiesbaar in het onderdeelformulier.
- [ ] Telefoon en e-mail zijn klikbaar (`tel:` / `mailto:`) op mobiel.

---

## T14 — Dashboard (F1)
**Status:** review
**Afhankelijk van:** T06, T12

**Beschrijving**
Implementeer het dashboard op `/` volgens SPEC §F1, met de aggregaties uit SPEC §4.

**Acceptatiecriteria**
- [ ] Kaarten met voorraadwaarde inkoop, voorraadwaarde verkoop, aantal unieke
      onderdelen, totaal aantal stuks en aantal onderdelen onder minimumvoorraad.
- [ ] Lage-voorraadlijst (`stockQuantity <= minStock` en `minStock > 0`) gesorteerd op
      grootste tekort, met leverancier en link naar het onderdeel.
- [ ] Bestsellers top 5 laatste 30 dagen én top 5 all-time op aantal verkochte stuks
      (balie en werkplaats samen, want beide verbruiken voorraad).
- [ ] Laatste 10 verkopen met onderdeel, aantal, bedrag en tijdstip.
- [ ] Aggregaties gebeuren in de database (`groupBy`/`aggregate`), niet door alle
      records in Node in te laden.
- [ ] Gearchiveerde onderdelen tellen niet mee in voorraadwaarde en lage voorraad,
      maar historische verkopen blijven zichtbaar.
- [ ] Lege database geeft nette nulwaarden en EmptyStates, geen crash.
- [ ] Vitest-tests voor de voorraadwaarde- en bestsellerberekening.

---

## T15 — Rapportages (F6)
**Status:** review
**Afhankelijk van:** T14

**Beschrijving**
Implementeer `/rapportages` volgens SPEC §F6: periodekeuze, kerncijfers, bestsellers,
omzet per merk, omzetverloop en CSV-export.

**Acceptatiecriteria**
- [ ] Periodekeuze 7/30/90 dagen, dit jaar en eigen datumbereik; de keuze staat in de
      URL.
- [ ] Kerncijfers over de periode, **excl. btw**: omzet, marge, margepercentage,
      aantal verkochte stuks en aantal transacties.
- [ ] Uitsplitsing balie versus werkplaats, en een filter op categorie.
- [ ] Marge wordt berekend uit `salePriceAtSale - purchasePriceAtSale`, niet uit de
      huidige prijzen van het onderdeel.
- [ ] Bestsellerslijst over de periode met stuks, omzet en marge per onderdeel.
- [ ] Omzet per merk en per categorie over de periode.
- [ ] Omzetverloop per dag of week als eenvoudige grafiek/staafjes, leesbaar op mobiel.
- [ ] CSV-export van de bestsellerslijst met correcte scheidingstekens en getalnotatie
      voor NL (komma-decimaal of expliciet gedocumenteerd).
- [ ] Periode zonder verkopen toont nullen en een EmptyState.
- [ ] Vitest-tests voor de periodeafbakening (inclusief grenzen van de datumrange).

---

## T16 — Deploy naar Vercel en README
**Status:** review
**Afhankelijk van:** T12, T13, T14, T15

**Beschrijving**
Maak de applicatie deploybaar op Vercel met Neon/Vercel Postgres en documenteer de
opzet voor de eigenaar.

**Acceptatiecriteria**
- [ ] `package.json` bevat een build die Prisma genereert en migraties toepast op
      deploy (`prisma generate` + `prisma migrate deploy`).
- [ ] README beschrijft lokaal opstarten, env vars, seeden en deployen naar Vercel.
- [ ] README legt uit dat camerascan HTTPS vereist en daarom op Vercel werkt maar niet
      op `http://` in het lokale netwerk.
- [ ] Een productie-build draait schoon met alleen de env vars uit SPEC §6.
- [ ] Documentatie vermeldt hoe het gedeelde wachtwoord gewijzigd wordt.

---

## T17 — Datamodel v2: prijzen incl. btw, leveranciersartikelnummer, voorraadmutaties
**Status:** review
**Afhankelijk van:** —

**Beschrijving**
Eén migratie die drie dingen regelt, zodat er niet drie keer aan het schema geraakt wordt.
Zie SPEC §3 regel 0 (herschreven in v2.0).

**Acceptatiecriteria**
- [ ] `Part.salePrice` wordt hernoemd naar `salePriceIncl` en bevat voortaan het bedrag
      **inclusief** btw. `Part.purchasePrice` wordt `purchasePriceExcl`. De hernoeming is
      opzettelijk: TypeScript moet elke gebruiksplek als fout markeren, zodat niemand een
      incl.-bedrag met een excl.-bedrag vergelijkt.
- [ ] Idem op `Sale`: `salePriceAtSale` → `salePriceInclAtSale`,
      `purchasePriceAtSale` → `purchasePriceExclAtSale`. `vatRateAtSale` blijft.
- [ ] De migratie zet bestaande waarden om: `salePriceIncl = ROUND(salePrice * (1 + vatRate/100), 2)`
      voor `Part`, en dezelfde omzetting met `vatRateAtSale` voor `Sale`. De
      productiedatabase bevat nu 0 onderdelen, maar de lokale database wél — de omzetting
      moet daar aantoonbaar kloppen.
- [ ] Nieuw veld `Part.supplierArticleNumber String?`, met index. Dit is het nummer dat de
      leverancier of fabrikant op de verpakking drukt; T20 matcht daarop.
- [ ] Nieuw model `StockMutation`: id, partId (relatie, onDelete Restrict), `delta Int`,
      `quantityBefore Int`, `quantityAfter Int`, `reason` (enum), `note String?`,
      `saleId String?` (gevuld als de mutatie bij een verkoop hoort), `createdAt`.
      Indexen op partId, createdAt en reason.
- [ ] Enum `StockMutationReason`: `DELIVERY`, `CORRECTION`, `COUNT`, `SALE`, `WORKSHOP`,
      `INITIAL`.
- [ ] In het schema staat als comment waarom "wie" ontbreekt: de applicatie heeft één
      gedeeld wachtwoord en geen gebruikersaccounts, dus een persoon is niet vast te
      leggen. Alleen wanneer, wat en waarom.
- [ ] `prisma migrate deploy` slaagt tegen de lokale database én tegen Neon.
      *(Bouwsessie 2026-09-30: lokaal geslaagd en de omzetting is aantoonbaar correct;
      Neon is NIET aangeraakt, conform de opdracht — die stap doet de projectmanager.)*
- [ ] `prisma/seed.ts` is bijgewerkt naar de nieuwe velden en schrijft voor elk
      geseed onderdeel een `INITIAL`-mutatie en voor elke verkoop een `SALE`- of
      `WORKSHOP`-mutatie, zodat de seed een consistent grootboek oplevert.
- [ ] Alle bestaande tests zijn meeverhuisd en groen; `tsc`, ESLint en `next build` schoon.

---

## T18 — Prijzen inclusief btw tonen en invoeren
**Status:** review
**Afhankelijk van:** T17

**Beschrijving**
Incl. btw wordt overal het hoofdbedrag; excl. staat er klein onder. Invoer verandert mee.

**Acceptatiecriteria**
- [ ] Voorraadoverzicht, detailpagina, verkoopscherm, dashboard en rapportages tonen de
      verkoopprijs **incl. btw als hoofdbedrag**, met het excl.-bedrag kleiner eronder en
      duidelijk gelabeld.
- [ ] De inkoopprijs wordt óók incl. btw als hoofdbedrag getoond, met excl. eronder.
- [ ] Teksten als "alle bedragen exclusief btw" op het dashboard zijn aangepast.
- [ ] In het onderdeelformulier voer je de **verkoopprijs incl. btw** in; het excl.-bedrag
      wordt live meeberekend en getoond. Voer je €42,00 in, dan staat er na opslaan en
      herladen exact €42,00 — test dit met minstens drie bedragen waarbij de oude aanpak
      een cent verloor (bv. 10,00 / 19,99 / 24,95 bij 21%).
- [ ] Bij de **inkoopprijs** kies je met een schakelaar of je incl. of excl. invult;
      standaard excl., want leveranciersfacturen zijn excl. De keuze is zichtbaar, niet
      verstopt.
- [ ] **Marge blijft op excl.-basis** (verkoop excl. − inkoop excl.) en de UI zegt dat er
      expliciet bij, zodat niemand denkt dat de btw winst is.
- [ ] Voorraadwaarde op het dashboard toont beide: inkoopwaarde excl. en verkoopwaarde
      incl., elk gelabeld.
- [ ] Rapportages (omzet, marge, CSV-export) rekenen aantoonbaar nog steeds excl. btw en
      geven dezelfde cijfers als vóór de migratie, op afrondingscenten na. Toon in de
      notitie een voor/na-vergelijking van minstens één periode.
- [ ] Alle bedragen via `formatEuro`; geen losse berekeningen in componenten.

---

## T19 — Snel voorraad aanpassen
**Status:** review
**Afhankelijk van:** T17

**Beschrijving**
Voorraad wijzigen zonder het bewerkformulier te openen, op detailpagina én in de lijst.
Elke wijziging schrijft een regel in `StockMutation`.

**Acceptatiecriteria**
- [ ] Op `/onderdelen/[id]` staan bij Voorraad knoppen **−** en **+** (±1), plus een knop
      voor "exact aantal instellen" en een voor "bijboeken" (bv. levering van 10 stuks).
- [ ] Bij bijboeken en bij exact instellen kies je een reden: levering, correctie of
      telling. Die belandt in `StockMutation.reason`.
- [ ] Dezelfde −/+ knoppen staan op elke kaart en elke rij in `/onderdelen`, zodat de
      detailpagina niet nodig is.
- [ ] De wijziging is **optimistisch**: de UI springt direct, met een korte bevestiging en
      een **ongedaan maken**-knop die de mutatie terugdraait (als nieuwe tegengestelde
      mutatie, niet door de oude regel te wissen).
- [ ] Mislukt de server-actie, dan springt de UI terug naar de oude waarde met een
      duidelijke melding. Geen stille mislukking.
- [ ] **Voorraad kan nooit onder 0.** Server-side afgedwongen binnen dezelfde transactie
      als de mutatieregel, met dezelfde voorwaardelijke-update-aanpak als in
      `sales.ts` — een lees-dan-schrijf is niet veilig bij twee tegelijk openstaande
      telefoons.
- [ ] Voorraadwijziging en `StockMutation`-regel staan altijd in één transactie.
- [ ] Het dashboard telt "onder minimumvoorraad" direct goed na een wijziging
      (`revalidatePath` op zowel `/` als `/onderdelen`).
- [ ] Raakvlakken minimaal 44×44px; op 375px goed te bedienen met één duim. Dit wordt in
      de werkplaats op een telefoon gebruikt.
- [ ] Snel twee keer op **+** tikken levert +2 op, niet +1 en niet een verloren tik.

---

## T20 — Artikelnummer scannen met tekstherkenning (OCR)
**Status:** review
**Afhankelijk van:** T17, T19

**Beschrijving**
Met de camera het artikelnummer van een verpakking of label lezen en het bijbehorende
onderdeel vinden. De bestaande barcodescanner (T10) blijft bestaan en wordt hergebruikt.

**Acceptatiecriteria**
- [ ] Knop "Scan" bovenaan `/onderdelen` en in de navigatie.
- [ ] Live camerabeeld met een richtkader; OCR via Tesseract.js, en via de `TextDetector`
      API waar die bestaat. De bibliotheek wordt **dynamisch geladen**, niet in de
      hoofdbundel — Tesseract is enkele megabytes en mag het openen van de app niet
      vertragen.
- [ ] Herkende tekst wordt gematcht tegen `sku`, `barcode` én `supplierArticleNumber`.
- [ ] Bij het matchen wordt genormaliseerd: hoofdletters, spaties en streepjes genegeerd,
      en de veelvoorkomende OCR-verwisselingen O/0, I/1/l, S/5, B/8, Z/2 als gelijk
      behandeld. Deze normalisatie zit in een **pure functie met tests**, los van de UI.
- [ ] Er wordt **nooit automatisch iets gewijzigd**: de app toont het gevonden onderdeel,
      of een paar kandidaten, en vraagt om bevestiging.
- [ ] Na bevestiging opent direct het snel-aanpassen-scherm uit T19.
- [ ] Geen match: de herkende tekst wordt getoond en is handmatig te corrigeren of als
      zoekopdracht te gebruiken.
- [ ] Ziet de camera een **barcode**, dan wordt die voorrang gegeven boven OCR — een
      barcode is betrouwbaar, OCR op een bedrukte verpakking niet.
- [ ] Geweigerde cameratoestemming, geen camera, of geen HTTPS geven elk een eigen
      Nederlandse melding met terugval op handmatig zoeken.
- [ ] Camerastream stopt bij sluiten en bij unmount.
- [ ] De notitie in PROGRESS.md vermeldt eerlijk hoe betrouwbaar de herkenning in de
      praktijk was, inclusief wat er misging.

---

## T21 — Debugcode uit het verkoopscherm verwijderen
**Status:** review
**Afhankelijk van:** —
**Prioriteit: eerst.** Dit staat nu in productie.

**Beschrijving**
In `src/app/(app)/verkoop/page.tsx` staat achtergebleven scaffolding uit T12, waarvan de
bouwende agent halverwege werd afgebroken. De projectmanager heeft dat destijds
goedgekeurd op groene tests; deze code zat in geen enkele test.

**Acceptatiecriteria**
- [ ] Het hardgecodeerde onderdeel achter zoekterm `"demo"` (regels ~119-133, met
      `id: "demo_1"`) is volledig weg, inclusief de uitzondering `query !== "demo"` in de
      voorwaarde erboven. Zoeken op "demo" doet daarna gewoon een databasezoekopdracht.
- [ ] De `.catch(() => [])` op `listRecentSales` is weg. Faalt die query, dan ziet de
      gebruiker een duidelijke Nederlandse foutmelding in plaats van een lege lijst
      (SPEC §F8: geen stille mislukkingen). De rest van het verkoopscherm moet blijven
      werken als alleen de lijst recente verkopen faalt.
- [ ] Er staat nergens meer `TIJDELIJK` in `src/`.
- [ ] Controleer de andere `.catch(...)` in `src/app/(app)/onderdelen/BarcodeField.tsx`
      (regel ~77): slikt die ook een fout stil weg? Zo ja, geef de gebruiker een melding.
- [ ] Rendertest: `/verkoop` geeft 200, en zoeken op "demo" levert geen spookproduct meer.

---

## T22 — Grootboek sluitend maken: verkopen en nieuwe onderdelen loggen
**Status:** review
**Afhankelijk van:** T17

**Beschrijving**
T17 leverde de `StockMutation`-tabel en een sluitend grootboek ná de seed, maar de paden
die daarna voorraad wijzigen schrijven er nog niet in. Vanaf de eerste verkoop loopt het
grootboek dus achter. Dat is precies de situatie die bij de keuze voor dit grootboek
vermeden moest worden.

**Acceptatiecriteria**
- [ ] `registerSale()` in `src/lib/queries/sales.ts` schrijft binnen **dezelfde
      transactie** een `StockMutation` met reason `SALE` of `WORKSHOP` (afhankelijk van
      het kanaal), `saleId` gevuld, en kloppende `quantityBefore`/`quantityAfter`.
- [ ] Een nieuw onderdeel met een beginvoorraad > 0 schrijft een `INITIAL`-mutatie.
- [ ] Wijzigt het bewerkformulier de voorraad, dan schrijft dat een `CORRECTION`-mutatie
      met de oude en nieuwe stand. Wijzigt het de voorraad niet, dan geen mutatie.
- [ ] Er is een test die bewijst dat na een verkoop de som van alle mutaties van een
      onderdeel exact gelijk is aan `stockQuantity`.
- [ ] Faalt het schrijven van de mutatie, dan draait de hele transactie terug: er mag geen
      voorraadwijziging bestaan zonder mutatieregel.

---

## T23 — Kanaalkeuze in het verkoopscherm losmaken van React-state
**Status:** todo
**Afhankelijk van:** —

**Beschrijving**
Bij T18 bleek een gecontroleerde radiogroep binnen een server-action-formulier uit de pas
te kunnen lopen met wat er verstuurd wordt: na een validatiefout rendert de server het
formulier opnieuw met `checked` op de standaardwaarde, terwijl React de DOM niet bijwerkt
omdat de prop in zijn ogen niet veranderde. Het scherm toonde "incl. btw", het formulier
verstuurde "excl." — een stille fout van 21%.

`src/app/(app)/verkoop/SaleScreen.tsx` gebruikt hetzelfde patroon voor de kanaalkeuze
balie/werkplaats. Nu niet waarneembaar omdat de selectie na elke verkoop gewist wordt,
maar het gevolg zou zijn dat werkplaatsverbruik als balieomzet geboekt wordt — en dat
vervuilt precies de uitsplitsing waarvoor dat kanaal bestaat.

**Acceptatiecriteria**
- [ ] De kanaalkeuze gebruikt hetzelfde patroon als `PartForm` na de fix: één verborgen
      veld dat uit de React-state gevuld wordt, met `type="button"`-knoppen en
      `aria-pressed` ernaast. De verstuurde waarde kan dan per constructie niet afwijken
      van wat op het scherm staat.
- [ ] Test die bewijst dat na een mislukte verkoop (bv. onvoldoende voorraad) de getoonde
      kanaalkeuze en de verstuurde waarde gelijk blijven.
- [ ] Werkorderreferentie blijft eveneens staan na een fout.
- [ ] Zoek of ditzelfde patroon nog ergens anders in `src/app/` zit en meld wat je vindt.

---

## T24 — Voorraadgrootboek zichtbaar maken
**Status:** review
**Afhankelijk van:** T17, T19, T22

**Beschrijving**
Sinds T17/T19/T22 wordt elke voorraadwijziging vastgelegd in `StockMutation`, maar geen
enkel scherm toont die regels. De eigenaar vroeg er expliciet naar. Twee weergaven, want
het zijn twee verschillende vragen: "wat is er met dit onderdeel gebeurd" en "wat is er
vandaag in de zaak gebeurd".

**Acceptatiecriteria**
- [ ] Op `/onderdelen/[id]` een blok "Voorraadgeschiedenis" met de mutaties van dat
      onderdeel, nieuwste bovenaan: datum en tijd, verandering (+10 / −1), oude → nieuwe
      stand, reden in Nederlands label, en de notitie of werkorderreferentie als die er is.
- [ ] Standaard de laatste 10, met "toon meer" of paginering. Een onderdeel dat een jaar
      meeloopt krijgt honderden regels; de pagina mag daar niet traag van worden.
- [ ] Nieuwe pagina `/voorraadmutaties` met alle wijzigingen over alle onderdelen,
      nieuwste bovenaan, met de onderdeelnaam en een link ernaartoe.
- [ ] Filteren op reden (levering, correctie, telling, verkoop, werkplaats, beginstand) en
      op periode, met de keuze in de URL zodat de pagina deelbaar en herlaadbaar is.
- [ ] Bij een mutatie met reden SALE of WORKSHOP is zichtbaar dat hij uit een verkoop
      komt; link naar het onderdeel.
- [ ] Bereikbaar vanuit de navigatie, maar niet in de mobiele onderbalk — die heeft al zes
      items en dit is geen baliefunctie. Zet hem bijvoorbeeld op het dashboard of in de
      zijbalk.
- [ ] Lege toestand met het bestaande EmptyState-component.
- [ ] Mobiel bruikbaar op 375px: geen brede tabel maar kaarten of een compacte lijst.
- [ ] De queries aggregeren en pagineren in de database, niet door alles in Node te laden.
- [ ] DTO-regel (SPEC §3 regel 1): geen Decimal of Date naar client components.

---

## Feedback van review

### Reviewronde 1 — 2026-09-22 (PM)

**Alle 16 taken zijn gebouwd.** Statische verificatie is door de projectmanager zelf
gedraaid, niet alleen door de bouwers overgenomen:

| Controle | Uitkomst |
|---|---|
| `npx tsc --noEmit` | 0 fouten |
| `npx vitest run` | 331 tests groen, 13 bestanden |
| `npx eslint .` | schoon |
| `npx next build` | slaagt, alle `(app)`-routes dynamisch |

**Twee integratiebugs gevonden en opgelost**, beide pas zichtbaar bij `next build` —
geen enkele taakagent had die kunnen vinden met alleen `tsc` en `vitest`:

1. Drie `"use server"`-bestanden exporteerden ook gewone constanten
   (`initialSupplierFormState` en vier soortgelijke). Next.js 15 verbiedt dat; de
   productiebuild brak op alle formulierschermen. Opgelost door de statusconstanten naar
   aparte `form-state.ts`-bestanden te verplaatsen.
2. De beschermde routes werden statisch geprerenderd, waardoor de build de database
   probeerde te lezen. Erger: een statisch dashboard zou de cijfers van het buildmoment
   voor altijd tonen. Opgelost met `export const dynamic = "force-dynamic"` in
   `src/app/(app)/layout.tsx`.

**Geen enkele taak staat op `done`.** Alle 16 staan op `review`, omdat elke taak minstens
één acceptatiecriterium heeft dat een echte database vereist. Zie hieronder.

### Reviewronde 2 — 2026-09-22: draaiende database

Er draait nu een lokale PostgreSQL 16.4 (embedded binaries, poort 5433) zodat de app
getest kan worden. Daarmee zijn deze punten WEL geverifieerd:

- **T02 is echt toegepast.** `prisma migrate deploy` draaide zonder fouten tegen een lege
  database, inclusief de handgeschreven CHECK-constraints.
- **T03 draait en is idempotent.** Na de eerste run: 25 merken, 4 leveranciers, 40
  onderdelen (9 onder minimumvoorraad), 86 verkopen (57 balie, 29 werkplaats). Na een
  tweede run exact dezelfde aantallen, geen duplicaten, geen crash.
- **T06's lage-voorraadconditie klopt.** De Prisma field reference
  (`stockQuantity <= minStock` met `minStock > 0`) levert tegen echte Postgres 9
  onderdelen op, gelijk aan wat de seed rapporteert. Dit was het punt dat alleen tegen
  een mock bewezen was.
- Voorraadwaarde uit de database: € 14.333,40 inkoop en € 27.130,50 verkoop, excl. btw.

**Bug gevonden en gerepareerd bij het draaien van de seed (T03):**
`prisma/seed.ts` riep `pick(bestsellerKeys)` aan BINNEN de predicate van `PARTS.find(...)`.
Die predicate draait per element, dus er werd telkens opnieuw een willekeurige sleutel
gekozen en `find` vond meestal niets. Het non-null assertion `!` liet dat `undefined`
vervolgens door, waarna de seed stukliep op `.key`. De sleutel wordt nu één keer gekozen
en er volgt een duidelijke fout als hij niet bestaat. Dit is precies het soort fout dat
geen enkele unit test ving omdat de seed nooit was uitgevoerd.

### Reviewronde 3 — 2026-09-22: eerste echte gebruik

De eigenaar meldde dat de voorraadpagina niet werkte. **Bevestigd en opgelost.**

**Bug (T07):** `src/app/(app)/onderdelen/PartsFilters.tsx` had `"use client"` bovenaan maar
exporteerde daarnaast pure hulpfuncties (`normalizeSearchParams`, `parsePartsSearchParams`,
`buildPartsQuery` en drie andere). Next.js maakt van élke export uit een client-module een
client-referentie, dus de server component `page.tsx` kon ze niet aanroepen: `/onderdelen`
crashte bij elk bezoek. De pure logica staat nu in `search-params.ts` zonder `"use client"`.

De bouwer motiveerde deze plaatsing destijds expliciet ("dit bestand importeert alleen
types, dus het is veilig vanuit server components"). Die redenering was fout: het gaat niet
om wat het bestand importeert, maar om de `"use client"`-directive zelf.

**Waarom niets dit ving:** `tsc`, ESLint, 331 tests en `next build` waren allemaal groen.
De fout treedt alleen op bij het renderen — en doordat we eerder `force-dynamic` hadden
gezet, rendert de build die pagina juist níét. De twee fixes verborgen elkaar.

**Les voor de resterende review:** een groene build zegt hier weinig. Elke pagina moet één
keer echt opgehaald zijn. Dat is nu gedaan: met een sessiecookie dat via de eigen
`createSessionValue()` van de app is aangemaakt, geven `/onderdelen`, `/onderdelen/nieuw`,
`/`, `/verkoop`, `/leveranciers`, `/merken` en `/rapportages` alle zeven HTTP 200 mét
echte data in de HTML (onderdeelnamen, voorraadwaarde, bestsellers, omzet).

**Audit uitgevoerd:** alle andere `"use client"`-bestanden onder `src/app/**` exporteren
uitsluitend componenten en types. Alleen `PartsFilters.tsx` had deze fout.

### Wat nog NIET geverifieerd is (vereist een `DATABASE_URL`)

Dit is de volledige lijst; niets hiervan is stilzwijgend afgevinkt:

*(T02, T03 en T06 zijn inmiddels wél geverifieerd — zie Reviewronde 2 hierboven.)*

- **T12** — de voorwaardelijke `updateMany` die de race tussen twee balies afvangt, is
  alleen met een gemockte client getest. Dit is het belangrijkste ding om met een echte
  database na te spelen: twee gelijktijdige verkopen van het laatste stuk.
- **T14 / T15** — de `$queryRaw`-aggregaties (voorraadwaarde als som van een product van
  twee kolommen, `date_trunc` met tijdzone `Europe/Amsterdam`, enum-casts) zijn niet
  uitgevoerd. Controleer ook of `date_trunc('week', ...)` op de ingezette
  Postgres-versie op maandag begint, zoals `isoWeekStart()` aanneemt.
- **T07 / T08 / T13 / T14 / T15** — geen enkel scherm is met echte data bekeken. De
  mobiele weergave op 375px is per scherm ontworpen maar alleen voor de loginpagina
  visueel gecontroleerd.
- **T10 / T11** — camerascan is niet op een echt toestel getest. Wel afgedekt met een
  losse jsdom-testrun: `open={false}` vraagt geen camera, unmount tijdens een lopende
  `getUserMedia` stopt de stream alsnog, en geweigerde toestemming geeft de juiste melding.
- **T16** — `npm run build` bevat `prisma migrate deploy` en is dus niet volledig
  gedraaid; `npx next build` slaagt wel. De echte Vercel-deploy is niet gedaan.

### Aandachtspunten uit de bouw

- **Zeldzame flake in `auth.test.ts`.** Eén keer gefaald in een gedeelde run, daarna
  geslaagd in isolatie en in drie volledige herhalingen. Geen regressie, maar dit moet
  uitgezocht zijn vóórdat de suite in CI gaat draaien — een flaky auth-test is precies
  het soort test dat mensen gaan negeren.
- **Race bij het verwijderen van een merk (T09).** Tussen de controle op gekoppelde
  onderdelen en de `delete` kan een ander verzoek er een onderdeel aan hangen. Bewust
  geaccepteerd voor v1 (één balie), anders dan bij de duplicaatnaam, die wél een
  P2002-vangnet heeft.
- **Sorteren op marge (T06)** leest alle gefilterde rijen voordat het pagineert, omdat
  marge een afgeleide waarde is. Prima bij één winkel; bij tienduizenden regels is een
  gegenereerde margekolom met index de volgende stap.
- **Rate limiting op de login is in-memory** en dus per serverinstantie. Op Vercel
  betekent dat: niet waterdicht. Staat zo in SPEC §F7 en in de README.

---

## Nieuwe wensen / observaties

Nieuwe wensen worden hier genoteerd en door de projectmanager omgezet in een taak.
Ze worden niet tussendoor gebouwd.

- (2026-09-21, PM) **Onderzoek Beumer de Jong (beumerdejong.nl).** Bevindingen uit
  hun eigen site, met gevolgen voor SPEC. Elk punt moet nog omgezet worden in een taak
  of in een SPEC-wijziging; niets hiervan zit in T01-T16.
  **Status 2026-09-21: punten 1 t/m 5 en 8 zijn door de opdrachtgever goedgekeurd en
  verwerkt in SPEC 1.1 en in de taken T02, T03, T06, T07, T08, T12, T14 en T15. Punten
  6 en 7 staan nog open.**

  1. ~~**Btw-inconsistentie in SPEC §4.**~~ VERWERKT (prijzen excl. btw + `vatRate`). Daar
     staat inkoopprijs excl. btw en verkoopprijs incl. btw. Elke marge wordt dan ~21%
     te hoog. Voorstel: beide prijzen excl. btw opslaan, `vatRate` per onderdeel
     (default 21), verkoopprijs incl. btw afleiden voor de balie.
  2. ~~**`Part.brandId` is verplicht.**~~ VERWERKT (optioneel gemaakt). De werkplaats bedient vrijwel alle
     merken; olie, remblokken, kabels, lampjes en banden zijn merkonafhankelijk.
     Voorstel: `brandId` optioneel maken.
  3. ~~**Assortiment is breder.**~~ VERWERKT (`Category`-enum). Ze voeren ook fatbikes en
     e-bikes (Knaap, Super73, Phatfour), scootmobielen, city cars (Move) en helmen en
     accessoires (Shark, ROOF, Beon). Voorstel: `Category` toevoegen aan Part, zodat
     voorraad en rapportage per categorie te filteren zijn.
  4. ~~**Werkplaatsverbruik ontbreekt.**~~ VERWERKT (`Sale.channel`). Een deel van het onderdelenverbruik gaat in
     reparaties, niet over de balie. Zonder registratie klopt de voorraad structureel
     niet. Voorstel: `Sale.channel` (balie | werkplaats) plus een vrij referentieveld.
     Let op: kenteken of klantnaam is een persoonsgegeven (AVG) - alleen opnemen als
     het echt nodig is.
  5. ~~**Pasvorm ontbreekt.**~~ VERWERKT (`fitsModels`). Aan de balie is de vraag "past dit op een Vespa Primavera
     2019?". Voorstel: vrij tekstveld `fitsModels`, meegenomen in de zoekfunctie. Een
     echte compatibiliteitsmatrix is v2.
  6. **OPEN — Besteladvies per leverancier.** Met 24 merken en dus veel importeurs is de
     lage-voorraadlijst pas bruikbaar als hij per leverancier gegroepeerd kan worden.
     Kleine uitbreiding op T14.
  7. **OPEN — Barcodes.** Voorverpakte onderdelen hebben een EAN van de importeur, bulkdelen
     niet. `Part.barcode` als enkel uniek veld kan knellen (eigen label naast
     fabrikantcode). Voorstel: eigen labels printen uit de backlog halen, of meerdere
     barcodes per onderdeel toestaan.
  8. ~~**Seed-data concreter maken.**~~ VERWERKT in T03. Gebruik hun werkelijke merken: Vespa,
     Piaggio, Peugeot, Kymco, SYM, AGM, BTC, Brixton, MT, Rieju, Benelli, Hanway,
     Aprilia, NIU, Super Soco, Segway, Knaap, Phatfour, Super73, Art, Shark, Roof,
     Beon, Boxer, Riva.

- (2026-09-21, PM) Verkoop corrigeren/storneren staat in SPEC §9 als backlog. Sterke
  aanbeveling om dit als T17 op te nemen zodra v1 draait: een mistap aan de balie is
  nu alleen via de database terug te draaien.

- (2026-09-30, bouwsessie T17) **Het voorraadgrootboek loopt vanaf nu achter op de
  werkelijkheid.** T17 levert het model `StockMutation` en een sluitend grootboek in
  de seed, maar geen enkele schermactie schrijft er een regel in: `registerSale()` in
  `src/lib/queries/sales.ts` verlaagt de voorraad zonder mutatieregel, en het
  onderdeelformulier (`src/app/(app)/onderdelen/actions.ts`) legt geen
  `INITIAL`-regel aan voor een nieuw onderdeel met beginvoorraad. T19 dekt alleen de
  −/+-knoppen, niet de verkoopactie. Direct na de seed is het grootboek sluitend;
  elke verkoop daarna maakt het onvolledig. Voorstel: een eigen taak vóór of samen
  met T19 die (a) de verkooptransactie een `SALE`/`WORKSHOP`-regel laat schrijven
  binnen dezelfde `prisma.$transaction`, en (b) het aanmaken van een onderdeel een
  `INITIAL`-regel. Niet gebouwd, want het staat niet in de acceptatiecriteria van T17.

- (2026-09-30, bouwsessie T17) **Leftover debugcode in `src/app/(app)/verkoop/page.tsx`.**
  Twee blokken met de opmerking `// TIJDELIJK`, beide al aanwezig vóór T17:
  1. een hardgecodeerd demo-onderdeel ("Remblokset voor Vespa Primavera", sku
     REM-001) dat als geselecteerd onderdeel verschijnt zodra iemand in het
     verkoopscherm op "demo" zoekt. Het bestaat niet in de database, dus bevestigen
     loopt op een fout;
  2. `await listRecentSales(RECENT_SALES_LIMIT).catch(() => [])` — dat slikt élke
     databasefout stil weg en toont dan "geen recente verkopen" in plaats van een
     melding. Precies het soort stille mislukking dat de reviewrondes eerder hebben
     gekost.
  Alleen de veldnamen zijn tijdens T17 meegehernoemd; verder onaangeroerd.

- (2026-10-01, bouwsessie T21+T22) **`grep` slaat drie bronbestanden over zonder `-a`.**
  `src/lib/auth.ts`, `src/lib/__tests__/auth.test.ts` en
  `src/components/__tests__/barcode-scanner.test.ts` bevatten met opzet literal
  control-characters (in een regex en in testdata) en worden daardoor als binair
  gezien: `grep -rn "..." src/` slaat ze stil over en meldt dat niet. Wie later naar
  achtergebleven markers of patronen zoekt moet `grep -ra` gebruiken. Niets kapot,
  maar het maakt een "nul treffers"-controle misleidend. Niet gebouwd/gewijzigd, want
  het staat buiten T21/T22.

- (2026-10-01, bouwsessie T18) **De kanaalkeuze in het verkoopscherm is een
  gecontroleerde radiogroep en loopt hetzelfde risico als de incl./excl.-schakelaar
  die in T18 is omgebouwd.** In `src/app/(app)/verkoop/SaleScreen.tsx` staan "Balie"
  en "Werkplaats" als `<input type="radio" checked={...}>` binnen een formulier dat
  door een server action wordt verwerkt. Bij de inkoopschakelaar bleek dat na een
  serverrespons de DOM-`checked` kan terugvallen op wat de SERVER rendert, terwijl de
  React-state (en dus de markering op het scherm) iets anders zegt — het scherm toont
  dan A en het formulier verstuurt B. Bij het verkoopscherm is dat nu niet
  waarneembaar, omdat de selectie na een geslaagde verkoop sowieso gewist wordt en een
  foutpad het kanaal niet opnieuw laat verzenden. Het patroon is er wel, en het
  gevolg zou zijn dat een werkplaatsregel als balieverkoop geboekt wordt. Voorstel:
  dezelfde aanpak als in `PartForm` (één verborgen veld gevuld vanuit de state, met
  `type="button"`-knoppen ernaast). Niet gebouwd: het staat buiten T18.

- (2026-10-01, bouwsessie T21+T22) **Voorraadcorrectie op het bewerkformulier is een
  absolute overschrijving.** `updatePartAction` leest de oude stand binnen de
  transactie en zet de voorraad daarna op het ingetypte getal (nu met een
  `CORRECTION`-regel, T22). Slaan twee mensen tegelijk hetzelfde formulier op, dan
  wint de laatste; het grootboek klopt dan nog wel met de eindstand, maar de
  tussentijdse correctie van de ander is overschreven. Een echt
  voorraadcorrectiescherm (verschil invoeren in plaats van eindstand, met eigen
  reden `COUNT`/`DELIVERY`) zou dat voorkomen. Staat niet in T22.

- (2026-10-01, bouwsessie T19) **Het bewerkformulier blijft een absolute
  overschrijving zonder voorwaardelijke update.** T19 heeft `adjustStock()` met de
  compare-and-set uit `sales.ts`, maar `updatePartAction` in
  `src/app/(app)/onderdelen/actions.ts` schrijft de voorraad nog steeds met een kale
  `update` op het ingetypte getal. De observatie hierboven (T21+T22) staat daarmee nog
  open; het is nu wel in één stap op te lossen door dat pad `adjustStock()` met
  `mode: "absolute"` te laten gebruiken. Buiten T19 gelaten: dat formulier valt onder
  T08/T22.

- (2026-10-01, bouwsessie T19) **Het voorraadgrootboek is nergens te zien.** Elke
  mutatie wordt nu netjes weggeschreven (INITIAL, SALE, WORKSHOP, DELIVERY, CORRECTION,
  COUNT) en is sluitend, maar er is geen scherm dat de regels van een onderdeel toont.
  Daardoor kan de garagehouder een verkeerde boeking van gisteren niet terugvinden —
  de "ongedaan maken"-knop uit T19 werkt alleen zolang de bevestiging op het scherm
  staat. Voorstel: een eenvoudige mutatiegeschiedenis op `/onderdelen/[id]`, met de
  mogelijkheid om een oudere regel tegen te boeken. Buiten T19 gelaten.

- (2026-10-01, bouwsessie T19) **Kolom Voorraad maakt de tabel op `/onderdelen`
  breder.** De −/+ knoppen (48px elk) kosten ~170px in de tabelcel, waardoor de tabel
  op een smalle laptop eerder horizontaal scrollt. Op 375px speelt het niet (daar staat
  de kaartweergave). Als het hindert: in de tabel een compactere variant (bv. 44px en
  minder tussenruimte) of de knoppen pas tonen bij hover/focus.

- (2026-10-01, bouwsessie T20) **`supplierArticleNumber` zit niet in het zoekveld van
  `/onderdelen`.** Het scanscherm matcht erop (dat vraagt T20), maar wie het nummer in
  het gewone zoekveld typt vindt niets: `buildPartWhere()` zoekt op naam, sku, barcode
  en pasvorm. Dat is precies het nummer dat op de verpakking staat, dus aan de balie is
  dat verwarrend. Eén regel in de `OR` van `buildPartWhere` lost het op, maar dat
  wijzigt het gedrag van T07 en stond niet in T20. De terugval in het scanscherm werkt
  wel: "opnieuw opzoeken" na handmatig verbeteren zoekt over alle drie de velden.

- (2026-10-01, bouwsessie T20) **De tekstherkenning haalt megabytes van een CDN.**
  tesseract.js laadt zijn worker, de WebAssembly-kern en het Engelse taalmodel bij het
  eerste gebruik van `cdn.jsdelivr.net` (het taalmodel alleen al 5 MB gecomprimeerd).
  In een werkplaats met slechte of geen wifi werkt OCR daardoor niet; de barcodescanner
  en het handmatig zoeken wél. Zelf hosten in `public/` kan, maar zet een paar megabyte
  build-artefacten in de repo — dat is een beslissing voor de projectmanager, niet iets
  wat binnen T20 paste.

- (2026-10-01, bouwsessie T20) **De herkenningskwaliteit is alleen op GEGENEREERDE
  afbeeldingen gemeten, niet op echte verpakkingen.** Schone, rechte tekst wordt goed
  gelezen; een beeld dat 10 graden gedraaid stond werd onleesbaar (`Art.nr- PlA-4T.g
  455`). Vóór oplevering zou de eigenaar twintig echte pakjes onder werkplaatsverlichting
  moeten scannen; pas dan is er iets zinnigs te zeggen over hoe vaak dit in de praktijk
  werkt. Zie de tabel in de PROGRESS-notitie van T20.

- (2026-10-01, bouwsessie T20) **`eng.traineddata` staat niet in `.gitignore`.**
  tesseract.js in Node (alleen gebruikt tijdens het testen; de app draait in de browser)
  legt dat bestand van 5 MB in de projectroot. Eén regel in `.gitignore` voorkomt dat
  het ooit per ongeluk gecommit wordt.

- (2026-10-01, bouwsessie T24) **Observaties, niet gebouwd:**
  1. `formatDateTime` in `src/app/(app)/page.tsx` (dashboard, "Laatste verkopen") geeft
     geen `timeZone` mee. Op een UTC-server (Vercel) staan de tijden daardoor 1-2 uur
     naast de Amsterdamse tijd. De T24-weergaven gebruiken wel `Europe/Amsterdam`
     (`src/lib/stock-mutation-format.ts`); het dashboard kan dat helpertje overnemen.
  2. `/onderdelen/[id]` met een onbestaand id toont de 404-pagina maar antwoordt met HTTP 200,
     doordat `(app)/loading.tsx` de respons al heeft gestart. Bestaand gedrag, niet nieuw.
  3. Voor `StockMutation` ontbreekt een samengestelde index `(partId, createdAt)`. Bij dit
     volume niet nodig; relevant zodra één onderdeel tienduizenden regels krijgt.
  4. De notitie van een mutatie bevat soms een technische id ("mutatie cmup…", T19 "ongedaan
     maken"). Leesbaar genoeg voor nu; een link naar de oorspronkelijke regel kan later.
