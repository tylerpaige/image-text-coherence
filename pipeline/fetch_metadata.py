"""
Sample candidate rows (url, caption, original CLIP similarity) from the
laion/relaion2B-en-research-safe dataset on Hugging Face.

We over-sample because many image URLs from the original LAION crawl are
dead by now (link rot), so we need more candidates than our final target
image count.

Resumable across sessions -- each shard's raw parquet file is ~3-4GB, too
big to reliably grab in one sitting:
  - Byte-level: shards are downloaded with our own HTTP Range-based
    resumable_download() into data/hf_raw_shards/, resuming from wherever a
    previous attempt left off. (huggingface_hub's own hf_hub_download can no
    longer do this: as of huggingface_hub 2.x it downloads to a
    process-unique temp file and deletes it on any interruption -- see
    https://github.com/huggingface/huggingface_hub/pull/4228 -- so we can't
    rely on it here.) A sidecar `.etag` file guards against resuming into a
    stale partial file if the remote content ever changes.
  - Shard-level: once a shard is downloaded, its sampled rows are written to
    data/metadata_shards/<shard>.parquet and the raw file is deleted. A shard
    whose sample file already exists is skipped entirely on the next run.
  - The combined output file is regenerated from whatever shard files exist
    every run, so you can also just run this with a small --num-shards
    repeatedly (once per session) to build up the candidate pool.

Requires:
  - HF_TOKEN in the environment (or the repo-root .env), with dataset access
    accepted at https://huggingface.co/datasets/laion/relaion2B-en-research-safe
"""

import argparse
import os
import random

import pandas as pd
import pyarrow.parquet as pq
import requests
from huggingface_hub import HfApi, hf_hub_url
from tqdm import tqdm

from env import load_root_env

load_root_env()

DATASET_REPO = "laion/relaion2B-en-research-safe"
SHARDS_DIR = "data/metadata_shards"
RAW_DIR = "data/hf_raw_shards"
CHUNK_SIZE = 8 * 1024 * 1024

# The exact column names in this gated dataset may vary slightly by release;
# we try a few common aliases and fail loudly if none match.
COLUMN_ALIASES = {
    "url": ["url", "URL", "image_url"],
    "caption": ["text", "TEXT", "caption", "CAPTION"],
    "similarity": ["similarity", "SIMILARITY", "clip_similarity"],
}


def resolve_columns(schema_names):
    resolved = {}
    for key, aliases in COLUMN_ALIASES.items():
        match = next((c for c in aliases if c in schema_names), None)
        if not match:
            raise SystemExit(
                f"Could not find a column for '{key}' among {schema_names}. "
                "Update COLUMN_ALIASES in fetch_metadata.py to match the "
                "dataset's actual schema."
            )
        resolved[key] = match
    return resolved


def shard_cache_path(shard: str) -> str:
    safe_name = shard.replace("/", "__")
    return os.path.join(SHARDS_DIR, f"{safe_name}.parquet")


def raw_shard_path(shard: str) -> str:
    safe_name = shard.replace("/", "__")
    return os.path.join(RAW_DIR, safe_name)


def resumable_download(url: str, token: str, dest_path: str) -> None:
    """Download `url` to `dest_path`, resuming a partial `dest_path.part`
    file (from a previous, interrupted run) via an HTTP Range request.

    Safe to Ctrl-C or kill at any point: the partial file is left in place
    and picked up again on the next call.
    """
    if os.path.exists(dest_path):
        return

    headers = {"Authorization": f"Bearer {token}"} if token else {}
    head = requests.head(url, headers=headers, allow_redirects=True, timeout=30)
    head.raise_for_status()
    etag = head.headers.get("ETag") or head.headers.get("x-linked-etag")
    total_size = int(head.headers["Content-Length"])

    part_path = dest_path + ".part"
    etag_path = dest_path + ".etag"
    os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)

    resume_from = 0
    if os.path.exists(part_path):
        stored_etag = open(etag_path).read().strip() if os.path.exists(etag_path) else None
        if stored_etag == etag:
            resume_from = os.path.getsize(part_path)
        else:
            # Remote file changed (or no etag on record) -- can't trust the
            # partial bytes we have, start over.
            os.remove(part_path)

    if etag:
        with open(etag_path, "w") as f:
            f.write(etag)

    if resume_from >= total_size:
        os.replace(part_path, dest_path)
        return

    req_headers = dict(headers)
    if resume_from:
        req_headers["Range"] = f"bytes={resume_from}-"

    with requests.get(url, headers=req_headers, stream=True, timeout=60) as r:
        if resume_from and r.status_code == 200:
            # Server ignored the Range request -- can't resume, restart clean.
            resume_from = 0
        r.raise_for_status()
        mode = "ab" if resume_from else "wb"
        with open(part_path, mode) as f, tqdm(
            total=total_size,
            initial=resume_from,
            unit="B",
            unit_scale=True,
            desc=os.path.basename(dest_path),
        ) as bar:
            for chunk in r.iter_content(chunk_size=CHUNK_SIZE):
                if chunk:
                    f.write(chunk)
                    bar.update(len(chunk))

    if os.path.getsize(part_path) != total_size:
        raise IOError(
            f"Download of {dest_path} ended at "
            f"{os.path.getsize(part_path)}/{total_size} bytes -- re-run to resume"
        )
    os.replace(part_path, dest_path)
    if os.path.exists(etag_path):
        os.remove(etag_path)


def process_shard(shard: str, token: str, rows_per_shard: int, seed: int) -> str:
    """Download + sample one shard, write its cache file, return that path.

    Safe to re-run: resumable_download() resumes a partial download of
    `shard` itself, and this whole function is skipped by the caller if the
    shard's cache file already exists.
    """
    cache_path = shard_cache_path(shard)
    raw_path = raw_shard_path(shard)

    print(f"Downloading shard {shard} ...")
    url = hf_hub_url(DATASET_REPO, shard, repo_type="dataset")
    resumable_download(url, token, raw_path)

    pf = pq.ParquetFile(raw_path)
    cols = resolve_columns(pf.schema_arrow.names)
    table = pf.read(columns=list(cols.values()))
    df = table.to_pandas().rename(columns={v: k for k, v in cols.items()})
    df = df.dropna(subset=["url", "caption"])
    if len(df) > rows_per_shard:
        df = df.sample(n=rows_per_shard, random_state=seed)

    os.makedirs(SHARDS_DIR, exist_ok=True)
    df[["url", "caption", "similarity"]].to_parquet(cache_path)
    print(f"  kept {len(df)} rows from this shard -> {cache_path}")

    os.remove(raw_path)  # sampled -- don't need the ~3-4GB raw shard anymore
    return cache_path


def combine_shard_caches(out_path: str) -> int:
    if not os.path.isdir(SHARDS_DIR):
        raise SystemExit(f"No shard caches found in {SHARDS_DIR} yet")

    cache_files = sorted(
        os.path.join(SHARDS_DIR, f)
        for f in os.listdir(SHARDS_DIR)
        if f.endswith(".parquet")
    )
    if not cache_files:
        raise SystemExit(f"No shard caches found in {SHARDS_DIR} yet")

    combined = pd.concat((pd.read_parquet(f) for f in cache_files), ignore_index=True)
    combined = combined.drop_duplicates(subset=["url"])

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    combined.to_parquet(out_path)
    return len(combined)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--num-shards",
        type=int,
        default=2,
        help="how many parquet shards to sample candidate rows from "
        "(shard selection is deterministic given --seed, so re-running "
        "with a higher number just adds more shards on top of what's "
        "already cached)",
    )
    parser.add_argument(
        "--rows-per-shard",
        type=int,
        default=500_000,
        help="max candidate rows to keep per shard",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default="data/metadata_sample.parquet")
    args = parser.parse_args()

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit(
            "Set HF_TOKEN in the repo-root .env (accept the dataset terms at "
            f"https://huggingface.co/datasets/{DATASET_REPO} first)"
        )

    api = HfApi(token=token)
    files = [
        f
        for f in api.list_repo_files(DATASET_REPO, repo_type="dataset")
        if f.endswith(".parquet")
    ]
    if not files:
        raise SystemExit(f"No parquet files found in {DATASET_REPO}")

    rng = random.Random(args.seed)
    rng.shuffle(files)
    chosen = files[: args.num_shards]

    for shard in chosen:
        if os.path.exists(shard_cache_path(shard)):
            print(f"Already sampled, skipping: {shard}")
            continue
        process_shard(shard, token, args.rows_per_shard, args.seed)

    total = combine_shard_caches(args.out)
    print(f"Wrote {total} candidate rows to {args.out}")
    print(
        "Next: python download_images.py --input "
        f"{args.out} (re-run fetch_metadata.py with --num-shards higher "
        "if download_images.py comes up short of your target count -- "
        "already-cached shards are skipped, so this is cheap to re-run)"
    )


if __name__ == "__main__":
    main()
