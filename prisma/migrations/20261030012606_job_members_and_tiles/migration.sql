-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "photo" TEXT;

-- CreateTable
CREATE TABLE "JobMember" (
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "JobMember_pkey" PRIMARY KEY ("jobId","userId")
);

-- CreateTable
CREATE TABLE "JobTile" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "visibility" JSONB NOT NULL,

    CONSTRAINT "JobTile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobMember_userId_idx" ON "JobMember"("userId");

-- CreateIndex
CREATE INDEX "JobTile_jobId_position_idx" ON "JobTile"("jobId", "position");

-- AddForeignKey
ALTER TABLE "JobMember" ADD CONSTRAINT "JobMember_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMember" ADD CONSTRAINT "JobMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTile" ADD CONSTRAINT "JobTile_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
