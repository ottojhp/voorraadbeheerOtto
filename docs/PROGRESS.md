# PROGRESS — bouwlogboek

De bouwsessie schrijft hier na **elke** afgeronde taak een notitie. De
projectmanager-sessie leest deze notitie samen met de diff en keurt de taak goed of af
in `docs/TASKS.md`.

Nieuwste notitie bovenaan.

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
