"use client";

import Link from "next/link";
import { useDemoState } from "@/lib/store";
import { formatLocal } from "@/lib/time";
import { Card, Loading } from "@/components/ui";

export default function Escalations() {
  const s = useDemoState();
  if (!s) return <Loading />;
  const notices = [...s.notices].reverse();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Escalation log</h1>
      <p className="text-sm text-muted">
        Level 2 alerts the owner when a step is overdue; level 3 alerts the supervisor after 2 business days overdue (Abu Dhabi
        time, Sat–Sun weekend). Each notice has a unique key, so re-running the scheduler never sends duplicates. Delivery
        (SMS / e-mail) is not connected in the prototype; notices are recorded here.
      </p>
      <Card className="divide-y divide-border p-0">
        {notices.length === 0 && <p className="p-4 text-muted">No escalations yet.</p>}
        {notices.map((n) => (
          <div key={n.key} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${n.level === 3 ? "bg-danger text-white" : "bg-danger-soft text-danger"}`}>
              Level {n.level}
            </span>
            <Link href={`/tickets/${n.ticketId}`} className="text-primary underline underline-offset-2">
              {n.ticketId}
            </Link>
            <span>→ {n.to}</span>
            <span className="ml-auto text-xs text-muted">{formatLocal(n.at)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
