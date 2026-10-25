-- AlterTable
ALTER TABLE "Parcel" ADD COLUMN     "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "slotAutoBooked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slotBookedAt" TIMESTAMP(3),
ADD COLUMN     "slotDate" DATE,
ADD COLUMN     "slotHour" INTEGER;

-- CreateIndex
CREATE INDEX "Parcel_slotDate_slotHour_idx" ON "Parcel"("slotDate", "slotHour");
