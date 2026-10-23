import { sealEvent, verifyChain } from "../audit";
import { pendingNotices, type EscalationNotice } from "../escalation";
import { buildSeed } from "../seed";
import { sha256Hex } from "../sha";
import type { PendingAuditEvent } from "../stateMachine";
import type { AuditEvent, Ticket } from "../types";
import type { Db, Query } from "./client";

// All reads and writes of tickets go through here. Writes happen inside one
// transaction: lock the ticket row, verify its stored audit chain, let the
// caller compute the change, append the sealed audit event, bump the version.
// Postgres triggers (see schema.ts) independently reject anything that breaks
// the chain, rewrites history or leaves status and audit out of step.

export interface SentNotice extends EscalationNotice {
  at: string;
}

export interface StateSnapshot {
  datasetId: string;
  seededAt: string;
  tickets: Ticket[];
  notices: SentNotice[];
}

const SEED_LOCK = 734_912;

type TicketRow = { id: string; data: Ticket; version: number };
type EventRow = {
  ticket_id: string;
  seq: number;
  at: Date | string;
  actor: string;
  action: string;
  from_status: string | null;
  to_status: string;
  detail: Record<string, unknown> | null;
  prev_hash: string;
  hash: string;
};

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

function toEvent(r: EventRow): AuditEvent {
  const e: AuditEvent = {
    seq: r.seq,
    at: iso(r.at),
    actor: r.actor,
    action: r.action,
    from: r.from_status as AuditEvent["from"],
    to: r.to_status as AuditEvent["to"],
    prevHash: r.prev_hash,
    hash: r.hash,
  };
  if (r.detail !== null) e.detail = r.detail;
  return e;
}

function stripAudit(t: Ticket): Omit<Ticket, "audit"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { audit, ...rest } = t;
  return rest;
}

async function insertEvent(q: Query, datasetId: string, ticketId: string, e: AuditEvent) {
  await q(
    `insert into audit_events (dataset_id, ticket_id, seq, at, actor, action, from_status, to_status, detail, prev_hash, hash)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [datasetId, ticketId, e.seq, e.at, e.actor, e.action, e.from, e.to, e.detail === undefined ? null : JSON.stringify(e.detail), e.prevHash, e.hash],
  );
}

async function insertTicket(q: Query, datasetId: string, t: Ticket) {
  await q(`insert into tickets (dataset_id, id, status, version, data) values ($1,$2,$3,0,$4)`, [
    datasetId,
    t.id,
    t.status,
    JSON.stringify(stripAudit(t)),
  ]);
  for (const e of t.audit) await insertEvent(q, datasetId, t.id, e);
}

async function loadEvents(q: Query, datasetId: string, ticketId?: string): Promise<Map<string, AuditEvent[]>> {
  const rows = await q<EventRow>(
    `select ticket_id, seq, at, actor, action, from_status, to_status, detail, prev_hash, hash
       from audit_events where dataset_id = $1 ${ticketId ? "and ticket_id = $2" : ""}
      order by ticket_id, seq`,
    ticketId ? [datasetId, ticketId] : [datasetId],
  );
  const map = new Map<string, AuditEvent[]>();
  for (const r of rows) {
    const list = map.get(r.ticket_id) ?? [];
    list.push(toEvent(r));
    map.set(r.ticket_id, list);
  }
  return map;
}

function newDatasetId(now: Date): string {
  return `ds-${now.toISOString().replace(/[-:.TZ]/g, "")}-${Math.random().toString(36).slice(2, 7)}`;
}

async function seedDataset(q: Query, now: Date): Promise<string> {
  const tickets = await buildSeed(now, sha256Hex);
  const id = newDatasetId(now);
  await q(`insert into datasets (id, note) values ($1, 'synthetic demo seed')`, [id]);
  for (const t of tickets) await insertTicket(q, id, t);
  return id;
}

/** Creates a fresh synthetic dataset and makes it active. Old datasets are kept (append-only). */
export async function startNewDataset(db: Db, now = new Date()): Promise<string> {
  return db.tx(async (q) => {
    await q(`select pg_advisory_xact_lock(${SEED_LOCK})`);
    const id = await seedDataset(q, now);
    await q(
      `insert into app_state (singleton, active_dataset) values (true, $1)
       on conflict (singleton) do update set active_dataset = excluded.active_dataset`,
      [id],
    );
    return id;
  });
}

export async function activeDataset(db: Db): Promise<{ id: string; createdAt: string }> {
  const read = async () =>
    (
      await db.query<{ id: string; created_at: Date | string }>(
        `select d.id, d.created_at from app_state s join datasets d on d.id = s.active_dataset`,
      )
    )[0];
  let row = await read();
  if (!row) {
    // First request ever: seed once, even if several instances race.
    await db.tx(async (q) => {
      await q(`select pg_advisory_xact_lock(${SEED_LOCK})`);
      if ((await q(`select 1 from app_state`)).length) return;
      const id = await seedDataset(q, new Date());
      await q(`insert into app_state (singleton, active_dataset) values (true, $1)`, [id]);
    });
    row = await read();
  }
  return { id: row.id, createdAt: iso(row.created_at) };
}

export async function listTickets(db: Db, datasetId: string): Promise<Ticket[]> {
  const rows = await db.query<TicketRow>(`select id, data, version from tickets where dataset_id = $1 order by id`, [datasetId]);
  const events = await loadEvents(db.query, datasetId);
  return rows.map((r) => ({ ...r.data, audit: events.get(r.id) ?? [] }));
}

export async function getTicket(db: Db, datasetId: string, id: string): Promise<Ticket | null> {
  const rows = await db.query<TicketRow>(`select id, data, version from tickets where dataset_id = $1 and id = $2`, [datasetId, id]);
  if (!rows[0]) return null;
  const events = await loadEvents(db.query, datasetId, id);
  return { ...rows[0].data, audit: events.get(id) ?? [] };
}

export class ChangeRejected extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/**
 * Atomically apply a change to one ticket. `decide` sees the locked, verified
 * ticket and returns the next ticket plus its (unsealed) audit event, or throws
 * ChangeRejected.
 */
export async function changeTicket(
  db: Db,
  datasetId: string,
  id: string,
  decide: (t: Ticket) => Promise<{ ticket: Ticket; event: PendingAuditEvent }> | { ticket: Ticket; event: PendingAuditEvent },
): Promise<Ticket> {
  return db.tx(async (q) => {
    const rows = await q<TicketRow>(`select id, data, version from tickets where dataset_id = $1 and id = $2 for update`, [datasetId, id]);
    if (!rows[0]) throw new ChangeRejected(`Ticket ${id} not found.`, 404);
    const audit = (await loadEvents(q, datasetId, id)).get(id) ?? [];
    const current: Ticket = { ...rows[0].data, audit };
    const chain = await verifyChain(audit, sha256Hex);
    if (!chain.ok) throw new ChangeRejected(`Audit trail failed verification at event #${chain.brokenAt}. Change refused.`, 409);

    const { ticket, event } = await decide(current);
    const sealed = await sealEvent(audit, event, sha256Hex);
    await insertEvent(q, datasetId, id, sealed);
    await q(`update tickets set status = $3, data = $4, version = version + 1 where dataset_id = $1 and id = $2`, [
      datasetId,
      id,
      ticket.status,
      JSON.stringify(stripAudit(ticket)),
    ]);
    return { ...ticket, audit: [...audit, sealed] };
  });
}

/** Records every escalation notice that is due and not yet recorded. Idempotent via the unique key. */
export async function runEscalations(db: Db, datasetId: string, now = new Date()): Promise<SentNotice[]> {
  const tickets = await listTickets(db, datasetId);
  const sent = await db.query<{ key: string }>(`select key from escalation_notices where dataset_id = $1`, [datasetId]);
  const fresh = pendingNotices(tickets, now, new Set(sent.map((r) => r.key.slice(datasetId.length + 1))));
  const recorded: SentNotice[] = [];
  for (const n of fresh) {
    const rows = await db.query<{ at: Date | string }>(
      `insert into escalation_notices (key, dataset_id, ticket_id, level, recipient, at)
       values ($1,$2,$3,$4,$5,$6) on conflict (key) do nothing returning at`,
      [`${datasetId}:${n.key}`, datasetId, n.ticketId, n.level, n.to, now.toISOString()],
    );
    if (rows[0]) recorded.push({ ...n, at: iso(rows[0].at) });
  }
  return recorded;
}

export async function listNotices(db: Db, datasetId: string): Promise<SentNotice[]> {
  const rows = await db.query<{ key: string; ticket_id: string; level: number; recipient: string; at: Date | string }>(
    `select key, ticket_id, level, recipient, at from escalation_notices where dataset_id = $1 order by at, key`,
    [datasetId],
  );
  return rows.map((r) => ({
    key: r.key.slice(datasetId.length + 1),
    ticketId: r.ticket_id,
    level: r.level as 2 | 3,
    to: r.recipient,
    at: iso(r.at),
  }));
}

export async function snapshot(db: Db): Promise<StateSnapshot> {
  const ds = await activeDataset(db);
  await runEscalations(db, ds.id);
  const [tickets, notices] = await Promise.all([listTickets(db, ds.id), listNotices(db, ds.id)]);
  return { datasetId: ds.id, seededAt: ds.createdAt, tickets, notices };
}
