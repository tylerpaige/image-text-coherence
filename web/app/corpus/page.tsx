"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "../../components/page-header";
import { clearCorpus, loadCorpus, MAX_CORPUS_IMAGES, saveCorpusImage } from "../../lib/corpus-db";
import { errorMessage } from "../../lib/error-message";
import { dot } from "../../lib/similarity";

type Item = {
  id: string;
  name: string;
  url: string;
  embedding: number[];
};

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export default function CorpusPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [ranked, setRanked] = useState<{ item: Item; score: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadCorpus()
      .then((rows) => {
        const loaded = rows.map((row) => ({
          id: row.id,
          name: row.name,
          url: URL.createObjectURL(row.blob),
          embedding: row.embedding,
        }));
        if (cancelled) {
          for (const item of loaded) URL.revokeObjectURL(item.url);
          return;
        }
        urlsRef.current.push(...loaded.map((item) => item.url));
        setItems(loaded);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setError("COULD NOT LOAD SAVED IMAGES");
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
    };
  }, []);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = [...list];
    if (items.length + files.length > MAX_CORPUS_IMAGES) {
      setError("100 IMAGES MAX");
      return;
    }
    const invalid = files.find((file) => !ALLOWED.has(file.type) && !/\.(jpe?g|png|webp|gif)$/i.test(file.name));
    if (invalid) {
      setError("USE A JPEG, PNG, WEBP, OR GIF");
      return;
    }
    const oversized = files.find((file) => file.size > 8 * 1024 * 1024);
    if (oversized) {
      setError("IMAGE MUST BE 8MB OR SMALLER");
      return;
    }

    setError(null);
    setRanked(null);
    setNotice(null);
    setBusy(true);
    let embedded = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setNotice(`EMBEDDING ${i + 1} OF ${files.length}`);
        const body = new FormData();
        body.set("image", file);
        const res = await fetch("/api/embed-image", { method: "POST", body });
        if (!res.ok) throw new Error(await errorMessage(res, "UPLOAD FAILED"));
        const data = (await res.json()) as { embedding: number[] };
        const record = {
          id: crypto.randomUUID(),
          name: file.name,
          createdAt: Date.now() + i,
          blob: file,
          embedding: data.embedding,
        };
        await saveCorpusImage(record);
        const url = URL.createObjectURL(file);
        urlsRef.current.push(url);
        setItems((current) => [
          ...current,
          {
            id: record.id,
            name: record.name,
            url,
            embedding: record.embedding,
          },
        ]);
        embedded += 1;
      }
      setNotice(embedded === 1 ? "EMBEDDED 1 IMAGE" : `EMBEDDED ${embedded} IMAGES`);
    } catch (err) {
      setNotice(embedded > 0 ? `EMBEDDED ${embedded} OF ${files.length}` : null);
      setError(err instanceof Error ? err.message : "UPLOAD FAILED");
    } finally {
      setBusy(false);
    }
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    if (items.length === 0) {
      setError("ADD IMAGES FIRST");
      return;
    }
    setSearching(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/embed-text?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) throw new Error(await errorMessage(res, "SEARCH FAILED"));
      const data = (await res.json()) as { embedding: number[] };
      const next = items
        .map((item) => ({ item, score: dot(item.embedding, data.embedding) }))
        .sort((a, b) => b.score - a.score);
      setRanked(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SEARCH FAILED");
    } finally {
      setSearching(false);
    }
  }

  async function handleClear() {
    await clearCorpus();
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
    setItems([]);
    setRanked(null);
    setError(null);
    setNotice(null);
  }

  const shown = ranked
    ? ranked.map(({ item, score }) => ({ ...item, score }))
    : items.map((item) => ({ ...item, score: null as number | null }));

  return (
    <main className="mx-auto max-w-5xl p-6">
      <PageHeader title="MY CORPUS" />

      <div className="flex flex-wrap items-stretch gap-3">
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          disabled={!ready || busy}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
          className="min-w-0 flex-1 border-2 border-black p-3 file:mr-3 file:border-0 file:bg-black file:px-3 file:py-2 file:font-bold file:text-white"
        />
        <button
          type="button"
          onClick={() => void handleClear()}
          disabled={!ready || busy || items.length === 0}
          className="cursor-pointer border-2 border-black bg-black px-6 font-bold text-white uppercase hover:bg-white hover:text-black disabled:opacity-40"
        >
          CLEAR
        </button>
      </div>

      <p className="mt-3 text-xs">
        {items.length} / {MAX_CORPUS_IMAGES} IMAGES
      </p>
      <p className="mt-1 text-xs">IMAGES STAY IN THIS BROWSER.</p>
      {notice && <p className="mt-3 inline-block bg-black px-3 py-2 text-white">{notice}</p>}

      <form onSubmit={handleSearch} className="mt-4 flex border-2 border-black">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="TYPE A SEARCH..."
          className="flex-1 p-3 outline-none"
        />
        <button
          type="submit"
          disabled={searching || busy}
          className="cursor-pointer border-l-2 border-black bg-black px-6 font-bold text-white uppercase hover:bg-white hover:text-black"
        >
          {searching ? "..." : "SEARCH"}
        </button>
      </form>

      {error && <p className="mt-3 inline-block bg-black px-3 py-2 text-white">{error}</p>}

      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {shown.map((item) => (
          <figure key={item.id} className="border-2 border-black">
            <img
              src={item.url}
              alt={item.name}
              className="h-56 w-full border-b-2 border-black bg-neutral-200 object-cover"
            />
            <figcaption className="border-b border-black p-2 text-xs">{item.name}</figcaption>
            {item.score !== null && <p className="p-2 text-xs font-bold">{item.score.toFixed(3)}</p>}
          </figure>
        ))}
      </div>
    </main>
  );
}
