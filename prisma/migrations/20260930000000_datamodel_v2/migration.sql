-- Datamodel v2 (taak T17, SPEC §3 regel 0 zoals herschreven in v2.0).
--
-- Deze migratie is MET DE HAND geschreven en mag NIET door `prisma migrate diff`
-- worden vervangen. Prisma ziet een hernoemde kolom namelijk als
-- "DROP COLUMN + ADD COLUMN", en dat gooit alle bestaande prijzen weg. Hier wordt
-- de kolom echt hernoemd (`ALTER TABLE ... RENAME COLUMN`), zodat de waarden
-- behouden blijven en daarna omgerekend kunnen worden.
--
-- Drie wijzigingen in één migratie, in deze volgorde:
--   1. kolommen hernoemen (Part + Sale) en de bijbehorende CHECK-constraints mee
--   2. de verkoopprijzen omrekenen van excl. naar incl. btw
--   3. nieuwe kolom, nieuwe enum en het voorraadgrootboek toevoegen
--
-- De volgorde van 1 en 2 is essentieel: eerst hernoemen, dan omrekenen. Omgekeerd
-- zou de UPDATE nog op de oude kolomnamen moeten staan en zou een halve migratie
-- twee keer kunnen omrekenen.

-- ---------------------------------------------------------------------------
-- 1. Hernoemen (geen data-verlies)
-- ---------------------------------------------------------------------------

-- Part: verkoopprijs krijgt een nieuwe BETEKENIS (voortaan incl. btw), de
-- inkoopprijs alleen een expliciete naam (blijft excl. btw).
ALTER TABLE "Part" RENAME COLUMN "salePrice" TO "salePriceIncl";
ALTER TABLE "Part" RENAME COLUMN "purchasePrice" TO "purchasePriceExcl";

-- Sale: dezelfde hernoeming op de historische prijzen. `vatRateAtSale` blijft.
ALTER TABLE "Sale" RENAME COLUMN "salePriceAtSale" TO "salePriceInclAtSale";
ALTER TABLE "Sale" RENAME COLUMN "purchasePriceAtSale" TO "purchasePriceExclAtSale";

-- Postgres past de expressie van een CHECK-constraint automatisch aan bij een
-- kolomhernoeming, maar niet de NAAM van de constraint. Die wordt hier meegenomen,
-- zodat een foutmelding uit de database naar de juiste kolom blijft verwijzen.
ALTER TABLE "Part" RENAME CONSTRAINT "Part_purchasePrice_not_negative" TO "Part_purchasePriceExcl_not_negative";
ALTER TABLE "Part" RENAME CONSTRAINT "Part_salePrice_not_negative" TO "Part_salePriceIncl_not_negative";

-- ---------------------------------------------------------------------------
-- 2. Waarden omrekenen: excl. btw -> incl. btw
-- ---------------------------------------------------------------------------

-- De bestaande waarden in "salePriceIncl" zijn nog de OUDE excl.-bedragen.
-- `vatRate` staat in procenten (21.00), niet als fractie.
-- ROUND(..., 2) is expliciet, ook al rondt de kolom (numeric(10,2)) zelf al af:
-- zo staat in de migratie zwart-op-wit op hoeveel decimalen wordt afgerond.
UPDATE "Part"
   SET "salePriceIncl" = ROUND("salePriceIncl" * (1 + "vatRate" / 100), 2);

-- Idem op de verkoophistorie, met het btw-tarief zoals het op dat moment gold.
-- Dat tarief kan per regel afwijken van het huidige tarief van het onderdeel; met
-- `vatRate` omrekenen zou de historie vervalsen.
UPDATE "Sale"
   SET "salePriceInclAtSale" = ROUND("salePriceInclAtSale" * (1 + "vatRateAtSale" / 100), 2);

-- De inkoopprijzen blijven ongemoeid: die waren en blijven exclusief btw.

-- ---------------------------------------------------------------------------
-- 3. Nieuwe kolom, enum en het voorraadgrootboek
-- ---------------------------------------------------------------------------

-- Artikelnummer van de leverancier/fabrikant (T20 matcht hierop bij het scannen).
-- Nullable en zonder default: bestaande onderdelen hebben het nog niet.
ALTER TABLE "Part" ADD COLUMN "supplierArticleNumber" TEXT;

-- CreateIndex
CREATE INDEX "Part_supplierArticleNumber_idx" ON "Part"("supplierArticleNumber");

-- CreateEnum
CREATE TYPE "StockMutationReason" AS ENUM ('DELIVERY', 'CORRECTION', 'COUNT', 'SALE', 'WORKSHOP', 'INITIAL');

-- CreateTable
CREATE TABLE "StockMutation" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "quantityBefore" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,
    "reason" "StockMutationReason" NOT NULL,
    "note" TEXT,
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMutation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMutation_partId_idx" ON "StockMutation"("partId");

-- CreateIndex
CREATE INDEX "StockMutation_createdAt_idx" ON "StockMutation"("createdAt");

-- CreateIndex
CREATE INDEX "StockMutation_reason_idx" ON "StockMutation"("reason");

-- AddForeignKey
ALTER TABLE "StockMutation" ADD CONSTRAINT "StockMutation_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Verdediging in de diepte, in dezelfde geest als de CHECK-constraints uit de
-- init-migratie: een mutatieregel moet intern consistent zijn en iets veranderen.
ALTER TABLE "StockMutation" ADD CONSTRAINT "StockMutation_delta_not_zero" CHECK ("delta" <> 0);

ALTER TABLE "StockMutation" ADD CONSTRAINT "StockMutation_quantities_consistent" CHECK ("quantityAfter" = "quantityBefore" + "delta");

-- Negatieve voorraad is niet toegestaan (SPEC §3 regel 6), dus ook niet in het
-- grootboek.
ALTER TABLE "StockMutation" ADD CONSTRAINT "StockMutation_quantityBefore_not_negative" CHECK ("quantityBefore" >= 0);

ALTER TABLE "StockMutation" ADD CONSTRAINT "StockMutation_quantityAfter_not_negative" CHECK ("quantityAfter" >= 0);
