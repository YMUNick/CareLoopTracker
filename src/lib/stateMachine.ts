import type {
  CloseReason,
  ConsultOutcome,
  NotificationRecord,
  Status,
  Ticket,
} from "./types";

// Every change to a ticket goes through `applyAction`. It is pure: it either
// returns the next ticket plus an (unhashed) audit entry, or a rejection with
// the precondition that failed. The API routes run it server-side, so hiding a
// button in the UI is never the only safeguard.

export type Action =
  | { type: "assign"; assignee: string }
  | { type: "reassign"; assignee: string }
  | { type: "log_contact_attempt"; note: string }
  | { type: "send_notification"; notification: NotificationRecord }
  | { type: "set_appointment"; at: string; place: string }
  | { type: "record_consult"; outcome: ConsultOutcome }
  | { type: "refer"; specialty: string }
  | { type: "close"; reason: CloseReason; note?: string };

export type ActionType = Action["type"];

export interface PendingAuditEvent {
  at: string;
  actor: string;
  action: ActionType | "create";
  from: Status | null;
  to: Status;
  detail?: Record<string, unknown>;
}

export type ApplyResult =
  | { ok: true; ticket: Ticket; event: PendingAuditEvent }
  | { ok: false; error: string };

export const UNREACHABLE_MIN_ATTEMPTS = 3;
const ANY_OPEN: Status[] = ["abnormal", "assigned", "notified", "consulted", "referred"];
const NOTE_REQUIRED: CloseReason[] = ["transferred_out", "deceased", "superseded"];

/** Which statuses each close reason may be used from (beyond extra checks below). */
const CLOSE_FROM: Record<CloseReason, Status[]> = {
  rescreen_normal: ["consulted"],
  under_specialist_care: ["referred"],
  declined: ["notified", "consulted", "referred"],
  unreachable: ["assigned"],
  transferred_out: ANY_OPEN,
  deceased: ANY_OPEN,
  superseded: ANY_OPEN,
};

function reject(error: string): ApplyResult {
  return { ok: false, error };
}

export function applyAction(
  ticket: Ticket,
  action: Action,
  actor: string,
  now: Date,
): ApplyResult {
  const at = now.toISOString();
  const from = ticket.status;
  if (!actor.trim()) return reject("An actor is required for every change.");
  if (from === "closed") return reject("Ticket is closed; no further changes are allowed.");

  const move = (patch: Partial<Ticket>, to: Status, detail?: Record<string, unknown>): ApplyResult => {
    const next: Ticket = {
      ...ticket,
      ...patch,
      status: to,
      // The SLA clock restarts only when the stage actually changes.
      stageEnteredAt: to !== from ? at : ticket.stageEnteredAt,
    };
    return { ok: true, ticket: next, event: { at, actor, action: action.type, from, to, detail } };
  };

  switch (action.type) {
    case "assign":
      if (from !== "abnormal") return reject(`Cannot assign from "${from}"; use reassign.`);
      if (!action.assignee.trim()) return reject("Assignee is required.");
      return move({ assignee: action.assignee }, "assigned", { assignee: action.assignee });

    case "reassign":
      if (from === "abnormal") return reject("Ticket has no owner yet; use assign.");
      if (!action.assignee.trim()) return reject("Assignee is required.");
      return move({ assignee: action.assignee }, from, { from: ticket.assignee, assignee: action.assignee });

    case "log_contact_attempt":
      if (from !== "assigned") return reject("Contact attempts are logged only before the family is notified.");
      if (!action.note.trim()) return reject("Describe the contact attempt.");
      return move(
        { contactAttempts: [...ticket.contactAttempts, { at, by: actor, note: action.note }] },
        from,
        { attempt: ticket.contactAttempts.length + 1, note: action.note },
      );

    case "send_notification": {
      if (from !== "assigned") return reject(`Cannot notify from "${from}"; ticket must be assigned first.`);
      const n = action.notification;
      if (!n.confirmedBy.trim()) return reject("A human must confirm the message before it is sent.");
      if (!n.textEn.trim() || !n.textAr.trim()) return reject("Both English and Arabic texts are required.");
      return move({ notification: n }, "notified", {
        channel: n.channel,
        confirmedBy: n.confirmedBy,
        draftSource: n.draftSource,
        rejectedDrafts: n.rejectedDrafts,
      });
    }

    case "set_appointment":
      if (from !== "notified") return reject("Appointments are booked after the family is notified.");
      if (Number.isNaN(Date.parse(action.at)) || !action.place.trim()) return reject("Valid time and place required.");
      return move({ appointment: { at: action.at, place: action.place } }, from, { at: action.at, place: action.place });

    case "record_consult":
      if (from !== "notified") return reject(`Cannot record re-screen from "${from}"; family must be notified first.`);
      return move({ consultOutcome: action.outcome }, "consulted", { outcome: action.outcome });

    case "refer":
      if (from !== "consulted") return reject(`Cannot refer from "${from}".`);
      if (ticket.consultOutcome !== "needs_referral") return reject("Re-screen outcome does not call for a referral.");
      if (!action.specialty.trim()) return reject("Specialty is required.");
      return move({ referral: { specialty: action.specialty, at } }, "referred", { specialty: action.specialty });

    case "close": {
      const { reason } = action;
      if (!CLOSE_FROM[reason]) return reject("A valid close reason is required.");
      if (!CLOSE_FROM[reason].includes(from)) return reject(`Close reason "${reason}" is not allowed from "${from}".`);
      if (reason === "rescreen_normal" && ticket.consultOutcome !== "rescreen_normal")
        return reject("Re-screen outcome was not normal.");
      if (reason === "unreachable" && ticket.contactAttempts.length < UNREACHABLE_MIN_ATTEMPTS)
        return reject(`At least ${UNREACHABLE_MIN_ATTEMPTS} documented contact attempts are required.`);
      if (NOTE_REQUIRED.includes(reason) && !action.note?.trim())
        return reject(`A note is required when closing as "${reason}".`);
      return move({ closeReason: reason }, "closed", { reason, note: action.note });
    }
  }
}

/** Actions worth offering in the UI for the current state (the server still re-checks). */
export function availableActions(ticket: Ticket): ActionType[] {
  switch (ticket.status) {
    case "abnormal":
      return ["assign", "close"];
    case "assigned":
      return ["send_notification", "log_contact_attempt", "reassign", "close"];
    case "notified":
      return ["set_appointment", "record_consult", "reassign", "close"];
    case "consulted":
      return ticket.consultOutcome === "needs_referral" ? ["refer", "reassign", "close"] : ["reassign", "close"];
    case "referred":
      return ["reassign", "close"];
    case "closed":
      return [];
  }
}

export function closeReasonsFor(ticket: Ticket): CloseReason[] {
  return (Object.keys(CLOSE_FROM) as CloseReason[]).filter((r) => {
    if (!CLOSE_FROM[r].includes(ticket.status)) return false;
    if (r === "rescreen_normal") return ticket.consultOutcome === "rescreen_normal";
    if (r === "unreachable") return ticket.contactAttempts.length >= UNREACHABLE_MIN_ATTEMPTS;
    return true;
  });
}
