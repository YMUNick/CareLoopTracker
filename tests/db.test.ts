import { beforeAll, describe, expect, it } from "vitest";
import { verifyChain } from "../src/lib/audit";
import { pgliteDb, type Db } from "../src/lib/db/client";
import { activeDataset, changeTicket, ChangeRejected, getTicket, listNotices, listTickets, runEscalations, startNewDataset } from "../src/lib/db/repo";
import { SCHEMA_SQL } from "../src/lib/db/schema";
import { sha256Hex } from "../src/lib/sha";
import { applyAction } from "../src/lib/stateMachine";
import { local } from "./helpers";

// Runs the real schema and triggers on PGlite (Postgres in WASM).

let db: Db;
let ds: string;

beforeAll(async () => {
  db = await pgliteDb();
  await db.exec(SCHEMA_SQL);
  await db.exec(SCHEMA_SQL); // migration is idempotent
  ds = (await activeDataset(db)).id;
}, 60_000);

const rejects = (p: Promise<unknown>, msg: RegExp) => expect(p).rejects.toThrow(msg);

describe("Postgres storage", () => {
  it("seeds an active dataset with verified chains", async () => {
    const tickets = await listTickets(db, ds);
    expect(tickets.length).toBe(16);
    for (const t of tickets) expect(await verifyChain(t.audit, sha256Hex)).toEqual({ ok: true });
  });

  it("applies a change atomically and appends a sealed event", async () => {
    const before = (await getTicket(db, ds, "NHS-0002"))!;
    const after = await changeTicket(db, ds, "NHS-0002", (t) => {
      const r = applyAction(t, { type: "assign", assignee: "Nurse X" }, "Sup", new Date());
      if (!r.ok) throw new ChangeRejected(r.error, 409);
      return r;
    });
    expect(after.status).toBe("assigned");
    expect(after.audit.length).toBe(before.audit.length + 1);
    const reloaded = (await getTicket(db, ds, "NHS-0002"))!;
    expect(reloaded.status).toBe("assigned");
    expect(await verifyChain(reloaded.audit, sha256Hex)).toEqual({ ok: true });
  });

  it("leaves nothing behind when the change is rejected", async () => {
    const before = (await getTicket(db, ds, "NHS-0003"))!;
    await rejects(
      changeTicket(db, ds, "NHS-0003", () => {
        throw new ChangeRejected("nope", 409);
      }),
      /nope/,
    );
    expect((await getTicket(db, ds, "NHS-0003"))!.audit.length).toBe(before.audit.length);
  });
});

describe("database-level locks (triggers)", () => {
  it("blocks UPDATE of an audit event", () =>
    rejects(db.query(`update audit_events set actor = 'someone else' where dataset_id = $1 and seq = 1`, [ds]), /append-only/));

  it("blocks DELETE of an audit event", () => rejects(db.query(`delete from audit_events where dataset_id = $1`, [ds]), /append-only/));

  it("blocks TRUNCATE of the audit table", () => rejects(db.query(`truncate audit_events cascade`), /append-only/));

  it("blocks deleting a ticket", () => rejects(db.query(`delete from tickets where dataset_id = $1`, [ds]), /append-only/));

  it("blocks UPDATE or DELETE of escalation notices", async () => {
    await runEscalations(db, ds);
    await rejects(db.query(`update escalation_notices set recipient = 'x' where dataset_id = $1`, [ds]), /append-only/);
    await rejects(db.query(`delete from escalation_notices where dataset_id = $1`, [ds]), /append-only/);
  });

  it("rejects an event that does not extend the chain", async () => {
    const t = (await getTicket(db, ds, "NHS-0004"))!;
    const last = t.audit[t.audit.length - 1];
    const insert = (seq: number, prev: string) =>
      db.query(
        `insert into audit_events (dataset_id, ticket_id, seq, at, actor, action, to_status, prev_hash, hash)
         values ($1,'NHS-0004',$2, now(), 'x', 'reassign', 'assigned', $3, 'forged')`,
        [ds, seq, prev],
      );
    await rejects(insert(last.seq + 1, "0".repeat(64)), /does not extend/);
    await rejects(insert(last.seq + 2, last.hash), /does not extend/);
  });

  it("rejects a status change that is not backed by an audit event", () =>
    rejects(
      db.tx((q) => q(`update tickets set status = 'closed', version = version + 1 where dataset_id = $1 and id = 'NHS-0005'`, [ds])),
      /does not match its audit trail/,
    ));

  it("rejects skipping or reusing a version", () =>
    rejects(db.query(`update tickets set version = version + 2 where dataset_id = $1 and id = 'NHS-0005'`, [ds]), /version must go/));
});

describe("escalations and reset", () => {
  it("records due notices once", async () => {
    const now = local(2026, 12, 31, 12);
    await runEscalations(db, ds, now);
    expect(await runEscalations(db, ds, now)).toEqual([]);
    const keys = (await listNotices(db, ds)).map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reset starts a new dataset and keeps the old one intact", async () => {
    const oldCount = (await db.query<{ n: number }>(`select count(*)::int as n from audit_events where dataset_id = $1`, [ds]))[0].n;
    const fresh = await startNewDataset(db);
    expect(fresh).not.toBe(ds);
    expect((await activeDataset(db)).id).toBe(fresh);
    expect((await getTicket(db, fresh, "NHS-0002"))!.status).toBe("abnormal");
    const stillThere = (await db.query<{ n: number }>(`select count(*)::int as n from audit_events where dataset_id = $1`, [ds]))[0].n;
    expect(stillThere).toBe(oldCount);
  });
});
