# SPEC — Voorraadbeheer Scooter- & Motoronderdelen

Versie: 2.0 — laatst bijgewerkt: 2026-09-30
Status: vastgesteld, basis voor `docs/TASKS.md`

---

## 1. Doel en context

Webapplicatie waarmee een garage/winkel de voorraad van scooter- en motoronderdelen
beheert. De applicatie geeft inzicht in:

- wat er op voorraad ligt en wat het waard is,
- wat er bijbesteld moet worden (lage voorraad),
- wat de marge is tussen inkoop en verkoop,
- welke onderdelen het best verkopen.

De opdrachtgever is een Amsterdamse tweewielerzaak met een eigen werkplaats en een
breed assortiment: scooters, motoren, e-scooters, fatbikes/e-bikes, scootmobielen en
accessoires, verdeeld over ruim twintig merken. De werkplaats onderhoudt ook merken die
de winkel zelf niet verkoopt. Het datamodel is daarop afgestemd: merk is optioneel
(universele onderdelen zoals olie en remblokken), elk product heeft een categorie, en
voorraadverbruik in de werkplaats wordt net zo geregistreerd als verkoop over de balie.

Gebruikers zijn de eigenaar en het baliepersoneel. Verkoop registreren en scannen
gebeurt aan de balie op een telefoon of tablet; beheer (onderdelen invoeren,
rapportages) gebeurt meestal op een laptop.

**Niet-doel v1:** geen kassasysteem, geen facturatie, geen boekhoudkoppeling, geen
klantenadministratie, geen werkplaatsorders.

---

## 2. Tech stack (vastgelegd)

| Laag | Keuze |
|---|---|
| Framework | Next.js 15+, App Router, React Server Components |
| Taal | TypeScript, `strict: true` |
| Styling | Tailwind CSS |
| Database | Postgres (Neon of Vercel Postgres) |
| ORM | Prisma |
| Validatie | Zod (gedeeld tussen server actions en formulieren) |
| Tests | Vitest (unit, op business logic: marge, voorraadwaarde, rapportagequeries) |
| Hosting | Vercel |
| Barcode | `BarcodeDetector` API waar beschikbaar, fallback `@zxing/library` |

Mutaties lopen via **Next.js Server Actions**, niet via losse REST-routes, tenzij een
feature een echte HTTP-endpoint nodig heeft (bv. login-POST). Data lezen gebeurt in
Server Components via een datalaag in `src/lib/`.

---

## 3. Architectuurregels (bindend)

0. **Btw (gewijzigd in v2.0):** de **verkoopprijs wordt inclusief btw opgeslagen**, de
   **inkoopprijs exclusief**. Elk product heeft een eigen `vatRate` (default 21).
   - Reden verkoop incl.: dat is het bedrag dat de winkel vaststelt en de klant betaalt,
     en het moet exact blijven. Excl. opslaan in twee decimalen verliest centen bij het
     terugrekenen: €10,00 incl. bij 21% wordt 8,264462… → opgeslagen 8,26 → terug €9,99.
   - Reden inkoop excl.: leveranciersfacturen zijn exclusief btw.
   - **Marge en rapportages rekenen altijd met bedragen exclusief btw**, want btw is geen
     winst. Verkoop excl. wordt afgeleid: `salePriceIncl / (1 + vatRate / 100)`.
   - De afgeleide waarde mag afwijken in de orde van een halve cent. Dat is aanvaard: het
     is een stuurgetal, geen bedrag dat iemand betaalt.
   - Veldnamen dragen de betekenis (`salePriceIncl`, `purchasePriceExcl`), zodat een
     verwarring tussen de twee een compilerfout geeft in plaats van een stille rekenfout.
1. **Geldbedragen** worden in de database opgeslagen als `Decimal @db.Decimal(10,2)`
   in euro's. Prisma geeft `Decimal`-objecten terug; die mogen **nooit** rechtstreeks
   naar een client component. De datalaag mapt altijd naar een plain DTO met `number`
   (euro) vóórdat data de pagina in gaat. Reden: RSC-serialisatie en floatfouten.
2. **Afronding** gebeurt op 2 decimalen, alleen bij presentatie. Formattering via één
   helper (`formatEuro`) met `Intl.NumberFormat('nl-NL', { currency: 'EUR' })`.
3. **Historische correctheid:** een `Verkoop`-regel bewaart zowel de verkoopprijs als
   de inkoopprijs op het moment van verkoop. Zonder de historische inkoopprijs is de
   marge in rapportages niet reconstrueerbaar als prijzen later wijzigen.
4. **Nooit hard verwijderen** wat in verkoophistorie voorkomt. Onderdelen en
   leveranciers gebruiken soft delete (`archivedAt`). Gearchiveerde records zijn
   verborgen in overzichten en niet selecteerbaar bij nieuwe verkoop, maar blijven
   zichtbaar in rapportages.
5. **Voorraad verlagen en verkoop loggen is één atomaire transactie**
   (`prisma.$transaction`). Er mag geen verkoop bestaan zonder bijbehorende
   voorraadmutatie en andersom.
6. **Negatieve voorraad is niet toegestaan.** Een verkoop van meer stuks dan op
   voorraad wordt geweigerd met een duidelijke melding.
7. Alle server-side invoer wordt gevalideerd met een Zod-schema. Client-side validatie
   is hulp voor de gebruiker, geen beveiliging.
8. Elke pagina is bruikbaar vanaf 375px breed. Interactieve elementen aan de balie
   (zoekveld, scanknop, aantal, bevestigen) hebben een raakvlak van minimaal 44×44px.

---

## 4. Datamodel

Prisma-schema (richtlijn; namen in het Engels voor code, labels in de UI in het
Nederlands).

### Brand (Merk)
| Veld | Type | Opmerking |
|---|---|---|
| id | String @id @default(cuid()) | |
| name | String @unique | bv. Vespa, Piaggio, Kymco, NIU, Super73 |
| createdAt / updatedAt | DateTime | |

### Supplier (Leverancier)
| Veld | Type | Opmerking |
|---|---|---|
| id | String @id @default(cuid()) | |
| name | String | verplicht |
| contactPerson | String? | |
| phone | String? | |
| email | String? | |
| address | String? | meerregelig |
| notes | String? | |
| archivedAt | DateTime? | soft delete |
| createdAt / updatedAt | DateTime | |

### Part (Onderdeel)
| Veld | Type | Opmerking |
|---|---|---|
| id | String @id @default(cuid()) | |
| name | String | verplicht |
| brandId | String? | relatie → Brand, **optioneel**: universele onderdelen (olie, remblokken, kabels, lampjes) horen bij geen enkel merk |
| category | Category | enum, verplicht, zie hieronder |
| sku | String @unique | intern artikelnummer, verplicht |
| barcode | String? @unique | EAN/QR, optioneel, uniek indien gevuld |
| purchasePriceExcl | Decimal(10,2) | inkoopprijs **excl. btw** (facturen zijn excl.) |
| salePriceIncl | Decimal(10,2) | verkoopprijs **incl. btw**; dit is de opgeslagen waarheid |
| vatRate | Decimal(5,2) @default(21) | btw-percentage |
| supplierArticleNumber | String? | artikelnummer van leverancier/fabrikant, doorzoekbaar, gebruikt door de OCR-scan |
| stockQuantity | Int @default(0) | |
| minStock | Int @default(0) | drempel voor lage-voorraadmelding |
| supplierId | String? | relatie → Supplier, optioneel |
| description | String? | |
| fitsModels | String? | vrij tekstveld, bv. "Vespa Primavera 2016-2021, Sprint 125"; doorzoekbaar |
| location | String? | schaplocatie, optioneel |
| archivedAt | DateTime? | soft delete |
| createdAt / updatedAt | DateTime | |

Indexen: `brandId`, `supplierId`, `barcode`, `archivedAt`, `category`.

### Category (enum)
Vast lijstje in v1, geen eigen CRUD:
`SCOOTER_PART`, `MOTOR_PART`, `EBIKE_PART`, `MOBILITY_PART`, `HELMET`, `ACCESSORY`,
`CONSUMABLE` (olie, vet, schoonmaak), `OTHER`. De UI toont Nederlandse labels.

### Sale (Verkoop)
| Veld | Type | Opmerking |
|---|---|---|
| id | String @id @default(cuid()) | |
| partId | String | relatie → Part |
| quantity | Int | > 0 |
| salePriceInclAtSale | Decimal(10,2) | verkoopprijs **incl. btw** per stuk op moment van verkoop |
| purchasePriceExclAtSale | Decimal(10,2) | inkoopprijs **excl. btw** per stuk op moment van verkoop |
| vatRateAtSale | Decimal(5,2) | btw-tarief op moment van verkoop, zodat het incl.-bedrag reconstrueerbaar blijft |
| channel | SaleChannel | `COUNTER` (balie) of `WORKSHOP` (verbruikt in een reparatie) |
| reference | String? | vrije verwijzing naar de werkorder. **Geen persoonsgegevens**: geen klantnaam, geen kenteken (AVG) |
| soldAt | DateTime @default(now()) | |
| note | String? | |

Indexen: `partId`, `soldAt`, `channel`.

Een `Sale` met `channel = WORKSHOP` is geen verkoop over de balie maar voorraadverbruik
in de werkplaats. Het verlaagt de voorraad op dezelfde manier en telt mee in de
bestsellers, maar wordt in rapportages apart uitgesplitst van balieomzet.

### StockMutation (Voorraadmutatie) — v2.0
Grootboek van elke voorraadwijziging.

| Veld | Type | Opmerking |
|---|---|---|
| id | String @id @default(cuid()) | |
| partId | String | relatie → Part, onDelete Restrict |
| delta | Int | verschil, positief of negatief, nooit 0 |
| quantityBefore / quantityAfter | Int | standen vóór en na; `after = before + delta` |
| reason | StockMutationReason | DELIVERY, CORRECTION, COUNT, SALE, WORKSHOP, INITIAL |
| note | String? | vrije toelichting, geen persoonsgegevens |
| saleId | String? | gevuld als de mutatie bij een verkoop hoort |
| createdAt | DateTime | |

**Er wordt geen "wie" vastgelegd.** De applicatie heeft één gedeeld wachtwoord en geen
gebruikersaccounts, dus een persoon is niet vast te stellen. Alleen wanneer, wat en waarom.

**Elke voorraadwijziging schrijft een mutatieregel, in dezelfde transactie als de
wijziging zelf.** Een grootboek met gaten is erger dan geen grootboek: je kunt er niet
mee reconstrueren en het wekt valse zekerheid.

### Afgeleide waarden (niet opslaan, altijd berekenen)
Alle bedragen exclusief btw, tenzij expliciet anders vermeld.

- Verkoopprijs incl. btw (alleen tonen) = `salePrice * (1 + vatRate / 100)`
- Marge per stuk = `salePrice - purchasePrice`
- Margepercentage = `(salePrice - purchasePrice) / salePrice * 100` (0 als salePrice = 0)
- Voorraadwaarde inkoop = `Σ stockQuantity * purchasePrice` over niet-gearchiveerde onderdelen
- Voorraadwaarde verkoop = `Σ stockQuantity * salePrice`
- Omzet periode = `Σ quantity * salePriceAtSale`
- Marge periode = `Σ quantity * (salePriceAtSale - purchasePriceAtSale)`

---

## 5. Functionaliteit

### F1 — Dashboard (`/`)
- Kaarten: totale voorraadwaarde (inkoop én verkoop), aantal unieke onderdelen,
  totaal aantal stuks, aantal onderdelen onder minimumvoorraad.
- Lage-voorraadlijst: onderdelen met `stockQuantity <= minStock` en `minStock > 0`,
  gesorteerd op grootste tekort, met leverancier en directe link naar het onderdeel.
- Bestsellers: top 5 laatste 30 dagen én top 5 all-time, op aantal verkochte stuks.
- Recente verkopen: laatste 10 verkopen met onderdeel, aantal, bedrag, tijdstip.

### F2 — Voorraadoverzicht (`/onderdelen`)
- Tabel met: naam, merk, categorie, sku, inkoopprijs, verkoopprijs (excl. btw, met
  incl.-prijs erbij), marge (€ en %), voorraad, minimumvoorraad, leverancier.
- Zoeken op naam, sku, barcode, leveranciersartikelnummer (`supplierArticleNumber`) en
  pasvorm (`fitsModels`), case-insensitive, substring.
- Filteren op merk, op categorie, op leverancier en op "alleen lage voorraad".
- Onderdelen zonder merk (universeel) zijn vindbaar via een eigen filterwaarde.
- Sorteren op naam, voorraad, marge.
- Groepsweergave per merk als toggle.
- Lage voorraad visueel gemarkeerd.
- Paginering of oneindige lijst vanaf 50 rijen.
- Op mobiel: kaartweergave in plaats van brede tabel.

### F3 — Onderdeel toevoegen/bewerken (`/onderdelen/nieuw`, `/onderdelen/[id]/bewerken`)
- Alle velden uit het datamodel; merk, categorie en leverancier via dropdown. Merk mag
  leeg blijven (universeel onderdeel), categorie is verplicht.
- Btw-tarief per product, standaard 21; de prijs incl. btw wordt live meeberekend.
- Pasvormveld (`fitsModels`) als vrije tekst.
- Barcode: handmatig invoeren óf scannen met de camera.
- Validatie: naam en sku verplicht, prijzen ≥ 0, voorraad en minimumvoorraad ≥ 0,
  sku en barcode uniek (nette foutmelding bij duplicaat).
- Live weergave van de berekende marge tijdens het invullen.
- Archiveren (soft delete) vanaf de bewerkpagina, met bevestiging.

### F4 — Verkoop registreren (`/verkoop`)
Belangrijkste schermen aan de balie, ontworpen voor één hand op een telefoon.
- Onderdeel vinden via zoekveld (naam/sku/barcode) óf via camerascan.
- Scannen werkt in de browser op telefoon/tablet: `BarcodeDetector` waar beschikbaar,
  anders `@zxing/library`. Vereist HTTPS en cameratoestemming; bij weigering of
  ontbrekende camera valt de UI terug op handmatig zoeken met een duidelijke melding.
- Na selectie: onderdeel, huidige voorraad en verkoopprijs (excl. én incl. btw) tonen,
  aantal invoeren (standaard 1, plus/min-knoppen), bevestigen.
- Kanaalkeuze: **balie** (standaard) of **werkplaats**. Bij werkplaats kan een vrije
  werkorderreferentie worden ingevuld; daar horen geen persoonsgegevens in.
- Bij bevestigen: in één transactie voorraad verlagen en `Sale` aanmaken met de
  actuele verkoop- en inkoopprijs, het btw-tarief en het gekozen kanaal.
- Weigeren met melding als aantal > voorraad of onderdeel gearchiveerd is.
- Na succes: bevestiging met nieuwe voorraadstand en direct klaar voor de volgende scan.

### F5 — Leveranciers (`/leveranciers`)
- Overzicht met naam, contactpersoon, telefoon, e-mail en aantal gekoppelde onderdelen.
- Aanmaken, bewerken, archiveren.
- Detailpagina toont de gekoppelde onderdelen.
- Archiveren mag alleen als er geen actieve onderdelen aan hangen; anders melding.

### F6 — Rapportages (`/rapportages`)
- Periodekeuze: 7 / 30 / 90 dagen, dit jaar, of eigen datumbereik.
- Kerncijfers over de periode (excl. btw): omzet, marge, margepercentage, aantal
  verkochte stuks, aantal transacties.
- Uitsplitsing balie versus werkplaats, en filter op categorie.
- Bestsellers over de periode: aantal stuks, omzet en marge per onderdeel.
- Omzet per merk en per categorie over de periode.
- Omzet per dag/week als eenvoudige grafiek of staafjes.
- Export naar CSV van de bestsellerslijst.

### F7 — Beveiliging
- Eén gedeeld wachtwoord uit env var `APP_PASSWORD`. Geen gebruikersaccounts.
- `/login` accepteert het wachtwoord en zet een `httpOnly`, `secure`, `sameSite=lax`
  sessiecookie met een HMAC-ondertekende waarde (`SESSION_SECRET`), geldig 30 dagen.
- Middleware beschermt **alles** behalve `/login`, de login-endpoint en statische
  assets; onbeveiligde toegang redirect naar `/login` met `?next=`-parameter.
- Wachtwoordvergelijking in constante tijd; geen wachtwoord in logs of client bundle.
- Rate limiting: max 10 pogingen per IP per 15 minuten (in-memory volstaat voor v1).
- Uitloggen wist het cookie.

### F8 — Responsive en balie-UX
- Mobile-first. Geen horizontaal scrollen op 375px.
- Verkoopflow is volledig bedienbaar met duimen; scanknop prominent.
- Feedback bij elke actie (laden, succes, fout) — geen stille mislukkingen.

---

## 6. Omgevingsvariabelen

| Naam | Verplicht | Doel |
|---|---|---|
| `DATABASE_URL` | ja | Postgres connectiestring (pooled) |
| `DIRECT_URL` | ja bij Neon | directe connectie voor Prisma migraties |
| `APP_PASSWORD` | ja | gedeeld wachtwoord voor de hele site |
| `SESSION_SECRET` | ja | sleutel voor het ondertekenen van het sessiecookie |

`.env.example` staat in de repo en bevat alleen namen en dummywaarden, nooit echte
geheimen.

---

## 7. Projectstructuur (richtlijn)

```
src/
  app/
    (auth)/login/          login-pagina
    (app)/                 beschermde routes
      page.tsx             dashboard
      onderdelen/
      verkoop/
      leveranciers/
      rapportages/
  components/              herbruikbare UI (incl. BarcodeScanner)
  lib/
    db.ts                  prisma client singleton
    auth.ts                cookie, HMAC, verificatie
    money.ts               formatEuro, marge-helpers
    queries/               datalaag per domein, geeft DTO's terug
    validation/            zod-schemas
prisma/
  schema.prisma
  seed.ts
docs/
  SPEC.md TASKS.md PROGRESS.md
```

---

## 8. Definition of Done (per taak)

Een taak is pas `done` als:
1. alle acceptatiecriteria van die taak aantoonbaar gehaald zijn,
2. `npm run build` en `npx tsc --noEmit` schoon draaien,
3. `npm run lint` geen errors geeft,
4. de aanwezige Vitest-tests slagen,
5. de betreffende schermen bruikbaar zijn op 375px breed,
6. er een notitie in `docs/PROGRESS.md` staat met wat er gebouwd is, welke bestanden
   geraakt zijn, en wat bewust níét gedaan is.

---

## 9. Buiten scope voor v1 (backlog)

Deze punten zijn bewust uitgesteld. Ze worden alleen gebouwd als ze als nieuwe taak in
`docs/TASKS.md` worden opgenomen:

- Verkoop corrigeren/storneren (aanbevolen als eerste uitbreiding na v1).
- Aparte voorraadmutatie-historie (inkomende leveringen, correcties, inventarisatie).
- Meerdere gebruikers, rollen en audit trail.
- Btw-aangifterapportage (het btw-tarief wordt in v1 wel vastgelegd, maar er is geen
  aangifte-overzicht).
- Categorieën zelf beheren (v1 heeft een vast lijstje).
- Echte compatibiliteitsmatrix voor pasvorm (v1 heeft een vrij tekstveld).
- Inkooporders en bestellijsten richting leveranciers.
- Labels/barcodes printen.
- Meerdere locaties of magazijnen.
- Offline gebruik aan de balie.
