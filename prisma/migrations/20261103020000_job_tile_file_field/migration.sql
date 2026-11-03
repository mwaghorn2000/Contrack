-- Which Form field a file was attached under; null on other tiles.
ALTER TABLE "JobTileFile" ADD COLUMN "fieldId" TEXT;
