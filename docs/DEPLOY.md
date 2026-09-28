# Online zetten: Vercel + Neon

Doel: de applicatie bereikbaar vanaf telefoon, tablet en laptop, met een database die
blijft bestaan. Camerascan werkt alleen via HTTPS, en dat krijg je hiermee automatisch.

Rolverdeling: de stappen onder **JIJ** vereisen een account of een wachtwoord en moet je
zelf doen. De rest doe ik.

---

## Stap 1 — JIJ: database aanmaken bij Neon

1. Ga naar https://neon.tech en maak een gratis account.
2. Maak een project aan, regio **Europe (Frankfurt)** — dat is het dichtst bij Amsterdam
   en scheelt merkbaar in snelheid aan de balie.
3. Neon toont twee connectiestrings. Je hebt ze allebei nodig:
   - de **pooled** string (bevat `-pooler` in de hostnaam) → wordt `DATABASE_URL`
   - de **direct** string (zonder `-pooler`) → wordt `DIRECT_URL`

**Zet die strings niet in de chat.** Het zijn wachtwoorden. Maak in plaats daarvan een
bestand `.env.neon` in de projectmap (die staat in `.gitignore`, dus hij komt nooit in
git terecht):

```
DATABASE_URL="postgresql://...-pooler.../neondb?sslmode=require"
DIRECT_URL="postgresql://.../neondb?sslmode=require"
```

Zeg daarna dat het bestand klaarstaat. Ik draai dan de migratie en vul de database.

## Stap 2 — IK: database inrichten

Ik draai tegen Neon:
- `prisma migrate deploy` — tabellen, indexen en de CHECK-constraints.
- `npm run db:seed` — alleen als je met testdata wilt beginnen. Wil je leeg beginnen en
  je echte voorraad zelf invoeren, dan sla ik dit over. Zeg even wat je wilt.

Daarna controleer ik of de tabellen kloppen.

## Stap 3 — JIJ: GitHub-repository

De code staat nu alleen op deze Mac. Vercel deployt vanuit GitHub.

1. Maak op https://github.com/new een **lege, private** repository, bijvoorbeeld
   `voorraadbeheer`. Vink GEEN README, .gitignore of licentie aan.
2. Geef me de URL.

Ik koppel de repo en probeer te pushen. Let op: je SSH-sleutel wordt op dit moment door
GitHub geweigerd (`Permission denied (publickey)`), dus waarschijnlijk staat hij daar nog
niet. Twee oplossingen, kies er één:
- Voeg je publieke sleutel toe op https://github.com/settings/keys — de inhoud staat in
  `~/.ssh/Otto's key.pub`.
- Of push zelf één keer over HTTPS; daarna onthoudt je sleutelhanger het.

## Stap 4 — JIJ: Vercel koppelen

1. Ga naar https://vercel.com, log in **met je GitHub-account**.
2. "Add New… → Project", kies de repository, en klik Import.
3. Framework wordt automatisch herkend als Next.js. Het build-commando in
   `package.json` regelt de migraties al:
   `prisma generate && prisma migrate deploy && next build`
4. Zet onder **Environment Variables** deze vier, voor Production én Preview:

   | Naam | Waarde |
   |---|---|
   | `DATABASE_URL` | de pooled string van Neon |
   | `DIRECT_URL` | de direct string van Neon |
   | `APP_PASSWORD` | het wachtwoord waarmee jij en je personeel inloggen |
   | `SESSION_SECRET` | genereer met `openssl rand -base64 32` |

   Kies voor `APP_PASSWORD` iets fatsoenlijks. De site staat publiek op internet en dit
   ene wachtwoord is de enige beveiliging. Gebruik NIET `dev-wachtwoord`.
5. Klik Deploy.

## Stap 5 — IK: controleren

Ik loop na de deploy langs alle schermen op de live URL en controleer of de pagina's
laden, of de cijfers kloppen met de database, en of het werkt op telefoonformaat.

---

## Daarna

- **Op je telefoon:** open de URL, log in, en zet hem op je beginscherm (Safari: Deel →
  Zet op beginscherm). Hij opent dan als een app.
- **Camerascan** werkt zodra de site via https draait. De eerste keer vraagt je telefoon
  toestemming voor de camera.
- **Wachtwoord wijzigen:** pas `APP_PASSWORD` aan in Vercel en deploy opnieuw. Let op:
  bestaande sessies blijven geldig. Wil je iedereen uitloggen, wijzig dan ook
  `SESSION_SECRET`.
- **Nieuwe versie uitrollen:** elke push naar `main` deployt automatisch.

## Kosten

Neon en Vercel hebben allebei een gratis niveau dat ruim voldoende is voor één winkel.
Let alleen op dat een Neon-database op het gratis plan in slaap valt bij inactiviteit; het
eerste verzoek daarna duurt een seconde langer.
