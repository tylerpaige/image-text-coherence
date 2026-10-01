"use client";

import { useState, type FormEvent } from "react";
import { PageHeader } from "../components/page-header";

type Result = {
  sourceUrl: string;
  caption: string;
  score: number;
};

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults(data.results);
      setSearched(true);
    } catch {
      setError("SEARCH FAILED");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <PageHeader title="LAION SEARCH" />

      <form onSubmit={handleSubmit} className="flex border-2 border-black">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="TYPE A SEARCH..."
          autoFocus
          className="flex-1 p-3 outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="cursor-pointer border-l-2 border-black bg-black px-6 font-bold text-white uppercase hover:bg-white hover:text-black"
        >
          {loading ? "..." : "SEARCH"}
        </button>
      </form>

      {error && <p className="mt-3 inline-block bg-black px-3 py-2 text-white">{error}</p>}
      {searched && !loading && !error && results.length === 0 && (
        <p className="mt-3 inline-block bg-black px-3 py-2 text-white">NO RESULTS</p>
      )}

      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {results.map((r, i) => (
          <a
            key={`${r.sourceUrl}-${i}`}
            className="block border-2 border-black"
            href={r.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={r.sourceUrl}
              alt={r.caption}
              loading="lazy"
              className="h-56 w-full border-b-2 border-black bg-neutral-200 object-cover"
            />
            <p className="border-b border-black p-2 text-xs">{r.caption}</p>
            <p className="p-2 text-xs font-bold">{r.score.toFixed(3)}</p>
          </a>
        ))}
      </div>
    </main>
  );
}
