import { NextResponse } from "next/server";
import { sealEvent } from "@/lib/audit";
import { draftContext } from "@/lib/drafts";
import { checkBilingual } from "@/lib/guardrail";
import { jsonError, readTicket } from "@/lib/server";
import { sha256Hex } from "@/lib/sha";
import { applyAction } from "@/lib/stateMachine";
import type { NotificationRecord } from "@/lib/types";

// The only route that can move a ticket to "notified". Both safeguards are
// enforced here regardless of what the UI did:
//   1. a named human explicitly confirmed this exact text
//   2. the guardrail finds nothing in either language
// (Delivery via SMS gateway is not connected in the prototype.)

interface SendBody {
  textEn?: string;
  textAr?: string;
  confirmed?: boolean;
  confirmedBy?: string;
  channel?: NotificationRecord["channel"];
  draftSource?: NotificationRecord["draftSource"];
  rejectedDrafts?: number;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const read = await readTicket(body);
  if ("error" in read) return read.error;
  const { ticket } = read;
  const b = body as SendBody;

  if (b.confirmed !== true || !b.confirmedBy?.trim()) {
    return jsonError(403, "Human confirmation is required. Nothing was sent.");
  }
  const textEn = b.textEn ?? "";
  const textAr = b.textAr ?? "";
  const findings = checkBilingual(textEn, textAr, draftContext(ticket));
  if (findings.length > 0) {
    return jsonError(422, "Safety check failed. Nothing was sent.", { findings });
  }

  const now = new Date();
  const notification: NotificationRecord = {
    at: now.toISOString(),
    sentBy: b.confirmedBy,
    confirmedBy: b.confirmedBy,
    channel: b.channel ?? "sms",
    textEn,
    textAr,
    draftSource: b.draftSource === "azure-openai" ? "azure-openai" : "template",
    rejectedDrafts: Math.max(0, Number(b.rejectedDrafts) || 0),
  };
  const r = applyAction(ticket, { type: "send_notification", notification }, b.confirmedBy, now);
  if (!r.ok) return jsonError(409, r.error);
  const event = await sealEvent(ticket.audit, r.event, sha256Hex);
  return NextResponse.json({ ticket: { ...r.ticket, audit: [...ticket.audit, event] } });
}
