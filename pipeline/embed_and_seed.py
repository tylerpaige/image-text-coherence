"""
Walk the downloaded images, compute CLIP (ViT-B-32, openai weights) image
embeddings, and insert them into the local Postgres/pgvector database.

Uses the OpenAI-original CLIP checkpoint (not a LAION-retrained one) so that
its embedding space matches the transformers.js port used for query
embedding in the web app (Xenova/clip-vit-base-patch32).

Deletes each image file locally after it's successfully embedded and
inserted, since the web app only ever hotlinks the original source_url.

Run db/schema.sql against DATABASE_URL before running this script.
"""

import argparse
import glob
import json
import os
from pathlib import Path

import open_clip
import psycopg2
import torch
from PIL import Image
from pgvector.psycopg2 import register_vector
from tqdm import tqdm

from env import load_root_env

load_root_env()

BATCH_SIZE = 64


def find_samples(root):
    for jpg_path in sorted(glob.glob(os.path.join(root, "**", "*.jpg"), recursive=True)):
        base = jpg_path[:-4]
        json_path = base + ".json"
        txt_path = base + ".txt"
        if os.path.exists(json_path):
            yield jpg_path, json_path, txt_path


def load_batch(paths, preprocess):
    images, metas = [], []
    for jpg_path, json_path, txt_path in paths:
        try:
            img = Image.open(jpg_path).convert("RGB")
        except Exception as exc:  # noqa: BLE001 - corrupt/unreadable images are common at scale
            print(f"skip {jpg_path}: {exc}")
            continue

        with open(json_path) as f:
            meta = json.load(f)

        caption = meta.get("caption")
        if not caption and os.path.exists(txt_path):
            caption = Path(txt_path).read_text().strip()

        source_url = meta.get("url")
        if not source_url or not caption:
            continue

        images.append(preprocess(img))
        metas.append(
            {
                "source_url": source_url,
                "caption": caption,
                "laion_similarity": meta.get("similarity"),
                "jpg_path": jpg_path,
                "json_path": json_path,
                "txt_path": txt_path,
            }
        )
    return images, metas


def cleanup(meta, keep_images: bool):
    if keep_images:
        return
    for key in ("jpg_path", "json_path", "txt_path"):
        path = meta.get(key)
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--images-dir", default="data/images")
    parser.add_argument("--limit", type=int, default=250_000)
    parser.add_argument(
        "--keep-images",
        action="store_true",
        help="don't delete local image files after embedding (default: delete)",
    )
    args = parser.parse_args()

    db_url = os.environ["DATABASE_URL"]

    if torch.cuda.is_available():
        device = "cuda"
    elif torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"
    print(f"Using device: {device}")

    model, _, preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="openai"
    )
    model = model.to(device).eval()

    conn = psycopg2.connect(db_url)
    register_vector(conn)
    cur = conn.cursor()

    samples = list(find_samples(args.images_dir))
    print(f"Found {len(samples)} downloaded images on disk")
    samples = samples[: args.limit]

    inserted = 0
    for i in tqdm(range(0, len(samples), BATCH_SIZE)):
        batch_paths = samples[i : i + BATCH_SIZE]
        images, metas = load_batch(batch_paths, preprocess)
        if not images:
            continue

        pixel_values = torch.stack(images).to(device)
        with torch.no_grad():
            embeddings = model.encode_image(pixel_values)
            embeddings = embeddings / embeddings.norm(dim=-1, keepdim=True)
        embeddings = embeddings.cpu().numpy()

        rows = list(zip(metas, embeddings))

        cur.executemany(
            """
            INSERT INTO images (source_url, caption, laion_similarity, embedding)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (source_url) DO NOTHING
            """,
            [
                (m["source_url"], m["caption"], m["laion_similarity"], emb)
                for m, emb in rows
            ],
        )
        conn.commit()
        inserted += len(rows)

        for m, _ in rows:
            cleanup(m, args.keep_images)

    cur.close()
    conn.close()
    print(f"Attempted to insert {inserted} rows.")
    print("Now build the vector index: psql \"$DATABASE_URL\" -f db/create_index.sql")


if __name__ == "__main__":
    main()
