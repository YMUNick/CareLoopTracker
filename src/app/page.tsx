"use client";

import Link from "next/link";
import { triage } from "@/lib/escalation";
import { CURRENT_USER, useDemoState } from "@/lib/store";
import { Loading, TicketRow } from "@/components/ui";

export default function Today() {
  const s = useDemoState();
  if (!s) return <Loading />;
  const now = new Date();
  const mine = triage(s.tickets, now).filter(({ ticket }) => ticket.assignee === CURRENT_USER || ticket.assignee === null);
  const top = mine.slice(0, 5);
  const overdue = mine.filter((x) => x.esc.level >= 2).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Today: your 5 most urgent follow-ups</h1>
        <p className="mt-1 text-sm text-muted">
          {mine.length} open cases for you or unassigned · <span className={overdue ? "font-medium text-danger" : ""}>{overdue} overdue</span>.
          Ordered by escalation level, then days overdue.
        </p>
      </div>
      <div className="space-y-3">
        {top.map(({ ticket }) => (
          <TicketRow key={ticket.id} t={ticket} now={now} />
        ))}
        {top.length === 0 && <p className="text-muted">Nothing waiting. Every result you own is on track.</p>}
      </div>
      {mine.length > 5 && (
        <Link href="/tickets" className="inline-block text-sm text-primary underline underline-offset-2">
          {mine.length - 5} more open cases →
        </Link>
      )}
    </div>
  );
}
