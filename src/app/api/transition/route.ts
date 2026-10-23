import { NextResponse } from "next/server";
import { changeTicket, ChangeRejected } from "@/lib/db/repo";
import { jsonError, readJson, withDb } from "@/lib/server";
import { applyAction, type Action } from "@/lib/stateMachine";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ ticketId?: string; action?: Action; actor?: string }>(req);
  if (!body?.ticketId || !body.action || typeof body.action.type !== "string") return jsonError(400, "ticketId and action are required.");
  const { ticketId, action, actor } = body;
  if (action.type === "send_notification") {
    return jsonError(403, "Notifications can only be sent through /api/send, which enforces review and safety checks.");
  }
  return withDb(async (db, ds) => {
    const ticket = await changeTicket(db, ds, ticketId, (t) => {
      const r = applyAction(t, action, actor ?? "", new Date());
      if (!r.ok) throw new ChangeRejected(r.error, 409);
      return r;
    });
    return NextResponse.json({ ticket });
  });
}
