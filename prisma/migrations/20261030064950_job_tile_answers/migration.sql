-- AlterTable
ALTER TABLE "JobTile" ADD COLUMN     "removedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "JobTileAnswer" (
    "id" TEXT NOT NULL,
    "tileId" TEXT NOT NULL,
    "authorId" TEXT,
    "data" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobTileAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobTileAnswer_tileId_createdAt_idx" ON "JobTileAnswer"("tileId", "createdAt");

-- CreateIndex
CREATE INDEX "JobTileAnswer_authorId_idx" ON "JobTileAnswer"("authorId");

-- AddForeignKey
ALTER TABLE "JobTileAnswer" ADD CONSTRAINT "JobTileAnswer_tileId_fkey" FOREIGN KEY ("tileId") REFERENCES "JobTile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTileAnswer" ADD CONSTRAINT "JobTileAnswer_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
