import { embedTexts } from "./embed";
import { PHRASES } from "./phrases";
import { dot } from "./similarity";

let cached: Promise<number[][]> | null = null;

function phraseEmbeddings(): Promise<number[][]> {
  if (!cached) {
    cached = embedTexts([...PHRASES]).catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

export async function closestPhrases(
  image: number[],
  k = 12,
): Promise<{ text: string; score: number }[]> {
  const vectors = await phraseEmbeddings();
  return vectors
    .map((vec, i) => ({ text: PHRASES[i], score: dot(image, vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
