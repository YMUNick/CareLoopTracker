import { describe, expect, it } from "vitest";
import { applyAction, closeReasonsFor, type Action } from "../src/lib/stateMachine";
import type { Ticket } from "../src/lib/types";
import { local, makeTicket, notification } from "./helpers";

const now = local(2026, 10, 20, 12);

function run(t: Ticket, ...actions: Action[]): Ticket {
  for (const a of actions) {
    const r = applyAction(t, a, "N", now);
    if (!r.ok) throw new Error(r.error);
    t = r.ticket;
  }
  return t;
}

describe("state machine", () => {
  it("walks the happy path to closure", () => {
    const t = run(
      makeTicket(),
      { type: "assign", assignee: "N" },
      { type: "send_notification", notification: notification() },
      { type: "record_consult", outcome: "needs_referral" },
      { type: "refer", specialty: "Audiology" },
      { type: "close", reason: "under_specialist_care" },
    );
    expect(t.status).toBe("closed");
    expect(t.closeReason).toBe("under_specialist_care");
  });

  it.each<[string, Partial<Ticket>, Action]>([
    ["close without notifying (assigned → closed as rescreen_normal)", { status: "assigned", assignee: "N" }, { type: "close", reason: "rescreen_normal" }],
    ["notify before assignment", {}, { type: "send_notification", notification: notification() }],
    ["record re-screen before notifying", { status: "assigned", assignee: "N" }, { type: "record_consult", outcome: "rescreen_normal" }],
    ["refer when re-screen was normal", { status: "consulted", assignee: "N", consultOutcome: "rescreen_normal" }, { type: "refer", specialty: "ENT" }],
    ["close as normal when re-screen needs referral", { status: "consulted", assignee: "N", consultOutcome: "needs_referral" }, { type: "close", reason: "rescreen_normal" }],
    ["send without human confirmation", { status: "assigned", assignee: "N" }, { type: "send_notification", notification: notification({ confirmedBy: "" }) }],
    ["send with an empty Arabic text", { status: "assigned", assignee: "N" }, { type: "send_notification", notification: notification({ textAr: " " }) }],
    ["any change to a closed ticket", { status: "closed", closeReason: "deceased" }, { type: "reassign", assignee: "X" }],
    ["unreachable with fewer than 3 attempts", { status: "assigned", assignee: "N" }, { type: "close", reason: "unreachable" }],
    ["superseded without a note", { status: "notified", assignee: "N" }, { type: "close", reason: "superseded" }],
  ])("rejects: %s", (_name, over, action) => {
    const r = applyAction(makeTicket(over), action, "N", now);
    expect(r.ok).toBe(false);
  });

  it("requires an actor", () => {
    expect(applyAction(makeTicket(), { type: "assign", assignee: "N" }, " ", now).ok).toBe(false);
  });

  it("allows unreachable after 3 documented attempts", () => {
    let t = run(makeTicket(), { type: "assign", assignee: "N" });
    t = run(t, ...[1, 2, 3].map((i) => ({ type: "log_contact_attempt", note: `try ${i}` }) as Action));
    expect(closeReasonsFor(t)).toContain("unreachable");
    expect(run(t, { type: "close", reason: "unreachable" }).status).toBe("closed");
  });

  it("restarts the SLA clock only when the stage changes", () => {
    const t = makeTicket({ status: "assigned", assignee: "N" });
    const later = local(2026, 10, 21);
    const r1 = applyAction(t, { type: "log_contact_attempt", note: "x" }, "N", later);
    expect(r1.ok && r1.ticket.stageEnteredAt).toBe(t.stageEnteredAt);
    const r2 = applyAction(t, { type: "send_notification", notification: notification() }, "N", later);
    expect(r2.ok && r2.ticket.stageEnteredAt).toBe(later.toISOString());
  });

  it("emits one audit entry per accepted change", () => {
    const r = applyAction(makeTicket(), { type: "assign", assignee: "N" }, "Sup", now);
    expect(r.ok && r.event).toMatchObject({ actor: "Sup", action: "assign", from: "abnormal", to: "assigned" });
  });
});
