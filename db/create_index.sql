-- Build this AFTER seeding all rows -- inserting into an already-indexed
-- HNSW table is much slower than bulk-inserting first, then indexing.
--
--   psql "$DATABASE_URL" -f db/create_index.sql
--
-- The remote scripts pipe this file to psql after their own session settings.
CREATE INDEX IF NOT EXISTS images_embedding_hnsw_idx
    ON images
    USING hnsw (embedding vector_cosine_ops);
