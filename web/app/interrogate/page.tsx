"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../../components/page-header";
import { errorMessage } from "../../lib/error-message";

type Result = {
  sourceUrl: string;
  caption: string;
  score: number;
};

export default function InterrogatePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

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
    setLoading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("image", file);
      const res = await fetch("/api/interrogate", { method: "POST", body });
      if (!res.ok) throw new Error(await errorMessage(res, "INTERROGATE FAILED"));
      const data = (await res.json()) as { results: Result[] };
      setResults(data.results);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "INTERROGATE FAILED");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <PageHeader title="INTERROGATE" />

      <form onSubmit={handleSubmit} className="flex flex-wrap items-stretch gap-3">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResults([]);
            setSearched(false);
          }}
          className="min-w-0 flex-1 border-2 border-black p-3 file:mr-3 file:border-0 file:bg-black file:px-3 file:py-2 file:font-bold file:text-white"
        />
        <button
          type="submit"
          disabled={loading}
          className="cursor-pointer border-2 border-black bg-black px-6 font-bold text-white uppercase hover:bg-white hover:text-black"
        >
          {loading ? "..." : "INTERROGATE"}
        </button>
      </form>

      <p className="mt-3 text-xs">CAPTIONS OF THE CLOSEST IMAGES IN THE CORPUS.</p>

      {error && <p className="mt-3 inline-block bg-black px-3 py-2 text-white">{error}</p>}
      {searched && !loading && !error && results.length === 0 && (
        <p className="mt-3 inline-block bg-black px-3 py-2 text-white">NO RESULTS</p>
      )}

      {preview && (
        <img
          src={preview}
          alt=""
          className="mt-6 h-56 w-56 border-2 border-black bg-neutral-200 object-cover"
        />
      )}

      {results.length > 0 && (
        <ol className="mt-6 border-2 border-black">
          {results.map((r, i) => (
            <li
              key={`${r.sourceUrl}-${i}`}
              className="flex items-baseline justify-between gap-4 border-b border-black last:border-b-0"
            >
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="p-3 underline decoration-1 underline-offset-2"
              >
                {r.caption}
              </a>
              <span className="p-3 text-xs font-bold">{r.score.toFixed(3)}</span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
