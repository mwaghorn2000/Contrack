BEGIN;

ALTER TABLE "Channel"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Channel" SET "title" = "name";
ALTER TABLE "Channel" ALTER COLUMN "title" SET NOT NULL;
CREATE INDEX "Channel_companyId_idx" ON "Channel"("companyId");

ALTER TABLE "ChannelMember"
  ADD COLUMN "id" TEXT,
  ADD COLUMN "canSendMessages" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageMembers" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageChannel" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canModerateMessages" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "removedAt" TIMESTAMP(3);

-- Legacy messages may outlive their channel membership. Recover the author
-- relationship without granting these former members access again.
INSERT INTO "ChannelMember" ("channelId", "userId", "joinedAt", "removedAt")
SELECT m."channelId", m."authorId", MIN(m."postedAt"), CURRENT_TIMESTAMP
FROM "Message" m
LEFT JOIN "ChannelMember" cm ON cm."channelId" = m."channelId" AND cm."userId" = m."authorId"
WHERE cm."userId" IS NULL
GROUP BY m."channelId", m."authorId";

UPDATE "ChannelMember" SET "id" = 'cm_' || md5(json_build_array("channelId", "userId")::text);

-- Do not preserve active access for a user who has already left the company.
UPDATE "ChannelMember" cm SET "removedAt" = CURRENT_TIMESTAMP
FROM "Channel" c
WHERE cm."channelId" = c."id" AND cm."removedAt" IS NULL
AND NOT EXISTS (
  SELECT 1 FROM "CompanyMember" member
  WHERE member."companyId" = c."companyId" AND member."userId" = cm."userId"
);

ALTER TABLE "ChannelMember" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "ChannelMember" DROP CONSTRAINT "ChannelMember_pkey";
ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "ChannelMember_channelId_userId_key" ON "ChannelMember"("channelId", "userId");
CREATE UNIQUE INDEX "ChannelMember_id_channelId_key" ON "ChannelMember"("id", "channelId");
CREATE INDEX "ChannelMember_userId_removedAt_idx" ON "ChannelMember"("userId", "removedAt");

ALTER TABLE "Message" ADD COLUMN "authorChannelMemberId" TEXT, ADD COLUMN "deletedAt" TIMESTAMP(3);
UPDATE "Message" m SET "authorChannelMemberId" = cm."id"
FROM "ChannelMember" cm
WHERE cm."channelId" = m."channelId" AND cm."userId" = m."authorId";
ALTER TABLE "Message" ALTER COLUMN "authorChannelMemberId" SET NOT NULL;
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorChannelMemberId_channelId_fkey"
  FOREIGN KEY ("authorChannelMemberId", "channelId") REFERENCES "ChannelMember"("id", "channelId")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Message" DROP CONSTRAINT "Message_authorId_fkey";
ALTER TABLE "Message" DROP COLUMN "authorId";
CREATE INDEX "Message_channelId_postedAt_id_idx" ON "Message"("channelId", "postedAt", "id");
CREATE INDEX "Message_authorChannelMemberId_channelId_idx" ON "Message"("authorChannelMemberId", "channelId");

COMMIT;
