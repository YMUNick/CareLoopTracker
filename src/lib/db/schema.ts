// Database schema. Idempotent: safe to run on every cold start.
// Also printed by `npm run db:sql` for pasting into the Supabase SQL editor.
//
// Integrity rules enforced by Postgres itself (not only by the app):
//   * audit_events and escalation_notices are append-only: UPDATE, DELETE and
//     TRUNCATE raise an error.
//   * Each audit event must extend its ticket's chain: seq = previous + 1 and
//     prev_hash = previous hash.
//   * A ticket's status must equal the to_status of its latest audit event at
//     commit time, and its version must increase by exactly 1 per update.
//   * Tickets cannot be deleted. "Reset demo" starts a new dataset instead.
//   * Row Level Security is on with no policies, so Supabase's public API
//     roles (anon / authenticated) cannot read or write these tables.

export const SCHEMA_SQL = /* sql */ `
create table if not exists datasets (
  id text primary key,
  created_at timestamptz not null default now(),
  note text
);

create table if not exists app_state (
  singleton boolean primary key default true check (singleton),
  active_dataset text not null references datasets(id)
);

create table if not exists tickets (
  dataset_id text not null references datasets(id),
  id text not null,
  status text not null check (status in ('abnormal','assigned','notified','consulted','referred','closed')),
  version integer not null default 0,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (dataset_id, id)
);

create table if not exists audit_events (
  dataset_id text not null,
  ticket_id text not null,
  seq integer not null check (seq >= 1),
  at timestamptz not null,
  actor text not null check (length(trim(actor)) > 0),
  action text not null,
  from_status text,
  to_status text not null,
  detail jsonb,
  prev_hash text not null,
  hash text not null,
  recorded_at timestamptz not null default now(),
  primary key (dataset_id, ticket_id, seq),
  foreign key (dataset_id, ticket_id) references tickets(dataset_id, id)
);

create table if not exists escalation_notices (
  key text primary key,
  dataset_id text not null references datasets(id),
  ticket_id text not null,
  level smallint not null check (level in (2, 3)),
  recipient text not null,
  at timestamptz not null default now()
);

-- Append-only guard shared by audit_events and escalation_notices.
create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists audit_events_no_update_delete on audit_events;
create trigger audit_events_no_update_delete before update or delete on audit_events
  for each row execute function forbid_mutation();
drop trigger if exists audit_events_no_truncate on audit_events;
create trigger audit_events_no_truncate before truncate on audit_events
  for each statement execute function forbid_mutation();

drop trigger if exists escalation_notices_no_update_delete on escalation_notices;
create trigger escalation_notices_no_update_delete before update or delete on escalation_notices
  for each row execute function forbid_mutation();
drop trigger if exists escalation_notices_no_truncate on escalation_notices;
create trigger escalation_notices_no_truncate before truncate on escalation_notices
  for each statement execute function forbid_mutation();

drop trigger if exists tickets_no_delete on tickets;
create trigger tickets_no_delete before delete on tickets
  for each row execute function forbid_mutation();
drop trigger if exists tickets_no_truncate on tickets;
create trigger tickets_no_truncate before truncate on tickets
  for each statement execute function forbid_mutation();

-- Every new audit event must extend the ticket's hash chain.
create or replace function audit_chain_check() returns trigger language plpgsql as $$
declare
  last_seq integer;
  last_hash text;
begin
  select seq, hash into last_seq, last_hash
    from audit_events
   where dataset_id = new.dataset_id and ticket_id = new.ticket_id
   order by seq desc limit 1;
  if last_seq is null then
    if new.seq <> 1 or new.prev_hash <> repeat('0', 64) then
      raise exception 'audit chain: first event must have seq 1 and the genesis prev_hash'
        using errcode = 'check_violation';
    end if;
  elsif new.seq <> last_seq + 1 or new.prev_hash <> last_hash then
    raise exception 'audit chain: event % does not extend event % of ticket %', new.seq, last_seq, new.ticket_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists audit_events_chain on audit_events;
create trigger audit_events_chain before insert on audit_events
  for each row execute function audit_chain_check();

-- Ticket versions move forward one step at a time (optimistic concurrency).
create or replace function ticket_version_check() returns trigger language plpgsql as $$
begin
  if new.version <> old.version + 1 then
    raise exception 'ticket %: version must go from % to %', new.id, old.version, old.version + 1
      using errcode = 'serialization_failure';
  end if;
  if new.dataset_id <> old.dataset_id or new.id <> old.id then
    raise exception 'ticket identity cannot change' using errcode = 'restrict_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tickets_version on tickets;
create trigger tickets_version before update on tickets
  for each row execute function ticket_version_check();

-- At commit, a ticket's status must match its latest audit event.
create or replace function ticket_matches_audit() returns trigger language plpgsql as $$
declare
  latest text;
begin
  select to_status into latest
    from audit_events
   where dataset_id = new.dataset_id and ticket_id = new.id
   order by seq desc limit 1;
  if latest is null or latest <> new.status then
    raise exception 'ticket %: status % does not match its audit trail (%)', new.id, new.status, coalesce(latest, 'no events')
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

drop trigger if exists tickets_match_audit on tickets;
create constraint trigger tickets_match_audit after insert or update on tickets
  deferrable initially deferred
  for each row execute function ticket_matches_audit();

create index if not exists escalation_notices_dataset on escalation_notices (dataset_id, at);

alter table datasets enable row level security;
alter table app_state enable row level security;
alter table tickets enable row level security;
alter table audit_events enable row level security;
alter table escalation_notices enable row level security;
`;
