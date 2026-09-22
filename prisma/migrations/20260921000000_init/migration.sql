-- CreateEnum
CREATE TYPE "Category" AS ENUM ('SCOOTER_PART', 'MOTOR_PART', 'EBIKE_PART', 'MOBILITY_PART', 'HELMET', 'ACCESSORY', 'CONSUMABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "SaleChannel" AS ENUM ('COUNTER', 'WORKSHOP');

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Part" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandId" TEXT,
    "category" "Category" NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "purchasePrice" DECIMAL(10,2) NOT NULL,
    "salePrice" DECIMAL(10,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER NOT NULL DEFAULT 0,
    "supplierId" TEXT,
    "description" TEXT,
    "fitsModels" TEXT,
    "location" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "salePriceAtSale" DECIMAL(10,2) NOT NULL,
    "purchasePriceAtSale" DECIMAL(10,2) NOT NULL,
    "vatRateAtSale" DECIMAL(5,2) NOT NULL,
    "channel" "SaleChannel" NOT NULL,
    "reference" TEXT,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE INDEX "Supplier_archivedAt_idx" ON "Supplier"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Part_sku_key" ON "Part"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Part_barcode_key" ON "Part"("barcode");

-- CreateIndex
CREATE INDEX "Part_brandId_idx" ON "Part"("brandId");

-- CreateIndex
CREATE INDEX "Part_supplierId_idx" ON "Part"("supplierId");

-- CreateIndex
CREATE INDEX "Part_archivedAt_idx" ON "Part"("archivedAt");

-- CreateIndex
CREATE INDEX "Part_category_idx" ON "Part"("category");

-- CreateIndex
CREATE INDEX "Sale_partId_idx" ON "Sale"("partId");

-- CreateIndex
CREATE INDEX "Sale_soldAt_idx" ON "Sale"("soldAt");

-- CreateIndex
CREATE INDEX "Sale_channel_idx" ON "Sale"("channel");

-- AddForeignKey
ALTER TABLE "Part" ADD CONSTRAINT "Part_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Part" ADD CONSTRAINT "Part_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Verdediging in de diepte naast de Zod-validatie (SPEC §3 regels 6 en 7): de
-- applicatielaag valideert al, maar de database moet ongeldige toestanden ook
-- weigeren als er ooit buiten de applicatie om geschreven wordt (bv. een script,
-- een handmatige query of een toekomstige bugfix die de Zod-check mist).
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_quantity_positive" CHECK ("quantity" > 0);

-- Negatieve voorraad is niet toegestaan (SPEC §3 regel 6).
ALTER TABLE "Part" ADD CONSTRAINT "Part_stockQuantity_not_negative" CHECK ("stockQuantity" >= 0);

ALTER TABLE "Part" ADD CONSTRAINT "Part_purchasePrice_not_negative" CHECK ("purchasePrice" >= 0);

ALTER TABLE "Part" ADD CONSTRAINT "Part_salePrice_not_negative" CHECK ("salePrice" >= 0);

ALTER TABLE "Part" ADD CONSTRAINT "Part_vatRate_not_negative" CHECK ("vatRate" >= 0);
