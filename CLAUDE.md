# Voorraadbeheer scooter-/motoronderdelen

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
