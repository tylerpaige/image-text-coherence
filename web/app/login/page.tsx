"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
      } else {
        setError("WRONG PASSWORD");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <form onSubmit={handleSubmit} className="flex w-80 flex-col border-2 border-black">
        <h1 className="border-b-2 border-black p-4 text-center text-lg tracking-widest uppercase">
          IMAGE TEXT COHERENCE
        </h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="PASSWORD"
          autoFocus
          className="border-b-2 border-black p-3 outline-none"
        />
        <button
          type="submit"
          disabled={submitting}
          className="cursor-pointer bg-black p-3 font-bold text-white uppercase hover:bg-white hover:text-black"
        >
          {submitting ? "..." : "ENTER"}
        </button>
      </form>
      {error && <p className="mt-3 bg-black px-3 py-2 text-white">{error}</p>}
    </main>
  );
}
