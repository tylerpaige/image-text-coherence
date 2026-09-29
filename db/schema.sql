-- Run against the LOCAL database before seeding:
--   psql "$LOCAL_DATABASE_URL" -f db/schema.sql
--
-- On the remote (Fly Managed Postgres) side, enable the "Vector" extension
-- from the Fly dashboard/API for the cluster first -- this file is not run
-- against the remote database; push_to_remote.sh only pushes the `images`
-- table's data.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS images (
    id BIGSERIAL PRIMARY KEY,
    source_url TEXT NOT NULL UNIQUE,
    caption TEXT NOT NULL,
    laion_similarity REAL,
    embedding vector(512) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
