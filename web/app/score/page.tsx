"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "../../components/page-header";
import { errorMessage } from "../../lib/error-message";
import { loadScoreEmbedding, saveScoreEmbedding } from "../../lib/score-db";
import { dot } from "../../lib/similarity";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type EmbedJob = {
  token: number;
  promise: Promise<number[]>;
};

class ReplacedFile extends Error {
  constructor() {
    super("replaced");
  }
}

function fileProblem(file: File): string | null {
  const okType = ALLOWED.has(file.type) || /\.(jpe?g|png|webp|gif)$/i.test(file.name);
  if (!okType) return "USE A JPEG, PNG, WEBP, OR GIF";
  if (file.size === 0) return "EMPTY IMAGE";
  if (file.size > MAX_IMAGE_BYTES) return "IMAGE MUST BE 8MB OR SMALLER";
  return null;
}

export default function ScorePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [score, setScore] = useState<number | null>(null);
  const [embedding, setEmbedding] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<EmbedJob | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function cancelEmbed() {
    tokenRef.current += 1;
    jobRef.current = null;
    setEmbedding(false);
  }

  function startEmbed(next: File) {
    const token = ++tokenRef.current;
    setEmbedding(false);
    const promise = (async () => {
      let cached: number[] | null = null;
      try {
        cached = await loadScoreEmbedding(next.name, next.size);
      } catch {
        cached = null;
      }
      if (token !== tokenRef.current) throw new ReplacedFile();
      if (cached) return cached;

      setEmbedding(true);
      try {
        const body = new FormData();
        body.set("image", next);
        const res = await fetch("/api/embed-image", { method: "POST", body });
        if (!res.ok) throw new Error(await errorMessage(res, "SCORE FAILED"));
        const data = (await res.json()) as { embedding: number[] };
        try {
          await saveScoreEmbedding({
            name: next.name,
            size: next.size,
            embedding: data.embedding,
          });
        } catch {
          // This session can still score if the browser store fails.
        }
        if (token !== tokenRef.current) throw new ReplacedFile();
        return data.embedding;
      } finally {
        if (token === tokenRef.current) setEmbedding(false);
      }
    })();

    jobRef.current = { token, promise };
    void promise.catch((err: unknown) => {
      if (token !== tokenRef.current || err instanceof ReplacedFile) return;
      if (jobRef.current?.token === token) jobRef.current = null;
      setEmbedding(false);
      setError(err instanceof Error ? err.message : "SCORE FAILED");
    });
  }

  function handleFile(next: File | null) {
    setFile(next);
    setScore(null);
    setError(null);
    if (!next) {
      cancelEmbed();
      return;
    }
    const problem = fileProblem(next);
    if (problem) {
      cancelEmbed();
      setError(problem);
      return;
    }
    startEmbed(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("MISSING IMAGE");
      return;
    }
    const problem = fileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    if (!text.trim()) {
      setError("ENTER SOME TEXT");
      return;
    }
    if (!jobRef.current) startEmbed(file);
    const job = jobRef.current;
    if (!job) {
      setError("MISSING IMAGE");
      return;
    }

    setScoring(true);
    setError(null);
    setScore(null);
    try {
      const [imageEmbedding, textRes] = await Promise.all([
        job.promise,
        fetch(`/api/embed-text?q=${encodeURIComponent(text.trim())}`),
      ]);
      if (job.token !== tokenRef.current) return;
      if (!textRes.ok) throw new Error(await errorMessage(textRes, "SCORE FAILED"));
      const data = (await textRes.json()) as { embedding: number[] };
      setScore(dot(imageEmbedding, data.embedding));
    } catch (err) {
      if (job.token !== tokenRef.current || err instanceof ReplacedFile) return;
      if (jobRef.current?.token === job.token) jobRef.current = null;
      setError(err instanceof Error ? err.message : "SCORE FAILED");
    } finally {
      setScoring(false);
    }
  }

  const waiting = embedding || scoring;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <PageHeader title="IMAGE TEXT SCORE" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="border-2 border-black p-3 file:mr-3 file:border-0 file:bg-black file:px-3 file:py-2 file:font-bold file:text-white"
        />
        <div className="flex border-2 border-black">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="TYPE SOME TEXT..."
            className="flex-1 p-3 outline-none"
          />
          <button
            type="submit"
            disabled={scoring}
            className="cursor-pointer border-l-2 border-black bg-black px-6 font-bold whitespace-nowrap text-white uppercase hover:bg-white hover:text-black"
          >
            {waiting ? "EMBEDDING..." : "SCORE"}
          </button>
        </div>
      </form>

      {waiting && <p className="mt-3 inline-block bg-black px-3 py-2 text-white">EMBEDDING...</p>}
      {error && <p className="mt-3 inline-block bg-black px-3 py-2 text-white">{error}</p>}

      <div className="mt-6 flex flex-wrap items-start gap-6">
        {preview && (
          <img
            src={preview}
            alt=""
            className="h-56 w-56 border-2 border-black bg-neutral-200 object-cover"
          />
        )}
        {score !== null && (
          <p className="text-5xl font-bold tracking-wide">{score.toFixed(3)}</p>
        )}
      </div>
    </main>
  );
}
