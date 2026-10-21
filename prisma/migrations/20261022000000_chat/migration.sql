-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('CHANNEL', 'DIRECT');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE');

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "directKey" TEXT,
ADD COLUMN     "kind" "ChannelKind" NOT NULL DEFAULT 'CHANNEL';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "data" JSONB,
ADD COLUMN     "type" "MessageType" NOT NULL DEFAULT 'TEXT';

-- CreateIndex
CREATE UNIQUE INDEX "Channel_directKey_key" ON "Channel"("directKey");

