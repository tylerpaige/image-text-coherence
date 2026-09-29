import {
  AutoTokenizer,
  CLIPTextModelWithProjection,
  env,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";

// Same checkpoint (converted from the OpenAI-original CLIP ViT-B/32 weights)
// as `open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")`
// used offline in pipeline/embed_and_seed.py -- must match so query and
// image embeddings share the same vector space.
const MODEL_ID = "Xenova/clip-vit-base-patch32";

env.cacheDir = "/tmp/transformers-cache";

let tokenizerPromise: Promise<PreTrainedTokenizer> | null = null;
let modelPromise: ReturnType<typeof CLIPTextModelWithProjection.from_pretrained> | null = null;

function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = AutoTokenizer.from_pretrained(MODEL_ID);
  }
  return tokenizerPromise;
}

function getModel() {
  if (!modelPromise) {
    modelPromise = CLIPTextModelWithProjection.from_pretrained(MODEL_ID);
  }
  return modelPromise;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [tokenizer, model] = await Promise.all([getTokenizer(), getModel()]);
  const inputs = await tokenizer([text], { padding: true, truncation: true });
  const { text_embeds } = await model(inputs);

  const vec = Array.from(text_embeds.data as Float32Array);
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map((v) => v / norm);
}
