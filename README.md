# Image Text Coherence

This repo offers a suite of tools for art students to learn about machine learning's understanding of image/text relations. Namely it helps them explore the idea of image-text coherence.

- **Search**: type a query, get back images retrieved from a ~250k-image subset of LAION-2B by CLIP visual similarity, each shown with its caption and similarity score. Images are hotlinked from their original source, never re-hosted.
- **Personal corpus search**: upload up to 100 of your own images and search them with text. The pictures stay in the browser; the server only computes embeddings.
- **Score**: upload an image and enter text. CLIP reports the cosine similarity.
- **Interrogate**: upload an image. CLIP ranks a fixed list of phrases and shows the closest ones.

## How it works

- Offline pipeline prepares data locally so that we can take advantage of local hardware which is free. The prepared data is then pushed to the remote environment.
  - takes URLs/captions from the [`laion/relaion2B-en-research-safe`](https://huggingface.co/datasets/laion/relaion2B-en-research-safe) dataset
  - downloads the images
  - embeds each one with CLIP (`open_clip`, `ViT-B-32`, openai pretrained weights)
  - seeds a local Postgres database
- Database
  - Postgres and pgvector
  - One `images` table that records...
    - the original image URL
    - the original caption
    - the original LAION clip score, which isn't really used for anything.
    - the embedding vector (512 dimensions) that we generated locally
- Next.js app that provides a user-friendly interface
  - Uses [`@huggingface/transformers`](https://github.com/huggingface/transformers.js) to run CLIP in a Node environment
  - Downloads a CLIP model to a cache on disk
  - Specifically, it uses `Xenova/clip-vit-base-patch32`, which is the transformers.js port of the same model used in the offline pipeline. This ensures that website is searching the same vector space as the prepared data.
  - When a user enters a search term, transformers.js embeds it in-process
  - Uploaded images are embedded with the same checkpoint's vision tower and then discarded
  - The app then queries Postgres for similar records, using pgvector cosine similarity
  - The app is password protected so we don't run up a huge bill

## Build the dataset (run locally, once)

Requires Python 3.11+ and a Hugging Face account with access accepted at
https://huggingface.co/datasets/laion/relaion2B-en-research-safe.

```bash
cp .env.example .env   # fill in HF_TOKEN; this file is also what the web app reads

cd pipeline
python3.11 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 1. Sample candidate rows (over-samples to survive link rot)
python fetch_metadata.py --num-shards 2 --rows-per-shard 500000

# 2. Download images (re-run with more shards from step 1 if you come up
#    short of your target count -- expect significant link rot)
python download_images.py

# 3. Start the Compose Postgres (from the repo root). It publishes on host
#    port 5433 and applies db/schema.sql on first boot.
cd ..
docker compose up -d db

# 4. Seed from the host. DATABASE_URL in the root .env already points
#    at localhost:5433.
cd pipeline
python embed_and_seed.py --limit 250000
psql postgresql://postgres:postgres@localhost:5433/laion -f ../db/create_index.sql
```

Tip: run each script against a small sample first (e.g. `--rows-per-shard 2000`, `--limit 500`) to confirm your HF token and Postgres connection work before committing to the full ~250k-image run.

**Both download steps are resumable across sessions** -- safe to Ctrl-C or close your laptop and pick up later by just re-running the same command:

- `fetch_metadata.py`: each shard's raw parquet file is ~3-4GB. We can't rely on `huggingface_hub`'s own caching for this -- as of `huggingface_hub` 2.x it downloads to a process-unique temp file and deletes it on any interruption (no cross-process resume). Instead this script does its own HTTP Range-based resumable download into `data/hf_raw_shards/`, and once a shard is fully downloaded and sampled it's cached at the row level in `data/metadata_shards/` and the raw file is deleted. Re-running the exact same command resumes the in-progress shard's download and skips any shard already sampled.
- `download_images.py`: img2dataset's incremental mode (on by default) skips any shard it already finished. `--samples-per-shard` (default 1000) caps how much work gets redone for the one shard that was mid-download when the process was killed.
- `embed_and_seed.py`: each image is deleted from disk right after it's successfully embedded and inserted (`ON CONFLICT DO NOTHING`), so a restart just picks up with whatever images are still on disk.

## Prepare the remote environment

These instructions assume you have a Ubuntu server somewhere to deploy this application. Make sure you can SSH in! I am using a Digital Ocean droplet (basic, 1 shared vcpu, 2gb RAM). The web process loads both CLIP towers, text and vision; 2GB is the floor once Postgres is running as well.

We will deploy the application with Kamal.

### Set up a Docker container registry

Kamal requires a container registry. I am using GitHub's private registry. If you want to do the same, here are instructions:

- GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token.
- Choose the `write:packages` scope
- Copy the token
- Use it as your `KAMAL_REGISTRY_PASSWORD` environment variable in `.env.production`

### Set up custom domains

If you intend to have this available at a custom domain, setup the DNS now. The easiest implementation will be to create an A record pointing to your server's IP address.

### Configure Kamal

Install Kamal (it's a Ruby gem):

```bash
gem install kamal
```

Create an `.env.production` file that Kamal will use.

| Variable                  | Value                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `KAMAL_REGISTRY_PASSWORD` | the GitHub token from step 3                                                             |
| `APP_PASSWORD`            | the shared class password                                                                |
| `SESSION_SECRET`          | `openssl rand -base64 32`                                                                |
| `POSTGRES_PASSWORD`       | `openssl rand -base64 24`                                                                |
| `DATABASE_URL`            | `postgresql://postgres:<the POSTGRES_PASSWORD above>@image-text-coherence-db:5432/laion` |

Load these into your shell before any `kamal` command:

```bash
set -a && source .env.production && set +a
```

Edit `config/deploy.yml`. There are comments throughout the file indicating what each value should be.

### Deploy the app

> [!WARNING]
> Note that you need to use the production environment variables when running kamal commands.
> ```bash
> set -a && source .env.production && set +a
> ```

The first time you deploy, you need to set up Kamal on the server. This installs Docker on the droplet if needed, boots `kamal-proxy`, boots the Postgres accessory (auto-applying `db/schema.sql` on first boot, same as `docker-compose.yml` does locally), builds and pushes the image, and deploys the app. It'll request a Let's Encrypt certificate for your domain automatically if `proxy.ssl` is set.

```bash
kamal setup
```

On subsequent deploys:

```bash
kamal deploy
```

### Seed the remote database

The local Compose database and the Kamal accessory are both Postgres 16. `db/push_to_remote.sh` runs `pg_dump` and `pg_restore` inside the Compose `db` container so the dump is written by that same major version. A newer client installed on your Mac (Homebrew `libpq` 18, for example) adds settings Postgres 16 rejects.

The script reads the server from `config/deploy.yml` and `POSTGRES_PASSWORD` from `.env.production`. It opens an SSH tunnel to the database accessory, pushes the local `images` table, and closes the tunnel when it finishes.

Start the local database if it is not already running:

```bash
docker compose up -d db
```

Then:

```bash
./db/push_to_remote.sh
```

Note that running that command will clear out the existing `images` table on the remote db. In other words, it is not resumable.

## Local development

The web app runs in Docker via `docker-compose.yml`, alongside a local Postgres with pgvector (schema auto-applied on first boot from `db/schema.sql`).

```bash
docker compose up
```

Visit http://localhost:3000

## Remote debugging

 Useful commands:

```bash
kamal app logs -f          # tail the app's logs
kamal app exec --interactive "sh"   # shell into the running container
kamal accessory logs db    # tail Postgres's logs
kamal rollback             # roll back to the previous deployed version
```

## Known quirks

- Some result thumbnails won't load — the underlying LAION URLs are years
  old and a meaningful fraction are dead or hotlink-protected. This is
  inherent to hotlinking rather than re-hosting images.
