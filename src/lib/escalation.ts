import { addBusinessDays, businessDaysBetween } from "./time";
import type { Status, Ticket } from "./types";

// Escalation is derived, not pushed: the level is a pure function of the
// current stage, when it started, and "now". A scheduler only has to call
// `pendingNotices` and record what it sent; running it twice, or after a
// missed day, yields the same set of notices (each keyed uniquely).

export const SLA_BUSINESS_DAYS: Record<Exclude<Status, "closed">, number> = {
  abnormal: 1, // assign an owner
  assigned: 3, // notify the family
  notified: 10, // complete confirmatory re-screen
  consulted: 5, // make the referral (or close)
  referred: 20, // specialist assessment confirmed
};

export type EscalationLevel = 0 | 1 | 2 | 3;
export const LEVEL_LABEL: Record<EscalationLevel, string> = {
  0: "On track",
  1: "Due soon",
  2: "Overdue",
  3: "Escalated to supervisor",
};

export interface EscalationState {
  level: EscalationLevel;
  dueAt: Date | null;
  businessDaysOverdue: number;
}

export function escalationOf(ticket: Ticket, now: Date): EscalationState {
  if (ticket.status === "closed") return { level: 0, dueAt: null, businessDaysOverdue: 0 };
  const dueAt = addBusinessDays(new Date(ticket.stageEnteredAt), SLA_BUSINESS_DAYS[ticket.status]);
  if (now <= dueAt) {
    const left = businessDaysBetween(now, dueAt);
    return { level: left <= 1 ? 1 : 0, dueAt, businessDaysOverdue: 0 };
  }
  const over = Math.max(1, businessDaysBetween(dueAt, now));
  return { level: over >= 2 ? 3 : 2, dueAt, businessDaysOverdue: over };
}

export interface EscalationNotice {
  key: string; // unique per (ticket, stage instance, level)
  ticketId: string;
  level: 2 | 3;
  to: string;
}

export function noticesFor(ticket: Ticket, now: Date): EscalationNotice[] {
  const { level } = escalationOf(ticket, now);
  const out: EscalationNotice[] = [];
  const base = `${ticket.id}:${ticket.status}:${ticket.stageEnteredAt}`;
  if (level >= 2) out.push({ key: `${base}:2`, ticketId: ticket.id, level: 2, to: ticket.assignee ?? ticket.supervisor });
  if (level >= 3) out.push({ key: `${base}:3`, ticketId: ticket.id, level: 3, to: ticket.supervisor });
  return out;
}

/** Notices due now that have not been sent yet. Idempotent given `sentKeys`. */
export function pendingNotices(tickets: Ticket[], now: Date, sentKeys: ReadonlySet<string>): EscalationNotice[] {
  return tickets.flatMap((t) => noticesFor(t, now)).filter((n) => !sentKeys.has(n.key));
}

/** Priority for the nurse's "today" list: highest level first, then most overdue, then soonest due. */
export function triage(tickets: Ticket[], now: Date): { ticket: Ticket; esc: EscalationState }[] {
  return tickets
    .filter((t) => t.status !== "closed")
    .map((ticket) => ({ ticket, esc: escalationOf(ticket, now) }))
    .sort(
      (a, b) =>
        b.esc.level - a.esc.level ||
        b.esc.businessDaysOverdue - a.esc.businessDaysOverdue ||
        (a.esc.dueAt?.getTime() ?? 0) - (b.esc.dueAt?.getTime() ?? 0),
    );
}
