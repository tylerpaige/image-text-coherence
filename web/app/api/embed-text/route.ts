import { NextRequest, NextResponse } from "next/server";
import { embeddingError } from "../../../lib/api-error";
import { embedQuery } from "../../../lib/embed";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "ENTER SOME TEXT" }, { status: 400 });
  }

  try {
    const embedding = await embedQuery(query);
    return NextResponse.json({ embedding });
  } catch (err) {
    return embeddingError(err);
  }
}
