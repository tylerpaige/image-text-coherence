"""
Download images (and captions/metadata) from the candidate URL list produced
by fetch_metadata.py, using img2dataset.

We don't need to keep images long-term (the web app hotlinks the original
URLs), so this downloads at a modest resolution just large enough for CLIP's
224px preprocessing.

Resumable across sessions: img2dataset's incremental mode (on by default,
set explicitly below) writes a stats file per completed shard and skips any
shard whose stats file already exists on the next run. Killing this script
and re-running it with the same --output folder picks up where it left off
-- at worst it redoes the one shard that was in progress when it was
killed, which is why --samples-per-shard defaults to a small 1000 (less
work to redo, at the cost of some scheduling overhead).
"""

import argparse
import json
import os
import subprocess


def count_downloaded(output_dir: str) -> int:
    total = 0
    for _root, _dirs, filenames in os.walk(output_dir):
        total += sum(1 for f in filenames if f.endswith(".jpg"))
    return total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/metadata_sample.parquet")
    parser.add_argument("--output", default="data/images")
    parser.add_argument("--image-size", type=int, default=384)
    parser.add_argument("--processes", type=int, default=4)
    parser.add_argument("--threads", type=int, default=32)
    parser.add_argument(
        "--samples-per-shard",
        type=int,
        default=1000,
        help="rows per img2dataset shard -- also the resume granularity: "
        "a shard in progress when the script is killed gets fully redone "
        "on the next run, so smaller = less wasted work but more overhead",
    )
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    cmd = [
        "img2dataset",
        f"--url_list={args.input}",
        f"--output_folder={args.output}",
        "--input_format=parquet",
        "--url_col=url",
        "--caption_col=caption",
        "--output_format=files",
        "--resize_mode=keep_ratio",
        f"--image_size={args.image_size}",
        f"--processes_count={args.processes}",
        f"--thread_count={args.threads}",
        f"--number_sample_per_shard={args.samples_per_shard}",
        "--incremental_mode=incremental",
        "--save_additional_columns",
        json.dumps(["similarity"]),
    ]
    print("Running:", " ".join(cmd))
    print(
        "(safe to Ctrl-C and re-run this exact command later -- "
        "already-completed shards are skipped)"
    )
    subprocess.run(cmd, check=True)

    downloaded = count_downloaded(args.output)
    print(f"Downloaded {downloaded} images into {args.output}")
    print(
        "If this is short of your target (e.g. 250k), re-run "
        "fetch_metadata.py with --num-shards higher for more candidates, "
        "then re-run this script pointed at the new metadata file with the "
        "same --output folder (img2dataset will add new shards alongside "
        "the existing ones)."
    )


if __name__ == "__main__":
    main()
