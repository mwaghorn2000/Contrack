CREATE TABLE "CompanyPostAcknowledgment" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyPostAcknowledgment_pkey" PRIMARY KEY ("postId", "userId")
);

CREATE INDEX "CompanyPostAcknowledgment_userId_idx" ON "CompanyPostAcknowledgment"("userId");

ALTER TABLE "CompanyPostAcknowledgment" ADD CONSTRAINT "CompanyPostAcknowledgment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CompanyPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyPostAcknowledgment" ADD CONSTRAINT "CompanyPostAcknowledgment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
