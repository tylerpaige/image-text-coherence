import { NextRequest, NextResponse } from "next/server";
import { embedQuery } from "../../../lib/embed";
import { pool } from "../../../lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  const embedding = await embedQuery(query);
  const vectorLiteral = `[${embedding.join(",")}]`;

  const { rows } = await pool.query(
    `SELECT source_url, caption, 1 - (embedding <=> $1::vector) AS score
     FROM images
     ORDER BY embedding <=> $1::vector
     LIMIT 60`,
    [vectorLiteral]
  );

  return NextResponse.json({
    results: rows.map((r) => ({
      sourceUrl: r.source_url as string,
      caption: r.caption as string,
      score: Number(r.score),
    })),
  });
}
