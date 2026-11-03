-- Checklist ticks no longer take notes; clear the ones already saved.
UPDATE "JobTileAnswer" SET "note" = NULL
WHERE "note" IS NOT NULL
  AND "tileId" IN (SELECT "id" FROM "JobTile" WHERE "type" = 'checklist');
