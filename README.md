# Care Loop Tracker

Every abnormal screening result gets an owner, is followed to a documented closure, and leaves a tamper-evident audit trail.

Prototype for the **Future Health Digital Innovation Challenge**, Challenge 05 *Closing the Screening-to-Care Loop*. Scope: one programme (newborn hearing screening), synthetic data only. It does not diagnose. It tracks whether the required follow-up actually happened.

## What it does

| Screen | Purpose |
|---|---|
| **Today** (`/`) | The nurse's 5 most urgent follow-ups, ordered by escalation level and days overdue |
| **Ticket** (`/tickets/[id]`) | Case details, the actions the current step allows, and the hash-chained audit timeline |
| **Notify** (`/tickets/[id]/notify`) | English and Arabic family message drafts, a live safety check, and explicit human confirmation |
| **Escalations** (`/escalations`) | Owner and supervisor alerts generated for overdue steps |

Demo case: **Baby A (NHS-0001)** is 2 business days overdue and already escalated. Its first draft deliberately contains two typical model mistakes, so the safety check can be seen blocking the send.

## Safeguards

- **State machine enforced on the server.** `abnormal → assigned → notified → consulted → referred → closed`. Illegal steps (e.g. closing before the family is notified) return `409`. See `src/lib/stateMachine.ts`.
- **Closure needs a reason.** "Unreachable" requires 3 documented contact attempts. Transfer, death and superseded results require a note.
- **Derived, idempotent escalation.** The escalation level is computed from the stage start time on Abu Dhabi business days (UTC+4, Sat–Sun weekend). Each notice has a unique key, so re-runs and catch-up after a missed day never duplicate. A Vercel Cron job runs it daily. See `src/lib/escalation.ts`.
- **Message guardrail.** Drafts are checked for diagnostic wording (EN/AR), numbers not in the record, missing call-back number, links and leaked instructions. `/api/send` re-runs the check and requires a named human confirmation (`403` / `422` otherwise). See `src/lib/guardrail.ts`.
- **Data minimisation.** Only name, date and clinic phone reach the model. Free-text notes are never sent, which also keeps notes-based prompt injection out of the prompt.
- **Tamper-evident audit, locked in Postgres.** Each event is sealed by the server with SHA-256 over the previous hash. Postgres triggers (`src/lib/db/schema.ts`) then enforce, independently of the app:
  - `audit_events` and `escalation_notices` are append-only: `UPDATE`, `DELETE` and `TRUNCATE` raise an error.
  - A new event must extend its ticket's chain: `seq` = previous + 1 and `prev_hash` = previous hash.
  - At commit, a ticket's status must equal its latest audit event's `to_status`.
  - Ticket versions advance by exactly 1 per change (optimistic concurrency).
  - Tickets cannot be deleted. "Reset demo data" starts a new dataset and keeps the old one.
  - Row Level Security is on with no policies, so Supabase's public `anon` and `authenticated` API roles cannot touch the tables.

## Storage

| Environment | Database |
|---|---|
| `DATABASE_URL` or `POSTGRES_URL` set | **Supabase Postgres**: shared by every user and instance |
| Local dev, no URL | **PGlite** (Postgres in WASM), persisted to `./.pglite` |
| Vercel, no URL | PGlite in memory: **not shared** between instances, lost on cold start. The banner warns about this. |

The schema is applied automatically on first connection (idempotent, under an advisory lock). `npm run db:sql` prints it if you prefer to run it in the Supabase SQL editor.

### Connecting Supabase

1. Create a Supabase project, either in Vercel (*Storage → Create → Supabase*, which injects `POSTGRES_URL` automatically) or at supabase.com.
2. If you created it at supabase.com, copy the **Transaction pooler** connection string (port `6543`) from *Connect* and add it to the Vercel project as `DATABASE_URL`.
3. Redeploy. The banner should read "shared database (Supabase Postgres)".

## Run locally

```bash
npm install
npm run dev     # http://localhost:3000, uses PGlite unless DATABASE_URL is set
npm test        # 69 tests, including the Postgres triggers run on PGlite
```

### Environment variables (all optional)

See `.env.example`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `POSTGRES_URL` | Shared Supabase Postgres |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` | Real AI drafting. Without them, a fixed template replaces the AI step and the UI says so. |
| `CRON_SECRET` | If set, `/api/cron/escalations` requires `Authorization: Bearer <secret>`. Vercel Cron sends this automatically. |

## Architecture

Next.js 15 (App Router, TypeScript), Tailwind CSS, Postgres (postgres.js / PGlite), Vitest. Domain logic in `src/lib` is pure and unit-tested. API routes in `src/app/api`:

- `GET /api/state`: the active dataset (records due escalations first)
- `POST /api/transition`: apply any action except sending
- `POST /api/draft`: produce a bilingual draft plus safety findings
- `POST /api/send`: the only path to "notified"; enforces confirmation and the guardrail
- `POST /api/reset`: start a fresh synthetic dataset
- `GET /api/cron/escalations`: daily escalation run

Every write runs in one transaction: lock the ticket row, verify its stored chain, apply the state machine, append the sealed event, bump the version. The client never sends ticket state, only the ticket id and the requested action.

The data model follows FHIR `Task` (ticket) and `DiagnosticReport` (screening result), so it can later map onto an EHR.

## Known gaps (prototype)

- **No authentication or roles:** the user is fixed to "Nurse Mariam K.", so anyone with the link can act.
- **No delivery:** SMS and e-mail are not connected. Messages and escalations are recorded only.
- **Database superusers** can still disable triggers. The triggers stop application bugs and ordinary roles; protecting against a rogue administrator would need external anchoring of the hash chain.
- **Arabic review:** the Arabic safety word list and templates have not been reviewed by a native-speaking clinician.
- **Assumed SLA targets** (`SLA_BUSINESS_DAYS`) still need validation with screening staff.
- **Synthetic data** is generated by `src/lib/seed.ts` and does not come from Synthea.

## Data

All people, phone numbers and results are synthetic and generated by this app. The clinic name and `+971 2 555 xxxx` numbers are fictional.
