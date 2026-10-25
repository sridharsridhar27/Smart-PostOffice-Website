-- CreateEnum
CREATE TYPE "AssignmentMethod" AS ENUM ('AI_AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Parcel" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedToId" INTEGER,
ADD COLUMN     "unassignedReason" TEXT;

-- CreateTable
CREATE TABLE "Assignment" (
    "id" SERIAL NOT NULL,
    "parcelId" INTEGER NOT NULL,
    "deliveryPersonId" INTEGER NOT NULL,
    "slotDate" DATE NOT NULL,
    "slotHour" INTEGER NOT NULL,
    "method" "AssignmentMethod" NOT NULL DEFAULT 'AI_AUTO',
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "score" INTEGER,
    "scoreBreakdown" JSONB,
    "reason" TEXT NOT NULL,
    "candidatesEvaluated" INTEGER,
    "assignedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Assignment_parcelId_idx" ON "Assignment"("parcelId");

-- CreateIndex
CREATE INDEX "Assignment_deliveryPersonId_slotDate_idx" ON "Assignment"("deliveryPersonId", "slotDate");

-- CreateIndex
CREATE INDEX "Parcel_assignedToId_slotDate_idx" ON "Parcel"("assignedToId", "slotDate");

-- AddForeignKey
ALTER TABLE "Parcel" ADD CONSTRAINT "Parcel_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_deliveryPersonId_fkey" FOREIGN KEY ("deliveryPersonId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
