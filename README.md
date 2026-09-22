# Voorraadbeheer scooter- & motoronderdelen

Webapplicatie voor een tweewielerzaak om de voorraad van scooter-, motor-, e-bike- en
scootmobielonderdelen te beheren. De app registreert wat er op voorraad ligt, wat er
verkocht wordt aan de balie, wat er verbruikt wordt in de werkplaats bij reparaties, en
wie de leveranciers zijn. Een dashboard en rapportages laten zien wat de voorraad waard
is, wat er bijbesteld moet worden en wat het best verkoopt.

Zie [`docs/SPEC.md`](docs/SPEC.md) voor de volledige specificatie,
[`docs/TASKS.md`](docs/TASKS.md) voor de taakverdeling waarmee dit project is gebouwd, en
[`docs/PROGRESS.md`](docs/PROGRESS.md) voor het bouwlogboek per taak.

Stack: Next.js (App Router) + TypeScript (`strict`) + Tailwind CSS + Prisma/Postgres +
Zod + Vitest. Zie SPEC §2 voor de volledige, vastgelegde tech stack.

## Vereisten

- **Node.js 18.18 of hoger**
- Een **Postgres-database** — bijvoorbeeld [Neon](https://neon.tech) (gratis tier
  volstaat) of Vercel Postgres. Lokaal een eigen Postgres-server draaien kan ook.

## Lokaal opstarten

```bash
npm install
cp .env.example .env
# vul .env in, zie "Omgevingsvariabelen" hieronder
npx prisma migrate deploy      # of: npm run db:migrate (development, met prompts)
npm run db:seed                # laadt voorbeelddata (merken, leveranciers, onderdelen)
npm run dev
```

De app draait dan op <http://localhost:3000>. Log in met het wachtwoord uit
`APP_PASSWORD`.

## Omgevingsvariabelen

Zie ook [`.env.example`](.env.example) en SPEC §6. Alle vier zijn verplicht; commit nooit
echte waarden, alleen `.env.example` met dummy's staat in git.

| Naam | Doel |
|---|---|
| `DATABASE_URL` | Postgres-connectiestring die de applicatie gebruikt (bij Neon: de **pooled** connectie). |
| `DIRECT_URL` | Directe, niet-pooled connectie die Prisma gebruikt om migraties toe te passen (nodig bij Neon/Vercel Postgres; zonder pooling loopt een migratie niet vast). |
| `APP_PASSWORD` | Het ene gedeelde wachtwoord waarmee iedereen inlogt op de site (er zijn geen individuele accounts, zie "Bekende beperkingen"). |
| `SESSION_SECRET` | Geheime sleutel waarmee het sessiecookie ondertekend wordt. Genereer een goede waarde met bijvoorbeeld: `openssl rand -base64 32` |

### Het gedeelde wachtwoord wijzigen

Pas `APP_PASSWORD` aan in de omgevingsvariabelen (lokaal in `.env`, op Vercel in de
projectinstellingen) en deploy opnieuw. **Let op:** dit maakt bestaande, al ingelogde
sessies niet ongeldig — wie al een geldig sessiecookie heeft blijft ingelogd. Om alle
sessies direct te verbreken (bijvoorbeeld omdat iemand uit dienst gaat) moet je ook
`SESSION_SECRET` wijzigen; daarmee worden alle bestaande sessiecookies in één keer
ongeldig.

## Deployen naar Vercel

1. Koppel de GitHub-repository aan een nieuw Vercel-project.
2. Zet de vier omgevingsvariabelen uit de tabel hierboven bij het project (Settings →
   Environment Variables). Gebruik bij Neon de pooled connectiestring voor
   `DATABASE_URL` en de directe (niet-pooled) connectiestring voor `DIRECT_URL`.
3. Deploy. De build (`npm run build`) draait automatisch `prisma generate`,
   `prisma migrate deploy` en `next build` — openstaande migraties worden dus bij elke
   deploy op de database toegepast voordat de nieuwe build live gaat.
4. Eenmalig, na de eerste deploy: laad de seed-data in als dat gewenst is
   (`npm run db:seed` lokaal tegen de productiedatabase, of handmatig via Prisma
   Studio).

### Camerascan en HTTPS

Het scannen van barcodes met de camera gebruikt browser-API's die alleen werken in een
*secure context*. Op Vercel is elke deploy standaard HTTPS, dus daar werkt de
camerascan gewoon. Lokaal werkt `http://localhost:3000` ook, omdat browsers `localhost`
zelf als veilig beschouwen. Maar zodra je de app op een tablet of telefoon benadert via
het IP-adres van je laptop in het lokale netwerk (bijvoorbeeld
`http://192.168.1.20:3000`), is dat **geen** secure context en weigert de browser de
camera. De app herkent dit en toont dan een nette melding in plaats van een kapotte
scanknop; de barcode moet in dat geval handmatig ingevoerd worden.

## Schermen

| Scherm | Waar het voor is |
|---|---|
| Login | Eén gedeeld wachtwoord (`APP_PASSWORD`) voor de hele site. |
| Dashboard | Overzicht van voorraadwaarde, lage voorraad en recente verkopen. |
| Onderdelen | Zoeken, filteren op categorie/merk/leverancier, onderdeel aanmaken en bewerken, barcode scannen. |
| Onderdeeldetail | Voorraad, prijzen (excl./incl. btw), pasvorm (`fitsModels`), leverancier en verkoopgeschiedenis van één onderdeel. |
| Verkoop/verbruik registreren | Balieverkoop of werkplaatsverbruik boeken; beide verlagen de voorraad. |
| Leveranciers | Leveranciers beheren en archiveren. |
| Rapportages | Marge, bestsellers en besteladvies over een gekozen periode. |

## Belangrijke werkafspraken (vastgelegd in de code)

- **Alle prijzen worden exclusief btw opgeslagen**, met een btw-tarief (`vatRate`) per
  onderdeel. De verkoopprijs incl. btw voor aan de balie wordt hiervan afgeleid.
- **Verkoop (balie) en werkplaatsverbruik gaan allebei van dezelfde voorraad af**
  (`Sale.channel`: `COUNTER` of `WORKSHOP`), maar worden in rapportages apart
  uitgesplitst.
- **Onderdelen en leveranciers worden gearchiveerd, nooit verwijderd** (`archivedAt`),
  zodat oude verkopen en rapportages historisch correct blijven kloppen ook als een
  onderdeel of leverancier niet meer actief is.

## Belangrijkste commando's

| Commando | Doel |
|---|---|
| `npm run dev` | Ontwikkelserver starten |
| `npm run build` | Productiebuild: `prisma generate` + `prisma migrate deploy` + `next build` |
| `npm run start` | Productiebuild draaien |
| `npm run lint` | ESLint |
| `npm run format` | Prettier (schrijft bestanden) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest in watch-modus |
| `npm run test:run` | Vitest eenmalig |
| `npm run db:migrate` | Prisma-migratie aanmaken/toepassen (development) |
| `npm run db:deploy` | Prisma-migraties toepassen zonder nieuwe te genereren (productie) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:seed` | Seed-data inladen (`prisma/seed.ts`) |

## Bekende beperkingen

- **Rate limiting op de login is in-memory.** Dit werkt prima op één lang draaiend
  proces, maar is niet waterdicht op Vercel's serverless functies: elke nieuwe
  functie-instance begint met een lege teller, dus een aanvaller die over meerdere
  instances verspreid inlogt kan de limiet omzeilen.
- **Een verkoop of werkplaatsverbruik terugdraaien kan niet via de UI in v1.** Een
  mistap aan de balie moet nu rechtstreeks in de database gecorrigeerd worden (zie ook
  de backlog in `docs/SPEC.md` §9 en de notitie in `docs/TASKS.md`).
- **Geen individuele gebruikersaccounts.** Iedereen deelt hetzelfde `APP_PASSWORD`; er
  is geen manier om te zien wie een specifieke actie heeft uitgevoerd.
