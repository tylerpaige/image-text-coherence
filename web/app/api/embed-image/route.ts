import { NextRequest, NextResponse } from "next/server";
import { embeddingError } from "../../../lib/api-error";
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
    return NextResponse.json({ embedding });
  } catch (err) {
    return embeddingError(err);
  }
}
