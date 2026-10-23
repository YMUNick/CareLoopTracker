import type { PendingAuditEvent } from "./stateMachine";
import type { AuditEvent } from "./types";

// Append-only, hash-chained audit trail. Each event's hash covers the previous
// hash, so editing or deleting any past event breaks every hash after it.
// Hashing is injected so the same code runs with node:crypto on the server
// and Web Crypto in the browser (for the "verify chain" badge).

export const GENESIS = "0".repeat(64);

export type Sha256Hex = (input: string) => Promise<string>;

/** JSON with object keys sorted and undefined values dropped, so storage (e.g. Postgres jsonb key reordering) cannot change the hash. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(",")}}`;
}

export function canonical(e: Omit<AuditEvent, "hash">): string {
  return stableStringify([e.seq, new Date(e.at).toISOString(), e.actor, e.action, e.from, e.to, e.detail ?? null, e.prevHash]);
}

export async function sealEvent(chain: AuditEvent[], pending: PendingAuditEvent, sha: Sha256Hex): Promise<AuditEvent> {
  const prev = chain[chain.length - 1];
  const base = { ...pending, seq: chain.length + 1, prevHash: prev ? prev.hash : GENESIS };
  return { ...base, hash: await sha(canonical(base)) };
}

export async function verifyChain(chain: AuditEvent[], sha: Sha256Hex): Promise<{ ok: boolean; brokenAt?: number }> {
  let prevHash = GENESIS;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    if (e.seq !== i + 1 || e.prevHash !== prevHash) return { ok: false, brokenAt: i + 1 };
    const { hash, ...rest } = e;
    if ((await sha(canonical(rest))) !== hash) return { ok: false, brokenAt: i + 1 };
    prevHash = hash;
  }
  return { ok: true };
}
