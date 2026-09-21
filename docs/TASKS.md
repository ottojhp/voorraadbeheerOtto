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
**Status:** todo
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
**Status:** todo
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
**Status:** todo
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
**Status:** todo
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
**Status:** todo
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
**Status:** todo
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
**Status:** todo
**Afhankelijk van:** T06

**Beschrijving**
Implementeer `/onderdelen` volgens SPEC §F2: tabel met zoeken, filters, sortering,
groepering per merk en lage-voorraadmarkering.

**Acceptatiecriteria**
- [ ] Tabel toont naam, merk, categorie, sku, inkoopprijs, verkoopprijs excl. btw met
      de incl.-prijs erbij, marge (€ en %), voorraad, minimumvoorraad en leverancier.
- [ ] Zoekveld filtert op naam, sku, barcode en pasvorm; filterstatus staat in de URL zodat de
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
**Status:** todo
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
**Status:** todo
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
**Status:** todo
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
**Status:** todo
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
**Status:** todo
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
**Status:** todo
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
**Status:** todo
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
**Status:** todo
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
**Status:** todo
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

## Feedback van review

Nog geen reviews uitgevoerd. Afgekeurde taken krijgen hier (en onder de taak zelf)
puntsgewijze feedback met bestand en regel.

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
