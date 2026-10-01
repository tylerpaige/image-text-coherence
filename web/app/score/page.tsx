"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../../components/page-header";
import { errorMessage } from "../../lib/error-message";

export default function ScorePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("MISSING IMAGE");
      return;
    }
    if (!text.trim()) {
      setError("ENTER SOME TEXT");
      return;
    }
    setLoading(true);
    setError(null);
    setScore(null);
    try {
      const body = new FormData();
      body.set("image", file);
      body.set("text", text.trim());
      const res = await fetch("/api/score", { method: "POST", body });
      if (!res.ok) throw new Error(await errorMessage(res, "SCORE FAILED"));
      const data = (await res.json()) as { score: number };
      setScore(data.score);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SCORE FAILED");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <PageHeader title="IMAGE TEXT SCORE" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setScore(null);
          }}
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
            disabled={loading}
            className="cursor-pointer border-l-2 border-black bg-black px-6 font-bold text-white uppercase hover:bg-white hover:text-black"
          >
            {loading ? "..." : "SCORE"}
          </button>
        </div>
      </form>

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
