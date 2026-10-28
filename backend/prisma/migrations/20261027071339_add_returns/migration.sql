-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "ReturnToSenderReason" AS ENUM ('NOT_COLLECTED', 'CUSTOMER_REFUSED', 'ADMIN_DECISION', 'CUSTOMER_RETURN');

-- CreateEnum
CREATE TYPE "CustomerReturnReason" AS ENUM ('DAMAGED', 'WRONG_ITEM', 'NOT_NEEDED', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'RETURN_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'PICKUP_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'RETURNED_TO_SENDER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ParcelStatus" ADD VALUE 'RETURN_REQUESTED';
ALTER TYPE "ParcelStatus" ADD VALUE 'PICKUP_ASSIGNED';
ALTER TYPE "ParcelStatus" ADD VALUE 'OUT_FOR_PICKUP';
ALTER TYPE "ParcelStatus" ADD VALUE 'PICKUP_FAILED';
ALTER TYPE "ParcelStatus" ADD VALUE 'RETURNED_TO_SENDER';

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "jobType" "JobType" NOT NULL DEFAULT 'DELIVERY';

-- AlterTable
ALTER TABLE "Parcel" ADD COLUMN     "collectedAtCounter" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "collectionDeadline" TIMESTAMP(3),
ADD COLUMN     "customerReturnNote" TEXT,
ADD COLUMN     "customerReturnReason" "CustomerReturnReason",
ADD COLUMN     "pickupFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnCancelledAt" TIMESTAMP(3),
ADD COLUMN     "returnNote" TEXT,
ADD COLUMN     "returnReason" "ReturnToSenderReason",
ADD COLUMN     "returnRequestedAt" TIMESTAMP(3),
ADD COLUMN     "returnedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Parcel_status_collectionDeadline_idx" ON "Parcel"("status", "collectionDeadline");
