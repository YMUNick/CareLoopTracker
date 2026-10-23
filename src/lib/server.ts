import { NextResponse } from "next/server";
import { verifyChain } from "./audit";
import { sha256Hex } from "./sha";
import type { Ticket } from "./types";

// Prototype note: tickets live in the browser (localStorage) so the demo runs
// with zero setup. The server is still the only place that can produce a valid
// state change: it re-verifies the audit chain it receives, re-runs the state
// machine and guardrail, and seals the new audit event. Moving storage to
// Postgres (with DB-level constraints) is the planned next step.

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function readTicket(body: unknown): Promise<{ ticket: Ticket } | { error: Response }> {
  const ticket = (body as { ticket?: Ticket })?.ticket;
  if (!ticket || typeof ticket.id !== "string" || !Array.isArray(ticket.audit)) {
    return { error: jsonError(400, "Request must include a ticket.") };
  }
  const chain = await verifyChain(ticket.audit, sha256Hex);
  if (!chain.ok) {
    return { error: jsonError(409, `Audit trail failed verification at event #${chain.brokenAt}. Change refused.`) };
  }
  const last = ticket.audit[ticket.audit.length - 1];
  if (!last || last.to !== ticket.status) {
    return { error: jsonError(409, "Ticket status does not match its audit trail. Change refused.") };
  }
  return { ticket };
}
