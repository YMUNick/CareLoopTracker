"use client";

import { useState } from "react";
import { triage } from "@/lib/escalation";
import { useDemoState } from "@/lib/store";
import { CLOSE_REASON_LABEL } from "@/lib/types";
import { Loading, TicketRow } from "@/components/ui";

export default function AllTickets() {
  const s = useDemoState();
  const [showClosed, setShowClosed] = useState(false);
  if (!s) return <Loading />;
  const now = new Date();
  const open = triage(s.tickets, now);
  const closed = s.tickets.filter((t) => t.status === "closed");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">All tickets</h1>
      <div className="space-y-3">
        {open.map(({ ticket }) => (
          <TicketRow key={ticket.id} t={ticket} now={now} />
        ))}
      </div>
      <button className="text-sm text-primary underline underline-offset-2" onClick={() => setShowClosed(!showClosed)}>
        {showClosed ? "Hide" : "Show"} {closed.length} closed tickets
      </button>
      {showClosed && (
        <div className="space-y-3">
          {closed.map((t) => (
            <div key={t.id}>
              <TicketRow t={t} now={now} />
              <p className="mt-1 pl-1 text-xs text-muted">Closed: {t.closeReason && CLOSE_REASON_LABEL[t.closeReason]}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
