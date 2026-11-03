-- Measurements are now a label with a list of values; delete the ones
-- saved in the old shape (one value each).
DELETE FROM "JobTileAnswer"
WHERE "tileId" IN (SELECT "id" FROM "JobTile" WHERE "type" = 'measurement');
