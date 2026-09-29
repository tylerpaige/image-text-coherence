"""
Sample candidate rows (url, caption, original CLIP similarity) from the
laion/relaion2B-en-research-safe dataset on Hugging Face.

We over-sample because many image URLs from the original LAION crawl are
dead by now (link rot), so we need more candidates than our final target
image count.

Requires:
  - HF_TOKEN in the environment (or pipeline/.env), with dataset access
    accepted at https://huggingface.co/datasets/laion/relaion2B-en-research-safe
"""

import argparse
import os
import random

import pandas as pd
import pyarrow.parquet as pq
from dotenv import load_dotenv
from huggingface_hub import HfApi, hf_hub_download

load_dotenv()

DATASET_REPO = "laion/relaion2B-en-research-safe"

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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--num-shards",
        type=int,
        default=2,
        help="how many parquet shards to sample candidate rows from",
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
            "Set HF_TOKEN in pipeline/.env (accept the dataset terms at "
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

    frames = []
    for shard in chosen:
        print(f"Downloading shard {shard} ...")
        path = hf_hub_download(
            DATASET_REPO, shard, repo_type="dataset", token=token
        )
        pf = pq.ParquetFile(path)
        cols = resolve_columns(pf.schema_arrow.names)
        table = pf.read(columns=list(cols.values()))
        df = table.to_pandas().rename(columns={v: k for k, v in cols.items()})
        df = df.dropna(subset=["url", "caption"])
        if len(df) > args.rows_per_shard:
            df = df.sample(n=args.rows_per_shard, random_state=args.seed)
        frames.append(df[["url", "caption", "similarity"]])
        print(f"  kept {len(df)} rows from this shard")

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.drop_duplicates(subset=["url"])

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    combined.to_parquet(args.out)
    print(f"Wrote {len(combined)} candidate rows to {args.out}")
    print(
        "Next: python download_images.py --input "
        f"{args.out} (re-run fetch_metadata.py with --num-shards higher "
        "if download_images.py comes up short of your target count)"
    )


if __name__ == "__main__":
    main()
