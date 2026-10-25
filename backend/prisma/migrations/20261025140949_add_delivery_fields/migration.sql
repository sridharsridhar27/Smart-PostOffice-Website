-- CreateEnum
CREATE TYPE "FailureReason" AS ENUM ('CUSTOMER_NOT_AVAILABLE', 'WRONG_ADDRESS', 'CUSTOMER_REFUSED', 'PREMISES_LOCKED', 'OTHER');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RESCHEDULED';

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "failureNote" TEXT,
ADD COLUMN     "failureReason" "FailureReason";

-- AlterTable
ALTER TABLE "Parcel" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "failedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastFailedAt" TIMESTAMP(3),
ADD COLUMN     "lastFailureNote" TEXT,
ADD COLUMN     "lastFailureReason" "FailureReason",
ADD COLUMN     "outForDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "receivedBy" TEXT;
