// Domain model. Field names loosely follow FHIR Task / DiagnosticReport so the
// model can later be mapped onto an EHR without reshaping the data.

export type Status =
  | "abnormal" // abnormal result received, nobody owns it yet
  | "assigned" // an owner is responsible for contacting the family
  | "notified" // family has been notified (human-approved message sent)
  | "consulted" // confirmatory re-screen / consultation done
  | "referred" // referred to a specialist service
  | "closed";

export type CloseReason =
  | "rescreen_normal"
  | "under_specialist_care"
  | "declined"
  | "unreachable"
  | "transferred_out"
  | "deceased"
  | "superseded"; // result overturned by a newer, valid screen

export type ConsultOutcome = "rescreen_normal" | "needs_referral";

export interface ScreeningResult {
  // ~ FHIR DiagnosticReport
  program: "newborn_hearing";
  test: "AABR" | "OAE";
  ear: "left" | "right" | "both";
  outcome: "refer"; // "refer" = did not pass; never a diagnosis
  performedAt: string; // ISO
}

export interface Patient {
  id: string;
  displayName: string; // synthetic
  birthDate: string; // ISO date
  guardianName: string;
  guardianPhone: string;
  preferredLanguage: "en" | "ar";
}

export interface AuditEvent {
  seq: number;
  at: string; // ISO
  actor: string;
  action: string;
  from: Status | null;
  to: Status;
  detail?: Record<string, unknown>;
  prevHash: string;
  hash: string; // sha256(prevHash + canonical payload) — tamper-evident chain
}

export interface NotificationRecord {
  at: string;
  sentBy: string;
  confirmedBy: string;
  channel: "sms" | "phone" | "letter";
  textEn: string;
  textAr: string;
  draftSource: "azure-openai" | "template";
  rejectedDrafts: number;
}

export interface Ticket {
  // ~ FHIR Task
  id: string;
  patient: Patient;
  result: ScreeningResult;
  status: Status;
  stageEnteredAt: string; // ISO — start of the current SLA clock
  assignee: string | null;
  supervisor: string;
  contactAttempts: { at: string; by: string; note: string }[];
  appointment: { at: string; place: string } | null;
  referral: { specialty: string; at: string } | null;
  consultOutcome: ConsultOutcome | null;
  notification: NotificationRecord | null;
  closeReason: CloseReason | null;
  audit: AuditEvent[];
}

export const CLOSE_REASON_LABEL: Record<CloseReason, string> = {
  rescreen_normal: "Re-screen normal",
  under_specialist_care: "Under specialist care",
  declined: "Family declined follow-up",
  unreachable: "Unreachable after 3 attempts",
  transferred_out: "Transferred to another provider",
  deceased: "Deceased",
  superseded: "Result superseded by newer screen",
};

export const STATUS_LABEL: Record<Status, string> = {
  abnormal: "Abnormal — unassigned",
  assigned: "Assigned",
  notified: "Family notified",
  consulted: "Re-screen done",
  referred: "Referred",
  closed: "Closed",
};
