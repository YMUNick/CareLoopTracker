"use client";

import { refresh, useLoadState } from "@/lib/store";

export function Loading() {
  const s = useLoadState();
  if (s.status === "error") {
    return (
      <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
        Could not load data: {s.error}{" "}
        <button className="underline" onClick={() => refresh()}>
          Retry
        </button>
      </p>
    );
  }
  return <p className="text-muted">Loading…</p>;
}

/** Tells viewers where the data lives, and warns when it is not shared. */
export function StorageBadge() {
  const s = useLoadState();
  if (s.status !== "ready") return null;
  const { storage, shared } = s.data;
  if (storage === "supabase") return <span>· shared database (Supabase Postgres)</span>;
  if (shared) return <span>· local database (PGlite)</span>;
  return <span className="font-medium text-danger">· temporary storage: connect Supabase to share and keep data</span>;
}
