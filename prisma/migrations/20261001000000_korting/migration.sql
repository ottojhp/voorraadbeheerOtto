-- Korting bij verkoop (taak T26, SPEC §3 regel 0 en regel 3).
--
-- Deze migratie is MET DE HAND geschreven en mag NIET door `prisma migrate diff`
-- worden vervangen. De betekenis van een bestaande kolom verandert namelijk:
-- `Sale."salePriceInclAtSale"` was "de prijs van het onderdeel op het moment van
-- verkoop" en is vanaf nu "de prijs die de klant WERKELIJK betaald heeft". De normale
-- prijs komt in de nieuwe kolom `listPriceInclAtSale`. `migrate diff` ziet daar niets
-- van en zou de nieuwe kolom met een default of met NULL aanleggen; dan zou van elke
-- bestaande verkoop de normale prijs onbekend zijn en leek elke verkoop uit het
-- verleden een korting van 100% te hebben gehad.
--
-- Bestaande verkopen hadden geen korting: er was simpelweg geen manier om een andere
-- prijs te registreren dan die van het onderdeel. `listPriceInclAtSale` wordt daarom
-- gevuld met de waarde van `salePriceInclAtSale`, waardoor de korting van elke
-- bestaande rij per definitie 0 is en geen enkel bestaand bedrag verandert.
--
-- Drie stappen, in deze volgorde:
--   1. de kolom NULLABLE toevoegen (een NOT NULL zonder default zou op een gevulde
--      tabel meteen afketsen, en een default zou een verzonnen prijs achterlaten);
--   2. de bestaande rijen vullen uit `salePriceInclAtSale`;
--   3. de kolom op NOT NULL zetten, zodat er vanaf nu geen verkoop zonder normale
--      prijs meer bij kan komen.

-- ---------------------------------------------------------------------------
-- 1. Nieuwe kolommen
-- ---------------------------------------------------------------------------

-- De NORMALE prijs per stuk incl. btw op het moment van verkoop. Nog nullable; stap 3
-- maakt hem verplicht.
ALTER TABLE "Sale" ADD COLUMN "listPriceInclAtSale" DECIMAL(10,2);

-- Vrije toelichting bij de korting ("beschadigde doos", "actie remblokken").
-- GEEN persoonsgegevens (AVG), net als `Sale."reference"`; dat wordt bij het veld in
-- het verkoopscherm gewaarschuwd.
ALTER TABLE "Sale" ADD COLUMN "discountReason" TEXT;

-- ---------------------------------------------------------------------------
-- 2. Bestaande rijen vullen: normale prijs = betaalde prijs, dus korting 0
-- ---------------------------------------------------------------------------

UPDATE "Sale"
   SET "listPriceInclAtSale" = "salePriceInclAtSale"
 WHERE "listPriceInclAtSale" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Kolom verplicht maken
-- ---------------------------------------------------------------------------

ALTER TABLE "Sale" ALTER COLUMN "listPriceInclAtSale" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Verdediging in de diepte
-- ---------------------------------------------------------------------------

-- Een verkoop van € 0,00 moet kunnen (weggeven), een negatief bedrag niet: dat zou
-- geen korting maar een uitbetaling zijn. Zelfde geest als de CHECK-constraints op
-- `Part` uit de init-migratie; de Zod-validatie is de eerste lijn, dit de laatste.
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_salePriceInclAtSale_not_negative" CHECK ("salePriceInclAtSale" >= 0);

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_listPriceInclAtSale_not_negative" CHECK ("listPriceInclAtSale" >= 0);

-- Er komt BEWUST geen CHECK die `salePriceInclAtSale <= listPriceInclAtSale` eist.
-- Een prijs boven de normale prijs is geen fout maar een uitzondering (een
-- spoedtoeslag, een verkeerd ingetypt bedrag dat de balie bewust laat staan); de
-- acceptatiecriteria vragen om een duidelijke WAARSCHUWING, geen blokkade. Een
-- constraint hier zou de verkoop weigeren met een databasefout in plaats van de
-- baliemedewerker te laten beslissen.
