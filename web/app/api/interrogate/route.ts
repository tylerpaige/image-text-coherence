import { NextRequest, NextResponse } from "next/server";
import { embeddingError } from "../../../lib/api-error";
import { pool } from "../../../lib/db";
import { embedImage } from "../../../lib/embed";
import { isUploadError, readImageField } from "../../../lib/upload";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const image = await readImageField(form);
  if (isUploadError(image)) {
    return NextResponse.json({ error: image.error }, { status: 400 });
  }

  try {
    const embedding = await embedImage(image.bytes);
    const vectorLiteral = `[${embedding.join(",")}]`;

    // The HNSW index can get stuck inside a large run of identical embeddings
    // and never reach the true neighbors. Compare every row instead, then
    // keep one caption per embedding. On this table that takes a few seconds.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_indexscan = off");
      await client.query("SET LOCAL enable_bitmapscan = off");
      const { rows } = await client.query(
        `SELECT source_url, caption, 1 - dist AS score
         FROM (
           SELECT DISTINCT ON (emb_key) source_url, caption, dist
           FROM (
             SELECT source_url, caption, md5(embedding::text) AS emb_key,
                    embedding <=> $1::vector AS dist
             FROM images
             ORDER BY dist
             LIMIT 8000
           ) nearest
           ORDER BY emb_key, dist
         ) unique_images
         ORDER BY dist
         LIMIT 60`,
        [vectorLiteral]
      );
      await client.query("COMMIT");
      return NextResponse.json({
        results: rows.map((r) => ({
          sourceUrl: r.source_url as string,
          caption: r.caption as string,
          score: Number(r.score),
        })),
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return embeddingError(err);
  }
}
