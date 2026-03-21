ALTER TABLE "content_strategies"
ADD COLUMN "source_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
