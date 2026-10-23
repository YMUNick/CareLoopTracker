import { describe, expect, it } from "vitest";
import { verifyChain } from "../src/lib/audit";
import { buildSeed } from "../src/lib/seed";
import { sha256Hex } from "../src/lib/sha";
import { local } from "./helpers";

describe("seed + hash-chained audit trail", async () => {
  const tickets = await buildSeed(local(2026, 10, 26, 9), sha256Hex);

  it("builds every seeded ticket through the state machine with a valid chain", async () => {
    expect(tickets.length).toBeGreaterThan(10);
    for (const t of tickets) expect(await verifyChain(t.audit, sha256Hex)).toEqual({ ok: true });
  });

  it("detects an edited event", async () => {
    const chain = structuredClone(tickets.find((t) => t.audit.length > 2)!.audit);
    chain[1].actor = "Someone else";
    expect(await verifyChain(chain, sha256Hex)).toEqual({ ok: false, brokenAt: 2 });
  });

  it("detects a deleted event", async () => {
    const chain = structuredClone(tickets.find((t) => t.audit.length > 2)!.audit);
    chain.splice(1, 1);
    expect((await verifyChain(chain, sha256Hex)).ok).toBe(false);
  });
});
