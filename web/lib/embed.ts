import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  env,
  RawImage,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";
import sharp from "sharp";

// Same checkpoint (converted from the OpenAI-original CLIP ViT-B/32 weights)
// as `open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")`
// used offline in pipeline/embed_and_seed.py -- must match so query and
// image embeddings share the same vector space.
const MODEL_ID = "Xenova/clip-vit-base-patch32";
const TEXT_BATCH = 32;

env.cacheDir = "/tmp/transformers-cache";

let tokenizerPromise: Promise<PreTrainedTokenizer> | null = null;
let textModelPromise: ReturnType<typeof CLIPTextModelWithProjection.from_pretrained> | null = null;
let processorPromise: ReturnType<typeof AutoProcessor.from_pretrained> | null = null;
let visionModelPromise: ReturnType<typeof CLIPVisionModelWithProjection.from_pretrained> | null =
  null;

// One vision forward at a time. Several students can upload at once; the
// 2GB host should not run those forwards together.
let visionTail: Promise<void> = Promise.resolve();

function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = AutoTokenizer.from_pretrained(MODEL_ID);
  }
  return tokenizerPromise;
}

function getTextModel() {
  if (!textModelPromise) {
    textModelPromise = CLIPTextModelWithProjection.from_pretrained(MODEL_ID);
  }
  return textModelPromise;
}

function getProcessor() {
  if (!processorPromise) {
    processorPromise = AutoProcessor.from_pretrained(MODEL_ID);
  }
  return processorPromise;
}

function getVisionModel() {
  if (!visionModelPromise) {
    // Default dtype, same as the text tower, so the two projections match.
    visionModelPromise = CLIPVisionModelWithProjection.from_pretrained(MODEL_ID);
  }
  return visionModelPromise;
}

function withVisionLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = visionTail.then(fn);
  visionTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function normalize(data: Float32Array): number[] {
  const vec = Array.from(data);
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map((v) => v / norm);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const [tokenizer, model] = await Promise.all([getTokenizer(), getTextModel()]);
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += TEXT_BATCH) {
    const chunk = texts.slice(i, i + TEXT_BATCH);
    const inputs = await tokenizer(chunk, { padding: true, truncation: true });
    const { text_embeds } = await model(inputs);
    const data = text_embeds.data as Float32Array;
    const dims = text_embeds.dims as number[];
    const dim = dims[dims.length - 1];
    const rows = data.length / dim;
    if (rows !== chunk.length) {
      throw new Error(`Expected ${chunk.length} text embeddings, got ${rows}`);
    }
    for (let r = 0; r < rows; r++) {
      out.push(normalize(data.subarray(r * dim, (r + 1) * dim)));
    }
  }

  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec;
}

async function decodeImage(bytes: Uint8Array): Promise<RawImage> {
  try {
    const { data, info } = await sharp(Buffer.from(bytes))
      .rotate()
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3 || info.width < 1 || info.height < 1) {
      throw new Error("unexpected channels");
    }
    return new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3);
  } catch {
    throw new Error("COULD NOT READ THAT IMAGE");
  }
}

export async function embedImage(bytes: Uint8Array): Promise<number[]> {
  const [processor, model] = await Promise.all([getProcessor(), getVisionModel()]);
  return withVisionLock(async () => {
    const image = await decodeImage(bytes);
    const inputs = await processor(image);
    const { image_embeds } = await model(inputs);
    const data = image_embeds.data as Float32Array;
    const dims = image_embeds.dims as number[];
    const dim = dims[dims.length - 1];
    return normalize(data.subarray(0, dim));
  });
}
