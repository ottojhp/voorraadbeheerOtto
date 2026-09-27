# Voorraadbeheer scooter-/motoronderdelen

## Lokale toolchain (belangrijk)

De systeem-Node op deze machine is v16.14.2 en kan Next.js 15 niet draaien. Er staat een
losse Node 22 in de scratchpad. Zet die vooraan in PATH bij **elk** npm/npx/node-commando:

```
export PATH="/private/tmp/claude-501/-Users-otto-Documents-GitHub-Eerste-test/a943ea32-7688-4b3d-8af6-a8f70bc6f2a2/scratchpad/node-v22.23.2-darwin-arm64/bin:$PATH"
```

Zonder die regel faalt de build met een onduidelijke foutmelding.

Er is geen systeem-Postgres en geen Docker. In plaats daarvan draait een draagbare
PostgreSQL 16.4 uit dezelfde scratchpad op poort **5433**; `.env` wijst er al naar.
Starten (als hij niet luistert op 5433):

```
SP="/private/tmp/claude-501/-Users-otto-Documents-GitHub-Eerste-test/a943ea32-7688-4b3d-8af6-a8f70bc6f2a2/scratchpad"
"$SP/pg/dist/bin/pg_ctl" -D "$SP/pgdata" \
  -o "-p 5433 -c unix_socket_directories= -c listen_addresses=127.0.0.1" \
  -l "$SP/pg.log" start
```

**De scratchpad is tijdelijk.** Node 22, de Postgres-binaries en de database worden
opgeruimd. Zijn ze weg, dan moeten Node en Postgres opnieuw gedownload worden, gevolgd
door `npx prisma migrate deploy` en `npm run db:seed`. Voor iets blijvends hoort hier een
externe `DATABASE_URL` (Neon of Vercel Postgres).

## Verifiëren: een groene build is niet genoeg

Tijdens de bouw zijn twee bugs pas bij echt gebruik gevonden, terwijl `tsc`, ESLint, alle
tests én `next build` groen waren. Haal daarom elke pagina die je raakt ook echt op. De
app zit achter een login; maak een sessiecookie met de eigen `createSessionValue()` uit
`src/lib/auth.ts` (typ nergens een wachtwoord in een formulier) en doe:

```
curl -s -o /dev/null -w "%{http_code}\n" --cookie "vb_session=<waarde>" http://localhost:3111/onderdelen
```

Let in het bijzonder op de client/server-scheiding: een bestand met `"use client"` mag
alleen componenten en types exporteren. Exporteert het ook gewone functies en roept een
server component die aan, dan crasht de pagina bij élk bezoek zonder dat de build of de
tests iets merken.

## Rolverdeling
- `docs/SPEC.md` en `docs/TASKS.md` worden beheerd door de projectmanager-sessie.
  Wijzig de spec of de taakomschrijvingen niet zelf.
- Deze bouwsessie implementeert taken uit `docs/TASKS.md`, van boven naar beneden.

## Werkwijze per taak
1. Pak de bovenste taak met status `todo` waarvan alle afhankelijkheden `done` zijn.
2. Zet de status op `in-progress`.
3. Bouw uitsluitend wat in de acceptatiecriteria van die taak staat.
4. Nieuwe wensen of gesignaleerde problemen buiten de taak: noteer ze onder
   **Nieuwe wensen / observaties** in `docs/TASKS.md`. Bouw ze niet.
5. Schrijf een notitie in `docs/PROGRESS.md` volgens het sjabloon daar.
6. Zet de status op `review` en stop. De projectmanager keurt goed of af.

## Definition of Done
Zie `docs/SPEC.md` §8. Kort: acceptatiecriteria gehaald, `npm run build`,
`npx tsc --noEmit`, `npm run lint` en `npm run test` schoon, bruikbaar op 375px breed,
notitie in PROGRESS.md.

## Architectuurregels
Bindend, zie `docs/SPEC.md` §3. Belangrijkste: geld als `Decimal(10,2)` in de database
en als `number` in DTO's, nooit `Decimal` naar client components; verkoop en
voorraadmutatie in één transactie; geen negatieve voorraad; soft delete via
`archivedAt`; alle server-side invoer via Zod.

## Delegeren (houd het goedkoop)
- "Waar staat X?" → subagent `zoeker`
- Build of tests draaien → subagent `test-runner`
- Statusvelden en notities in docs bijwerken → subagent `doc-updater`
