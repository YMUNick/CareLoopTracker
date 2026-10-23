"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { draftContext, type Draft } from "@/lib/drafts";
import { checkDraft, type Finding } from "@/lib/guardrail";
import { DEMO_TICKET_ID } from "@/lib/seed";
import { callApi, CURRENT_USER, saveTicket, useDemoState } from "@/lib/store";
import type { Ticket } from "@/lib/types";
import { Card, Loading } from "@/components/ui";

export default function NotifyPage() {
  const { id } = useParams<{ id: string }>();
  const s = useDemoState();
  if (!s) return <Loading />;
  const t = s.tickets.find((x) => x.id === id);
  if (!t) return <p>Ticket {id} not found.</p>;
  if (t.status !== "assigned") {
    return (
      <p>
        This ticket is not waiting for a family notification. <Link className="text-primary underline" href={`/tickets/${t.id}`}>Back to ticket</Link>
      </p>
    );
  }
  return <Review t={t} />;
}

function Review({ t }: { t: Ticket }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [en, setEn] = useState("");
  const [ar, setAr] = useState("");
  const [rejected, setRejected] = useState(0);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [warning, setWarning] = useState<string | undefined>();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<string | null>(null);

  const load = useCallback(
    async (simulateError: boolean) => {
      setBusy(true);
      const r = await callApi("/api/draft", { ticket: t, simulateError });
      setBusy(false);
      if (r.error) return setError(r.error);
      const d = r.data.draft as Draft;
      setDraft(d);
      setEn(d.en);
      setAr(d.ar);
      setAiConfigured(Boolean(r.data.aiConfigured));
      setWarning(r.data.warning as string | undefined);
      setConfirmed(false);
    },
    [t],
  );

  useEffect(() => {
    // The demo case starts with a deliberately faulty draft so the safety check can be seen working.
    load(t.id === DEMO_TICKET_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ctx = draftContext(t);
  const enFindings = checkDraft(en, "en", ctx);
  const arFindings = checkDraft(ar, "ar", ctx);
  const total = enFindings.length + arFindings.length;
  const canSend = total === 0 && confirmed && !busy;

  async function send(opts: { confirmed: boolean; textEn: string; textAr: string }) {
    return callApi("/api/send", {
      ticket: t,
      textEn: opts.textEn,
      textAr: opts.textAr,
      confirmed: opts.confirmed,
      confirmedBy: CURRENT_USER,
      channel: "sms",
      draftSource: draft?.source ?? "template",
      rejectedDrafts: rejected,
    });
  }

  async function onSend() {
    setBusy(true);
    setError(null);
    const r = await send({ confirmed: true, textEn: en, textAr: ar });
    setBusy(false);
    if (r.ticket) {
      saveTicket(r.ticket);
      router.push(`/tickets/${t.id}`);
    } else setError(r.error ?? `Request failed (${r.status})`);
  }

  async function probeUnconfirmed() {
    const r = await send({ confirmed: false, textEn: en, textAr: ar });
    setProbe(`Send without confirmation → HTTP ${r.status}: ${r.error ?? "accepted"}`);
  }

  async function probeFlagged() {
    const r = await callApi("/api/draft", { ticket: t, simulateError: true });
    const bad = r.data.draft as Draft;
    const s = await send({ confirmed: true, textEn: bad.en, textAr: bad.ar });
    const kinds = ((s.data.findings as Finding[]) ?? []).map((f) => `${f.lang}:${f.kind} "${f.match}"`).join(", ");
    setProbe(`Send flagged draft with confirmation → HTTP ${s.status}: ${s.error ?? "accepted"}${kinds ? `\n${kinds}` : ""}`);
  }

  return (
    <div className="space-y-4">
      <Link href={`/tickets/${t.id}`} className="text-sm text-primary">← {t.patient.displayName}</Link>
      <div>
        <h1 className="text-2xl font-semibold">Review family notification</h1>
        <p className="text-sm text-muted">
          AI drafts, a person decides. Nothing is sent until the safety check is clear and you confirm. To {t.patient.guardianName}, who prefers{" "}
          {t.patient.preferredLanguage === "ar" ? "Arabic" : "English"}.
        </p>
      </div>

      {draft?.simulatedError && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          Simulation: this draft deliberately contains two typical model mistakes (diagnostic wording and an invented number) to show the
          safety check. {aiConfigured ? "" : "Azure OpenAI is not connected in this deployment."}
        </p>
      )}
      {draft && !draft.simulatedError && draft.source === "template" && (
        <p className="rounded-md bg-primary-soft px-3 py-2 text-sm text-primary">
          Template draft. {aiConfigured === false && "Azure OpenAI is not configured, so the AI drafting step is replaced by a fixed template."}
        </p>
      )}
      {warning && <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{warning}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <Pane title="English" value={en} onChange={setEn} findings={enFindings} />
        <Pane title="العربية" value={ar} onChange={setAr} findings={arFindings} rtl />
      </div>

      <Card className="space-y-3">
        <div className={`text-sm font-medium ${total ? "text-danger" : "text-ok"}`}>
          {total ? `Send locked: ${total} safety finding${total > 1 ? "s" : ""}. Edit the text or regenerate.` : "Safety check clear in both languages."}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirmed} disabled={total > 0} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>I, {CURRENT_USER}, have read both versions and confirm they are accurate and appropriate to send.</span>
        </label>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-40" disabled={!canSend} onClick={onSend}>
            Send to family
          </button>
          <button
            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-40"
            disabled={busy}
            onClick={() => {
              setRejected((n) => n + 1);
              load(false);
            }}
          >
            Reject draft and regenerate
          </button>
        </div>
        {rejected > 0 && <p className="text-xs text-muted">{rejected} draft(s) rejected. This is recorded in the audit trail when sent.</p>}
      </Card>

      <details className="rounded-lg border border-border bg-surface p-4 text-sm">
        <summary className="cursor-pointer text-muted">Try to break it: call the send API directly</summary>
        <p className="mt-2 text-muted">These requests skip the UI. The server re-checks confirmation and runs the same safety check.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="rounded-md border border-danger px-3 py-1.5 text-danger" onClick={probeUnconfirmed}>
            Send without confirmation
          </button>
          <button className="rounded-md border border-danger px-3 py-1.5 text-danger" onClick={probeFlagged}>
            Send flagged draft, “confirmed”
          </button>
        </div>
        {probe && <pre className="mt-2 whitespace-pre-wrap rounded-md bg-danger-soft p-2 text-xs text-danger">{probe}</pre>}
      </details>
    </div>
  );
}

function Pane({ title, value, onChange, findings, rtl }: { title: string; value: string; onChange: (v: string) => void; findings: Finding[]; rtl?: boolean }) {
  return (
    <Card className="space-y-2">
      <h2 className="font-semibold" dir={rtl ? "rtl" : undefined}>{title}</h2>
      <textarea
        dir={rtl ? "rtl" : "ltr"}
        className={`h-48 w-full rounded-md border bg-white p-2 text-sm leading-relaxed ${findings.length ? "border-danger" : "border-border"}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <ul className="space-y-1">
        {findings.map((f, i) => (
          <li key={i} className="rounded bg-danger-soft px-2 py-1 text-xs text-danger">
            <span dir="auto" className="font-semibold">“{f.match}”</span>: {f.message}
          </li>
        ))}
      </ul>
    </Card>
  );
}
