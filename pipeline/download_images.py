"""
Download images (and captions/metadata) from the candidate URL list produced
by fetch_metadata.py, using img2dataset.

We don't need to keep images long-term (the web app hotlinks the original
URLs), so this downloads at a modest resolution just large enough for CLIP's
224px preprocessing.
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
        "--number_sample_per_shard=10000",
        "--save_additional_columns",
        json.dumps(["similarity"]),
    ]
    print("Running:", " ".join(cmd))
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
