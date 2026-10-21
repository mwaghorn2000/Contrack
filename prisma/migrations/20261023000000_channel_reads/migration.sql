-- CreateTable
CREATE TABLE "ChannelRead" (
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelRead_pkey" PRIMARY KEY ("channelId","userId")
);

-- CreateIndex
CREATE INDEX "ChannelRead_userId_idx" ON "ChannelRead"("userId");

-- AddForeignKey
ALTER TABLE "ChannelRead" ADD CONSTRAINT "ChannelRead_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRead" ADD CONSTRAINT "ChannelRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

