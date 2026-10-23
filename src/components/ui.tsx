import Link from "next/link";
import { escalationOf, LEVEL_LABEL, type EscalationLevel } from "@/lib/escalation";
import { formatLocalDate } from "@/lib/time";
import { STATUS_LABEL, type Status, type Ticket } from "@/lib/types";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-border bg-surface p-4 ${className}`}>{children}</section>;
}

const LEVEL_STYLE: Record<EscalationLevel, string> = {
  0: "bg-ok-soft text-ok",
  1: "bg-warn-soft text-warn",
  2: "bg-danger-soft text-danger",
  3: "bg-danger text-white",
};

export function EscalationBadge({ level }: { level: EscalationLevel }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${LEVEL_STYLE[level]}`}>{LEVEL_LABEL[level]}</span>;
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className="rounded bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">{STATUS_LABEL[status]}</span>;
}

export function nextStep(t: Ticket): string {
  switch (t.status) {
    case "abnormal":
      return "Assign an owner";
    case "assigned":
      return "Notify the family";
    case "notified":
      return "Book and record the repeat screen";
    case "consulted":
      return t.consultOutcome === "needs_referral" ? "Refer to a specialist" : "Close: repeat screen normal";
    case "referred":
      return "Confirm the specialist assessment";
    case "closed":
      return "—";
  }
}

export function dueText(t: Ticket, now: Date): string {
  const e = escalationOf(t, now);
  if (!e.dueAt) return "";
  if (e.businessDaysOverdue > 0) return `${e.businessDaysOverdue} business day${e.businessDaysOverdue > 1 ? "s" : ""} overdue`;
  return `Due ${formatLocalDate(e.dueAt.toISOString())}`;
}

export function TicketRow({ t, now }: { t: Ticket; now: Date }) {
  const e = escalationOf(t, now);
  return (
    <Link
      href={`/tickets/${t.id}`}
      className={`block rounded-lg border bg-surface p-4 hover:border-primary ${e.level >= 2 ? "border-danger/40" : "border-border"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t.patient.displayName}</span>
        <span className="text-xs text-muted">{t.id}</span>
        <StatusBadge status={t.status} />
        {t.status !== "closed" && <EscalationBadge level={e.level} />}
        <span className={`ml-auto text-sm ${e.level >= 2 ? "font-medium text-danger" : "text-muted"}`}>{dueText(t, now)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
        <span>
          Next: <span className="text-foreground">{nextStep(t)}</span>
        </span>
        <span>Owner: {t.assignee ?? <span className="text-danger">unassigned</span>}</span>
        <span>
          {t.result.test} · {t.result.ear} ear · screened {formatLocalDate(t.result.performedAt)}
        </span>
      </div>
    </Link>
  );
}

export { Loading } from "./Loading";
