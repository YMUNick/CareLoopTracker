import { describe, expect, it } from "vitest";
import { escalationOf, pendingNotices } from "../src/lib/escalation";
import { applyAction } from "../src/lib/stateMachine";
import { addBusinessDays, businessDaysBetween, isWeekend } from "../src/lib/time";
import { local, makeTicket, notification } from "./helpers";

describe("Abu Dhabi business days (UTC+4, Sat/Sun weekend)", () => {
  it("treats Saturday and Sunday as weekend in local time", () => {
    expect(isWeekend(local(2026, 10, 24, 10))).toBe(true); // Sat
    expect(isWeekend(local(2026, 10, 25, 10))).toBe(true); // Sun
    expect(isWeekend(local(2026, 10, 23, 10))).toBe(false); // Fri is a working day
  });

  it("uses the local date, not UTC, near midnight", () => {
    // Fri 23:30 UTC = Sat 03:30 local → weekend
    expect(isWeekend(new Date(Date.UTC(2026, 9, 23, 23, 30)))).toBe(true);
  });

  it("skips the weekend when adding business days", () => {
    const due = addBusinessDays(local(2026, 10, 23, 10), 1); // Fri + 1
    expect(due.toISOString()).toBe(local(2026, 10, 26, 23, 59).toISOString().replace(":00.000Z", ":59.999Z"));
    expect(businessDaysBetween(local(2026, 10, 23), local(2026, 10, 26))).toBe(1);
  });
});

describe("escalation", () => {
  const assigned = makeTicket({ status: "assigned", assignee: "N", stageEnteredAt: local(2026, 10, 19, 9).toISOString() }); // Mon, SLA 3 → due Thu

  it.each([
    [local(2026, 10, 19, 10), 0],
    [local(2026, 10, 21, 10), 1], // Wed: due tomorrow
    [local(2026, 10, 22, 20), 1], // Thu evening: still within due day
    [local(2026, 10, 23, 10), 2], // Fri: 1 business day overdue
    [local(2026, 10, 25, 10), 2], // Sun: weekend does not add overdue days
    [local(2026, 10, 26, 10), 3], // Mon: 2 business days overdue → supervisor
  ])("at %s level is %i", (now, level) => {
    expect(escalationOf(assigned, now).level).toBe(level);
  });

  it("is idempotent: a second run with the same sent keys sends nothing", () => {
    const now = local(2026, 10, 26, 10);
    const first = pendingNotices([assigned], now, new Set());
    expect(first.map((n) => n.level)).toEqual([2, 3]);
    expect(pendingNotices([assigned], now, new Set(first.map((n) => n.key)))).toEqual([]);
  });

  it("catches up after a missed day by emitting every missing level once", () => {
    const missed = pendingNotices([assigned], local(2026, 10, 28, 10), new Set());
    expect(missed).toHaveLength(2);
    expect(new Set(missed.map((n) => n.key)).size).toBe(2);
  });

  it("stops escalating once the stage advances", () => {
    const r = applyAction(assigned, { type: "send_notification", notification: notification() }, "N", local(2026, 10, 26, 11));
    expect(r.ok).toBe(true);
    if (r.ok) expect(pendingNotices([r.ticket], local(2026, 10, 26, 12), new Set())).toEqual([]);
  });

  it("stops escalating when the result is superseded", () => {
    const r = applyAction(assigned, { type: "close", reason: "superseded", note: "repeat passed" }, "N", local(2026, 10, 26, 11));
    expect(r.ok).toBe(true);
    if (r.ok) expect(escalationOf(r.ticket, local(2026, 11, 30)).level).toBe(0);
  });
});
