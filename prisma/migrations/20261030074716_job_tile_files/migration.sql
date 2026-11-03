-- CreateTable
CREATE TABLE "JobTileFile" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobTileFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobTileFile_key_key" ON "JobTileFile"("key");

-- CreateIndex
CREATE INDEX "JobTileFile_answerId_idx" ON "JobTileFile"("answerId");

-- AddForeignKey
ALTER TABLE "JobTileFile" ADD CONSTRAINT "JobTileFile_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "JobTileAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
