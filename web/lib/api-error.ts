import { NextResponse } from "next/server";

const CLIENT_ERRORS = new Set(["COULD NOT READ THAT IMAGE"]);

export function embeddingError(err: unknown) {
  console.error(err);
  const message = err instanceof Error ? err.message : "";
  if (CLIENT_ERRORS.has(message)) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json({ error: "EMBEDDING FAILED" }, { status: 500 });
}
