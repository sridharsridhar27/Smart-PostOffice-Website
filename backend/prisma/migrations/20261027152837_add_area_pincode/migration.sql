-- 1. Add the column as optional first (existing areas have no pincode yet)
ALTER TABLE "Area" ADD COLUMN "pincode" TEXT;

-- 2. Fill pincodes for the 3 areas
UPDATE "Area" SET "pincode" = '635601' WHERE "name" = 'Area A';
UPDATE "Area" SET "pincode" = '635602' WHERE "name" = 'Area B';
UPDATE "Area" SET "pincode" = '635603' WHERE "name" = 'Area C';

-- 3. Any other area created during testing gets a temporary unique pincode
UPDATE "Area" SET "pincode" = (600000 + "id")::text WHERE "pincode" IS NULL;

-- 4. Now make it required and unique
ALTER TABLE "Area" ALTER COLUMN "pincode" SET NOT NULL;
CREATE UNIQUE INDEX "Area_pincode_key" ON "Area"("pincode");

-- 5. Database-level rule: exactly 6 digits, not starting with 0 (Indian pincode format)
ALTER TABLE "Area" ADD CONSTRAINT "Area_pincode_format" CHECK ("pincode" ~ '^[1-9][0-9]{5}$');