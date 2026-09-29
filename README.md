# LAION Search

A text-to-image search tool for students: type a query, get back images retrieved
from a ~250k-image subset of LAION-2B by CLIP visual similarity, each shown with
its caption and similarity score. Images are hotlinked from their original source,
never re-hosted.

## How it works

- **Offline pipeline** (`pipeline/`, Python): samples URLs/captions from the
  [`laion/relaion2B-en-research-safe`](https://huggingface.co/datasets/laion/relaion2B-en-research-safe)
  dataset (the safety-vetted successor to the original LAION-2B, after LAION
  pulled the original release following the Stanford Internet Observatory's
  CSAM findings), downloads the images, embeds each one with CLIP
  (`open_clip`, `ViT-B-32`, **openai** pretrained weights), and seeds a local
  Postgres database.
- **Database** (`db/`): Postgres + [pgvector](https://github.com/pgvector/pgvector).
  One `images` table: `source_url`, `caption`, `laion_similarity` (the
  original LAION CLIP score), and `embedding vector(512)`.
- **Web app** (`web/`): Next.js. At search time, the query text is embedded
  in-process with [`@huggingface/transformers`](https://github.com/huggingface/transformers.js)
  using `Xenova/clip-vit-base-patch32` — the transformers.js port of the
  *same* OpenAI CLIP ViT-B/32 checkpoint used offline, so query and image
  embeddings share one vector space. Results are ranked by pgvector cosine
  similarity. The whole site sits behind a single shared class password.

**Why OpenAI CLIP weights and not a LAION-retrained checkpoint?** Doing so
lets the query-embedding step run inside the Next.js Node process via
transformers.js, with no separate Python inference service to deploy.

## Repo layout

```
pipeline/     Python scripts: fetch metadata -> download images -> embed + seed
db/           Postgres schema, HNSW index, local -> remote push script
web/          Next.js app (Tailwind, pnpm, Node 26)
docker-compose.yml   Local dev: Postgres + the web app, wired together
```

## 1. Build the dataset (run locally, once)

Requires Python 3.11+ and a Hugging Face account with access accepted at
https://huggingface.co/datasets/laion/relaion2B-en-research-safe.

```bash
cd pipeline
python3.11 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in HF_TOKEN

# 1. Sample candidate rows (over-samples to survive link rot)
python fetch_metadata.py --num-shards 2 --rows-per-shard 500000

# 2. Download images (re-run with more shards from step 1 if you come up
#    short of your target count -- expect significant link rot)
python download_images.py

# 3. Start a local Postgres, apply the schema, embed + seed
docker run --name laion-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=laion \
  -p 5432:5432 -d pgvector/pgvector:pg16
psql postgresql://postgres:postgres@localhost:5432/laion -f ../db/schema.sql

python embed_and_seed.py --limit 250000
psql postgresql://postgres:postgres@localhost:5432/laion -f ../db/create_index.sql
```

Tip: run each script against a small sample first (e.g. `--rows-per-shard 2000`,
`--limit 500`) to confirm your HF token and Postgres connection work before
committing to the full ~250k-image run.

## 2. Push to the remote database

1. Create a Fly Managed Postgres cluster and enable the **Vector** extension
   from the Fly dashboard/API.
2. Run:

   ```bash
   LOCAL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/laion \
   REMOTE_DATABASE_URL=<your Fly MPG connection string> \
   ./db/push_to_remote.sh
   ```

## 3. Local development

The web app runs in Docker via `docker-compose.yml`, alongside a local
Postgres with pgvector (schema auto-applied on first boot from `db/schema.sql`).

```bash
cp .env.example .env   # set APP_PASSWORD and SESSION_SECRET
docker compose up
```

Visit http://localhost:3000. The `web` service bind-mounts `./web`, so edits
to the app hot-reload; `node_modules`/`.next` stay inside the container via
anonymous volumes.

To seed the local compose database with real data, run the pipeline's
`embed_and_seed.py` with `LOCAL_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/laion`
(`docker-compose.yml` publishes Postgres on host port 5433, since 5432 is
often already taken by a native Postgres install), then
`psql "$LOCAL_DATABASE_URL" -f db/create_index.sql`.

Without Docker, you can also just run the Next.js app directly:

```bash
cd web
pnpm install
cp .env.example .env.local   # DATABASE_URL, APP_PASSWORD, SESSION_SECRET
pnpm dev
```

## 4. Deploy to Fly.io

```bash
cd web
fly launch --no-deploy   # or edit fly.toml's `app` name, then `fly apps create <name>`
fly secrets set DATABASE_URL=<remote Fly MPG connection string>
fly secrets set APP_PASSWORD=<shared class password>
fly secrets set SESSION_SECRET=$(openssl rand -base64 32)
fly deploy
```

If the app gets OOM-killed after deploy (the CLIP query-embedding model
loads into memory), bump `[[vm]] memory` in `web/fly.toml`.

## Known quirks

- Some result thumbnails won't load — the underlying LAION URLs are years
  old and a meaningful fraction are dead or hotlink-protected. This is
  inherent to hotlinking rather than re-hosting images.
- `laion_similarity` (stored per row) is LAION's own original CLIP
  image/caption similarity from when the dataset was built; the `score`
  shown in the UI is the live cosine similarity between your query and that
  image, which is the number that actually drives ranking.
