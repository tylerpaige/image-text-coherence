"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../../components/page-header";
import { errorMessage } from "../../lib/error-message";

type Match = { text: string; score: number };

export default function InterrogatePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
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
    setLoading(true);
    setError(null);
    setMatches([]);
    try {
      const body = new FormData();
      body.set("image", file);
      const res = await fetch("/api/interrogate", { method: "POST", body });
      if (!res.ok) throw new Error(await errorMessage(res, "INTERROGATE FAILED"));
      const data = (await res.json()) as { matches: Match[] };
      setMatches(data.matches);
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
            setMatches([]);
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

      <p className="mt-3 text-xs">THE CLOSEST PHRASES FROM A FIXED LIST.</p>

      {error && <p className="mt-3 inline-block bg-black px-3 py-2 text-white">{error}</p>}

      <div className="mt-6 flex flex-wrap items-start gap-6">
        {preview && (
          <img
            src={preview}
            alt=""
            className="h-56 w-56 border-2 border-black bg-neutral-200 object-cover"
          />
        )}
        {matches.length > 0 && (
          <ol className="min-w-72 flex-1 border-2 border-black">
            {matches.map((match) => (
              <li
                key={match.text}
                className="flex items-baseline justify-between gap-4 border-b border-black p-3 last:border-b-0"
              >
                <span>{match.text}</span>
                <span className="font-bold">{match.score.toFixed(3)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
