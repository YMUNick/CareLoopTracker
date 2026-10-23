"use client";

import { useSyncExternalStore } from "react";
import { pendingNotices, type EscalationNotice } from "./escalation";
import { buildSeed, NURSE } from "./seed";
import { sha256Hex } from "./sha";
import type { Ticket } from "./types";

// Browser-side persistence for the zero-setup demo. All state changes still go
// through the API routes (see src/lib/server.ts); this module only stores what
// the server returned.

const KEY = "care-loop-tracker:v1";

export interface SentNotice extends EscalationNotice {
  at: string;
}

export interface DemoState {
  tickets: Ticket[];
  notices: SentNotice[];
  seededAt: string;
}

let state: DemoState | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage blocked (private mode etc.): the demo still works for this tab.
  }
}

async function seed(): Promise<DemoState> {
  return { tickets: await buildSeed(new Date(), sha256Hex), notices: [], seededAt: new Date().toISOString() };
}

function ensureLoaded() {
  if (state || loading || typeof window === "undefined") return;
  loading = (async () => {
    let loaded: DemoState | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) loaded = JSON.parse(raw);
    } catch {
      loaded = null;
    }
    state = loaded ?? (await seed());
    runEscalations();
    persist();
    loading = null;
    emit();
  })();
}

function subscribe(l: () => void) {
  listeners.add(l);
  ensureLoaded();
  return () => listeners.delete(l);
}

export function useDemoState(): DemoState | null {
  return useSyncExternalStore(subscribe, () => state, () => null);
}

export function saveTicket(t: Ticket) {
  if (!state) return;
  state = { ...state, tickets: state.tickets.map((x) => (x.id === t.id ? t : x)) };
  runEscalations();
  persist();
  emit();
}

/** Simulated scheduler run: records each due escalation notice exactly once. */
export function runEscalations() {
  if (!state) return;
  const now = new Date();
  const fresh = pendingNotices(state.tickets, now, new Set(state.notices.map((n) => n.key)));
  if (fresh.length) {
    state = { ...state, notices: [...state.notices, ...fresh.map((n) => ({ ...n, at: now.toISOString() }))] };
  }
}

export async function resetDemo() {
  state = await seed();
  runEscalations();
  persist();
  emit();
}

export const CURRENT_USER = NURSE;

export async function callApi(path: string, body: Record<string, unknown>): Promise<{ ticket?: Ticket; error?: string; status: number; data: Record<string, unknown> }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ticket: data.ticket, error: data.error, status: res.status, data };
}
