import { NextRequest, NextResponse } from "next/server";
import { embeddingError } from "../../../lib/api-error";
import { embedImage, embedQuery } from "../../../lib/embed";
import { dot } from "../../../lib/similarity";
import { isUploadError, readImageField } from "../../../lib/upload";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const image = await readImageField(form);
  if (isUploadError(image)) {
    return NextResponse.json({ error: image.error }, { status: 400 });
  }

  const text = form.get("text");
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "ENTER SOME TEXT" }, { status: 400 });
  }

  try {
    const [imageEmbedding, textEmbedding] = await Promise.all([
      embedImage(image.bytes),
      embedQuery(text.trim()),
    ]);
    return NextResponse.json({ score: dot(imageEmbedding, textEmbedding) });
  } catch (err) {
    return embeddingError(err);
  }
}
