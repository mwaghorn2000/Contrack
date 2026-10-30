-- AlterTable
ALTER TABLE "JobTile" ADD COLUMN     "requiresAcknowledgment" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "JobTileAcknowledgment" (
    "tileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobTileAcknowledgment_pkey" PRIMARY KEY ("tileId","userId")
);

-- CreateIndex
CREATE INDEX "JobTileAcknowledgment_userId_idx" ON "JobTileAcknowledgment"("userId");

-- AddForeignKey
ALTER TABLE "JobTileAcknowledgment" ADD CONSTRAINT "JobTileAcknowledgment_tileId_fkey" FOREIGN KEY ("tileId") REFERENCES "JobTile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTileAcknowledgment" ADD CONSTRAINT "JobTileAcknowledgment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
