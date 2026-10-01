-- Build this AFTER seeding all rows -- inserting into an already-indexed
-- HNSW table is much slower than bulk-inserting first, then indexing.
--
--   psql "$DATABASE_URL" -f db/create_index.sql          (local)
--   psql "$REMOTE_DATABASE_URL" -f db/create_index.sql  (remote, also run by push_to_remote.sh)

CREATE INDEX IF NOT EXISTS images_embedding_hnsw_idx
    ON images
    USING hnsw (embedding vector_cosine_ops);
