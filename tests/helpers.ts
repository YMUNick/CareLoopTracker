import type { NotificationRecord, Ticket } from "../src/lib/types";

/** Local Abu Dhabi time (UTC+4) → Date. */
export function local(y: number, m: number, d: number, h = 9, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 4, min));
}

export function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: "NHS-9999",
    patient: {
      id: "P-1",
      displayName: "Baby T",
      birthDate: "2026-10-15",
      guardianName: "Test G.",
      guardianPhone: "+971 50 000 0000",
      preferredLanguage: "ar",
    },
    result: { program: "newborn_hearing", test: "AABR", ear: "right", outcome: "refer", performedAt: local(2026, 10, 16, 10).toISOString() },
    status: "abnormal",
    stageEnteredAt: local(2026, 10, 16, 10).toISOString(),
    assignee: null,
    supervisor: "Sup",
    contactAttempts: [],
    appointment: null,
    referral: null,
    consultOutcome: null,
    notification: null,
    closeReason: null,
    audit: [],
    ...over,
  };
}

export function notification(over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    at: local(2026, 10, 20).toISOString(),
    sentBy: "N",
    confirmedBy: "N",
    channel: "sms",
    textEn: "en",
    textAr: "ar",
    draftSource: "template",
    rejectedDrafts: 0,
    ...over,
  };
}
