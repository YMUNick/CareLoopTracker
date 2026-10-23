"use client";

import { useSyncExternalStore } from "react";
import type { EscalationNotice } from "./escalation";
import { NURSE } from "./seed";
import type { Ticket } from "./types";

// Client cache of the server state. The database is the source of truth: the
// cache is refreshed on load, on window focus, every 30 s and after each change.

export interface SentNotice extends EscalationNotice {
  at: string;
}

export interface DemoState {
  datasetId: string;
  seededAt: string;
  tickets: Ticket[];
  notices: SentNotice[];
  storage: "supabase" | "pglite";
  shared: boolean;
}

export type LoadState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: DemoState };

let state: LoadState = { status: "loading" };
let started = false;
const listeners = new Set<() => void>();

function set(next: LoadState) {
  state = next;
  listeners.forEach((l) => l());
}

export async function refresh(): Promise<void> {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    set({ status: "ready", data: body as DemoState });
  } catch (e) {
    if (state.status !== "ready") set({ status: "error", error: (e as Error).message });
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  refresh();
  window.addEventListener("focus", () => refresh());
  setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, 30_000);
}

function subscribe(l: () => void) {
  listeners.add(l);
  start();
  return () => listeners.delete(l);
}

const SERVER_STATE: LoadState = { status: "loading" };

export function useLoadState(): LoadState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

/** Convenience: the data once loaded, otherwise null. */
export function useDemoState(): DemoState | null {
  const s = useLoadState();
  return s.status === "ready" ? s.data : null;
}

/** Put a ticket returned by the server into the cache, then re-sync (escalations may change). */
export function saveTicket(t: Ticket) {
  if (state.status === "ready") {
    set({ status: "ready", data: { ...state.data, tickets: state.data.tickets.map((x) => (x.id === t.id ? t : x)) } });
  }
  refresh();
}

export async function resetDemo() {
  const res = await fetch("/api/reset", { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  await refresh();
}

export const CURRENT_USER = NURSE;

export async function callApi(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ticket?: Ticket; error?: string; status: number; data: Record<string, unknown> }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ticket: data.ticket, error: data.error, status: res.status, data };
}
