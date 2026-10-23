import { sealEvent, type Sha256Hex } from "./audit";
import { templateDraft, draftInput } from "./drafts";
import { applyAction, type Action } from "./stateMachine";
import { businessDaysAgo } from "./time";
import type { CloseReason, Patient, Ticket } from "./types";

// Synthetic demo data. Every ticket is built by replaying real actions through
// the state machine with back-dated clocks, so its audit trail is genuine.
// No real patient data is used anywhere.

export const NURSE = "Nurse Mariam K.";
export const SUPERVISOR = "Dr. Omar S. (Supervisor)";
export const NURSES = [NURSE, "Nurse Aisha R.", "Nurse Priya N."];

const GUARDIANS: [string, "en" | "ar"][] = [
  ["Fatima H.", "ar"], ["Sara M.", "en"], ["Noura A.", "ar"], ["Hind K.", "ar"], ["Maryam S.", "ar"],
  ["Anjali P.", "en"], ["Layla F.", "ar"], ["Grace O.", "en"], ["Reem T.", "ar"], ["Hessa B.", "ar"],
  ["Amina Y.", "ar"], ["Joy L.", "en"], ["Mouza D.", "ar"], ["Ritu V.", "en"], ["Shamma Q.", "ar"],
  ["Dana E.", "ar"], ["Elena R.", "en"], ["Alia N.", "ar"], ["Khadija W.", "ar"], ["Ruth C.", "en"],
];

type Step = { daysAgo: number; action: Action; actor?: string };

interface Plan {
  baby: string;
  screenedDaysAgo: number;
  test: "AABR" | "OAE";
  ear: "left" | "right" | "both";
  steps: Step[];
}

function notifySteps(daysAgo: number, actor: string, i: number): Step {
  return { daysAgo, actor, action: { type: "send_notification", notification: placeholderNotification(actor, i) } };
}

// Filled in with the real template text during build (needs the ticket).
function placeholderNotification(actor: string, rejected: number) {
  return {
    at: "",
    sentBy: actor,
    confirmedBy: actor,
    channel: "sms" as const,
    textEn: "-",
    textAr: "-",
    draftSource: "template" as const,
    rejectedDrafts: rejected,
  };
}

const close = (daysAgo: number, reason: CloseReason, note?: string): Step => ({
  daysAgo,
  action: { type: "close", reason, note },
});

function plans(): Plan[] {
  const n = (k: number) => NURSES[k % NURSES.length];
  return [
    // The demo case: assigned 5 business days ago, SLA 3 → 2 days overdue → supervisor.
    { baby: "Baby A", screenedDaysAgo: 6, test: "AABR", ear: "right", steps: [
      { daysAgo: 5, action: { type: "assign", assignee: NURSE } },
      { daysAgo: 3, actor: NURSE, action: { type: "log_contact_attempt", note: "Called guardian, no answer." } },
    ] },
    { baby: "Baby of Sara M.", screenedDaysAgo: 2, test: "OAE", ear: "left", steps: [] },
    { baby: "Baby of Noura A.", screenedDaysAgo: 4, test: "AABR", ear: "both", steps: [
      { daysAgo: 3, action: { type: "assign", assignee: NURSE } },
    ] },
    { baby: "Baby of Hind K.", screenedDaysAgo: 9, test: "OAE", ear: "right", steps: [
      { daysAgo: 8, action: { type: "assign", assignee: NURSE } },
      { daysAgo: 7, actor: NURSE, action: { type: "log_contact_attempt", note: "No answer." } },
      { daysAgo: 6, actor: NURSE, action: { type: "log_contact_attempt", note: "Number busy." } },
      { daysAgo: 4, actor: NURSE, action: { type: "log_contact_attempt", note: "Voicemail left in Arabic." } },
    ] },
    { baby: "Baby of Maryam S.", screenedDaysAgo: 16, test: "AABR", ear: "left", steps: [
      { daysAgo: 15, action: { type: "assign", assignee: NURSE } },
      notifySteps(14, NURSE, 0),
    ] },
    { baby: "Baby of Anjali P.", screenedDaysAgo: 2, test: "OAE", ear: "both", steps: [
      { daysAgo: 1, action: { type: "assign", assignee: NURSE } },
    ] },
    { baby: "Baby of Layla F.", screenedDaysAgo: 12, test: "AABR", ear: "right", steps: [
      { daysAgo: 11, action: { type: "assign", assignee: NURSE } },
      notifySteps(10, NURSE, 1),
      { daysAgo: 4, action: { type: "record_consult", outcome: "needs_referral" } },
    ] },
    { baby: "Baby of Grace O.", screenedDaysAgo: 30, test: "AABR", ear: "both", steps: [
      { daysAgo: 29, action: { type: "assign", assignee: n(1) } },
      notifySteps(28, n(1), 0),
      { daysAgo: 20, action: { type: "record_consult", outcome: "needs_referral" } },
      { daysAgo: 18, action: { type: "refer", specialty: "Paediatric audiology" } },
    ] },
    { baby: "Baby of Reem T.", screenedDaysAgo: 1, test: "OAE", ear: "left", steps: [] },
    { baby: "Baby of Hessa B.", screenedDaysAgo: 7, test: "OAE", ear: "right", steps: [
      { daysAgo: 6, action: { type: "assign", assignee: n(2) } },
      notifySteps(5, n(2), 0),
    ] },
    { baby: "Baby of Amina Y.", screenedDaysAgo: 25, test: "AABR", ear: "left", steps: [
      { daysAgo: 24, action: { type: "assign", assignee: n(1) } },
      notifySteps(22, n(1), 0),
      { daysAgo: 15, action: { type: "record_consult", outcome: "rescreen_normal" } },
      close(14, "rescreen_normal"),
    ] },
    { baby: "Baby of Joy L.", screenedDaysAgo: 40, test: "AABR", ear: "both", steps: [
      { daysAgo: 39, action: { type: "assign", assignee: n(2) } },
      notifySteps(37, n(2), 0),
      { daysAgo: 30, action: { type: "record_consult", outcome: "needs_referral" } },
      { daysAgo: 28, action: { type: "refer", specialty: "Paediatric ENT" } },
      close(10, "under_specialist_care"),
    ] },
    { baby: "Baby of Mouza D.", screenedDaysAgo: 20, test: "OAE", ear: "right", steps: [
      { daysAgo: 19, action: { type: "assign", assignee: NURSE } },
      close(17, "superseded", "Repeat OAE before discharge passed both ears."),
    ] },
    { baby: "Baby of Ritu V.", screenedDaysAgo: 22, test: "OAE", ear: "left", steps: [
      { daysAgo: 21, action: { type: "assign", assignee: n(1) } },
      close(19, "transferred_out", "Family moved to Dubai; records sent to receiving clinic."),
    ] },
    { baby: "Baby of Shamma Q.", screenedDaysAgo: 3, test: "AABR", ear: "right", steps: [
      { daysAgo: 2, action: { type: "assign", assignee: n(2) } },
    ] },
    { baby: "Baby of Dana E.", screenedDaysAgo: 14, test: "OAE", ear: "both", steps: [
      { daysAgo: 13, action: { type: "assign", assignee: n(1) } },
      notifySteps(12, n(1), 0),
    ] },
  ];
}

function patientFor(i: number, baby: string, screenedDaysAgo: number, now: Date): Patient {
  const [guardian, lang] = GUARDIANS[i % GUARDIANS.length];
  const birth = businessDaysAgo(now, screenedDaysAgo + 1, 8);
  return {
    id: `P-${String(1001 + i)}`,
    displayName: baby,
    birthDate: birth.toISOString().slice(0, 10),
    guardianName: guardian,
    guardianPhone: `+971 50 000 ${String(1000 + i * 37).slice(-4)}`,
    preferredLanguage: lang,
  };
}

export async function buildSeed(now: Date, sha: Sha256Hex): Promise<Ticket[]> {
  const out: Ticket[] = [];
  const all = plans();
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    const performedAt = businessDaysAgo(now, p.screenedDaysAgo, 10).toISOString();
    let t: Ticket = {
      id: `NHS-${String(i + 1).padStart(4, "0")}`,
      patient: patientFor(i, p.baby, p.screenedDaysAgo, now),
      result: { program: "newborn_hearing", test: p.test, ear: p.ear, outcome: "refer", performedAt },
      status: "abnormal",
      stageEnteredAt: performedAt,
      assignee: null,
      supervisor: SUPERVISOR,
      contactAttempts: [],
      appointment: null,
      referral: null,
      consultOutcome: null,
      notification: null,
      closeReason: null,
      audit: [],
    };
    t.audit = [
      await sealEvent([], { at: performedAt, actor: "Screening device import", action: "create", from: null, to: "abnormal", detail: { test: p.test, ear: p.ear, outcome: "refer" } }, sha),
    ];

    for (const step of p.steps) {
      const when = businessDaysAgo(now, step.daysAgo, 11);
      let action = step.action;
      if (action.type === "send_notification") {
        const d = templateDraft(draftInput(t));
        action = { ...action, notification: { ...action.notification, at: when.toISOString(), textEn: d.en, textAr: d.ar } };
      }
      const actor = step.actor ?? (action.type === "assign" ? SUPERVISOR : t.assignee ?? SUPERVISOR);
      const r = applyAction(t, action, actor, when);
      if (!r.ok) throw new Error(`Seed ${t.id}: ${r.error}`);
      t = { ...r.ticket, audit: [...t.audit, await sealEvent(t.audit, r.event, sha)] };
    }
    out.push(t);
  }
  return out;
}

export const DEMO_TICKET_ID = "NHS-0001";
