import { NextResponse } from "next/server";
import { changeTicket, ChangeRejected } from "@/lib/db/repo";
import { draftContext } from "@/lib/drafts";
import { checkBilingual } from "@/lib/guardrail";
import { jsonError, readJson, withDb } from "@/lib/server";
import { applyAction } from "@/lib/stateMachine";
import type { NotificationRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

// The only route that can move a ticket to "notified". Both safeguards are
// enforced here regardless of what the UI did:
//   1. a named human explicitly confirmed this exact text
//   2. the guardrail finds nothing in either language
// (Delivery via SMS gateway is not connected in the prototype.)

interface SendBody {
  ticketId?: string;
  textEn?: string;
  textAr?: string;
  confirmed?: boolean;
  confirmedBy?: string;
  channel?: NotificationRecord["channel"];
  draftSource?: NotificationRecord["draftSource"];
  rejectedDrafts?: number;
}

export async function POST(req: Request) {
  const b = await readJson<SendBody>(req);
  if (!b?.ticketId) return jsonError(400, "ticketId is required.");
  if (b.confirmed !== true || !b.confirmedBy?.trim()) {
    return jsonError(403, "Human confirmation is required. Nothing was sent.");
  }
  const { ticketId, confirmedBy } = b;
  const textEn = b.textEn ?? "";
  const textAr = b.textAr ?? "";

  return withDb(async (db, ds) => {
    const ticket = await changeTicket(db, ds, ticketId, (t) => {
      const findings = checkBilingual(textEn, textAr, draftContext(t));
      if (findings.length > 0) throw new ChangeRejected("Safety check failed. Nothing was sent.", 422, { findings });
      const now = new Date();
      const notification: NotificationRecord = {
        at: now.toISOString(),
        sentBy: confirmedBy,
        confirmedBy,
        channel: b.channel ?? "sms",
        textEn,
        textAr,
        draftSource: b.draftSource === "azure-openai" ? "azure-openai" : "template",
        rejectedDrafts: Math.max(0, Number(b.rejectedDrafts) || 0),
      };
      const r = applyAction(t, { type: "send_notification", notification }, confirmedBy, now);
      if (!r.ok) throw new ChangeRejected(r.error, 409);
      return r;
    });
    return NextResponse.json({ ticket });
  });
}
