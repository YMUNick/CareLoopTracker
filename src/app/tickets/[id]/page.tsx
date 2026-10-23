"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { verifyChain } from "@/lib/audit";
import { escalationOf } from "@/lib/escalation";
import { NURSES } from "@/lib/seed";
import { sha256Hex } from "@/lib/sha";
import { availableActions, closeReasonsFor, type Action } from "@/lib/stateMachine";
import { callApi, CURRENT_USER, saveTicket, useDemoState } from "@/lib/store";
import { formatLocal, formatLocalDate } from "@/lib/time";
import { CLOSE_REASON_LABEL, STATUS_LABEL, type AuditEvent, type CloseReason, type Ticket } from "@/lib/types";
import { Card, dueText, EscalationBadge, Loading, nextStep, StatusBadge } from "@/components/ui";

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const s = useDemoState();
  if (!s) return <Loading />;
  const t = s.tickets.find((x) => x.id === id);
  if (!t) return <p>Ticket {id} not found.</p>;
  return <TicketView t={t} />;
}

function TicketView({ t }: { t: Ticket }) {
  const now = new Date();
  const esc = escalationOf(t, now);
  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-primary">← Today</Link>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{t.patient.displayName}</h1>
          <span className="text-sm text-muted">{t.id}</span>
          <StatusBadge status={t.status} />
          {t.status !== "closed" && <EscalationBadge level={esc.level} />}
          <span className={`ml-auto text-sm ${esc.level >= 2 ? "font-medium text-danger" : "text-muted"}`}>{dueText(t, now)}</span>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Field k="Screening">{t.result.test}, {t.result.ear} ear: did not pass (refer)</Field>
          <Field k="Screened">{formatLocalDate(t.result.performedAt)}</Field>
          <Field k="Born">{t.patient.birthDate}</Field>
          <Field k="Guardian">{t.patient.guardianName} · prefers {t.patient.preferredLanguage === "ar" ? "Arabic" : "English"}</Field>
          <Field k="Owner">{t.assignee ?? "unassigned"}</Field>
          <Field k="Supervisor">{t.supervisor}</Field>
          {t.appointment && <Field k="Repeat screen booked">{formatLocal(t.appointment.at)} · {t.appointment.place}</Field>}
          {t.referral && <Field k="Referred to">{t.referral.specialty}</Field>}
          {t.closeReason && <Field k="Closed as">{CLOSE_REASON_LABEL[t.closeReason]}</Field>}
        </dl>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Actions t={t} />
        <Timeline t={t} />
      </div>
    </div>
  );
}

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="inline text-muted">{k}: </dt>
      <dd className="inline">{children}</dd>
    </div>
  );
}

function Actions({ t }: { t: Ticket }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState(CURRENT_USER);
  const [reason, setReason] = useState<CloseReason | "">("");
  const [closeNote, setCloseNote] = useState("");
  const [apptAt, setApptAt] = useState("");
  const [place, setPlace] = useState("Audiology room 2");
  const [specialty, setSpecialty] = useState("Paediatric audiology");
  const [probe, setProbe] = useState<string | null>(null);
  const acts = availableActions(t);

  async function run(action: Action) {
    setBusy(true);
    setError(null);
    const r = await callApi("/api/transition", { ticketId: t.id, action, actor: CURRENT_USER });
    setBusy(false);
    if (r.ticket) {
      saveTicket(r.ticket);
      setNote("");
      setCloseNote("");
      setReason("");
    } else setError(r.error ?? `Request failed (${r.status})`);
  }

  async function tryIllegal() {
    const r = await callApi("/api/transition", {
      ticketId: t.id,
      action: { type: "close", reason: "rescreen_normal" },
      actor: CURRENT_USER,
    });
    setProbe(r.ticket ? "Unexpectedly accepted." : `HTTP ${r.status}: ${r.error}`);
  }

  const btn = "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40";
  const input = "w-full rounded-md border border-border bg-white px-2 py-1.5 text-sm";

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">Next step</h2>
        <p className="text-sm text-muted">{nextStep(t)}</p>
      </div>
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {acts.includes("send_notification") && (
        <Link href={`/tickets/${t.id}/notify`} className={`${btn} inline-block`}>
          Draft family notification →
        </Link>
      )}

      {(acts.includes("assign") || acts.includes("reassign")) && (
        <div className="space-y-1">
          <label className="text-sm font-medium">{acts.includes("assign") ? "Assign owner" : "Reassign"}</label>
          <div className="flex gap-2">
            <select className={input} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              {NURSES.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
            <button className={btn} disabled={busy} onClick={() => run({ type: acts.includes("assign") ? "assign" : "reassign", assignee })}>
              Save
            </button>
          </div>
        </div>
      )}

      {acts.includes("log_contact_attempt") && (
        <div className="space-y-1">
          <label className="text-sm font-medium">Log a contact attempt ({t.contactAttempts.length} so far)</label>
          <div className="flex gap-2">
            <input className={input} placeholder="e.g. Called, no answer" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className={btn} disabled={busy || !note.trim()} onClick={() => run({ type: "log_contact_attempt", note })}>
              Log
            </button>
          </div>
        </div>
      )}

      {acts.includes("set_appointment") && (
        <div className="space-y-1">
          <label className="text-sm font-medium">Book repeat screen</label>
          <div className="flex flex-wrap gap-2">
            <input type="datetime-local" className={`${input} w-auto`} value={apptAt} onChange={(e) => setApptAt(e.target.value)} />
            <input className={`${input} w-auto flex-1`} value={place} onChange={(e) => setPlace(e.target.value)} />
            <button
              className={btn}
              disabled={busy || !apptAt}
              onClick={() => run({ type: "set_appointment", at: new Date(`${apptAt}:00+04:00`).toISOString(), place })}
            >
              Book
            </button>
          </div>
        </div>
      )}

      {acts.includes("record_consult") && (
        <div className="space-y-1">
          <label className="text-sm font-medium">Record repeat-screen outcome</label>
          <div className="flex flex-wrap gap-2">
            <button className={btn} disabled={busy} onClick={() => run({ type: "record_consult", outcome: "rescreen_normal" })}>
              Passed both ears
            </button>
            <button className={btn} disabled={busy} onClick={() => run({ type: "record_consult", outcome: "needs_referral" })}>
              Did not pass: needs referral
            </button>
          </div>
        </div>
      )}

      {acts.includes("refer") && (
        <div className="space-y-1">
          <label className="text-sm font-medium">Refer to</label>
          <div className="flex gap-2">
            <input className={input} value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
            <button className={btn} disabled={busy} onClick={() => run({ type: "refer", specialty })}>
              Refer
            </button>
          </div>
        </div>
      )}

      {acts.includes("close") && (
        <div className="space-y-1">
          <label className="text-sm font-medium">Close ticket (reason required)</label>
          <select className={input} value={reason} onChange={(e) => setReason(e.target.value as CloseReason)}>
            <option value="">Choose a reason…</option>
            {closeReasonsFor(t).map((r) => (
              <option key={r} value={r}>
                {CLOSE_REASON_LABEL[r]}
              </option>
            ))}
          </select>
          <input className={input} placeholder="Note (required for transfer, death, superseded)" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
          <button className={btn} disabled={busy || !reason} onClick={() => reason && run({ type: "close", reason, note: closeNote || undefined })}>
            Close ticket
          </button>
        </div>
      )}

      {t.notification && (
        <div className="space-y-1 text-sm">
          <h3 className="font-medium">Message sent to family</h3>
          <p className="text-muted">
            {formatLocal(t.notification.at)} · confirmed by {t.notification.confirmedBy} · {t.notification.draftSource} draft
            {t.notification.rejectedDrafts > 0 && ` · ${t.notification.rejectedDrafts} draft(s) rejected first`}
          </p>
          <p className="rounded-md bg-background p-2">{t.notification.textEn}</p>
          <p dir="rtl" className="rounded-md bg-background p-2">{t.notification.textAr}</p>
        </div>
      )}

      {t.status !== "closed" && t.status !== "consulted" && (
        <details className="border-t border-border pt-3 text-sm">
          <summary className="cursor-pointer text-muted">Try to break it: skip steps through the API</summary>
          <p className="mt-2 text-muted">Sends “close as re-screen normal” straight to the server, bypassing the UI.</p>
          <button className="mt-2 rounded-md border border-danger px-3 py-1.5 text-danger" onClick={tryIllegal}>
            Send illegal request
          </button>
          {probe && <pre className="mt-2 whitespace-pre-wrap rounded-md bg-danger-soft p-2 text-xs text-danger">{probe}</pre>}
        </details>
      )}
    </Card>
  );
}

const ACTION_LABEL: Record<string, string> = {
  create: "Abnormal result imported",
  assign: "Assigned",
  reassign: "Reassigned",
  log_contact_attempt: "Contact attempt",
  send_notification: "Family notified",
  set_appointment: "Repeat screen booked",
  record_consult: "Repeat screen recorded",
  refer: "Referred",
  close: "Closed",
};

function describe(e: AuditEvent): string {
  const d = e.detail ?? {};
  switch (e.action) {
    case "assign":
    case "reassign":
      return `Owner: ${d.assignee}`;
    case "log_contact_attempt":
      return `#${d.attempt}: ${d.note}`;
    case "send_notification":
      return `Confirmed by ${d.confirmedBy} · ${d.draftSource} draft${Number(d.rejectedDrafts) > 0 ? ` · ${d.rejectedDrafts} draft(s) rejected` : ""}`;
    case "record_consult":
      return d.outcome === "rescreen_normal" ? "Passed" : "Did not pass: referral needed";
    case "refer":
      return String(d.specialty);
    case "close":
      return `${CLOSE_REASON_LABEL[d.reason as CloseReason]}${d.note ? `: ${d.note}` : ""}`;
    case "create":
      return `${d.test}, ${d.ear} ear: refer`;
    default:
      return "";
  }
}

function Timeline({ t }: { t: Ticket }) {
  const [chain, setChain] = useState<{ ok: boolean; brokenAt?: number } | null>(null);
  useEffect(() => {
    verifyChain(t.audit, sha256Hex).then(setChain);
  }, [t.audit]);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Audit timeline</h2>
        {chain && (
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${chain.ok ? "bg-ok-soft text-ok" : "bg-danger text-white"}`}>
            {chain.ok ? `Hash chain verified · ${t.audit.length} events` : `Chain broken at #${chain.brokenAt}`}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">Append-only. Each entry is sealed by the server with a hash of the previous one, so edits or deletions are detectable.</p>
      <ol className="mt-4 space-y-4 border-l-2 border-primary-soft pl-4">
        {t.audit.map((e) => (
          <li key={e.seq} className="relative">
            <span className="absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-primary bg-surface" />
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
              {e.from !== e.to && (
                <span className="text-xs text-muted">
                  {e.from ? STATUS_LABEL[e.from] : "—"} → {STATUS_LABEL[e.to]}
                </span>
              )}
            </div>
            <p className="text-sm">{describe(e)}</p>
            <p className="text-xs text-muted">
              {formatLocal(e.at)} · {e.actor} · <code title={e.hash}>#{e.hash.slice(0, 10)}</code>
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
