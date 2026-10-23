import { NextResponse } from "next/server";
import { sealEvent } from "@/lib/audit";
import { readTicket, jsonError } from "@/lib/server";
import { sha256Hex } from "@/lib/sha";
import { applyAction, type Action } from "@/lib/stateMachine";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const read = await readTicket(body);
  if ("error" in read) return read.error;

  const { action, actor } = body as { action?: Action; actor?: string };
  if (!action || typeof action.type !== "string") return jsonError(400, "Missing action.");
  if (action.type === "send_notification") {
    return jsonError(403, "Notifications can only be sent through /api/send, which enforces review and safety checks.");
  }

  const r = applyAction(read.ticket, action, actor ?? "", new Date());
  if (!r.ok) return jsonError(409, r.error);
  const event = await sealEvent(read.ticket.audit, r.event, sha256Hex);
  return NextResponse.json({ ticket: { ...r.ticket, audit: [...read.ticket.audit, event] } });
}
