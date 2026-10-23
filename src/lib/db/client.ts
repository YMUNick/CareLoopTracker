import { SCHEMA_SQL } from "./schema";

// One small interface over two drivers:
//   * DATABASE_URL / POSTGRES_URL set → postgres.js against Supabase (shared).
//   * otherwise → PGlite, real Postgres compiled to WASM, in-process. Local dev
//     persists to ./.pglite; on Vercel it lives in memory per instance and is
//     NOT shared, which the UI points out.

export type Row = Record<string, unknown>;
export interface Query {
  <T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
}
export interface Db {
  kind: "supabase" | "pglite";
  query: Query;
  tx<R>(fn: (q: Query) => Promise<R>): Promise<R>;
  exec(script: string): Promise<void>;
}

const MIGRATION_LOCK = 734_911;

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

async function postgresDb(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // prepare:false is required behind Supabase's transaction pooler (port 6543).
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, ssl: local ? false : "require" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Unsafe = { unsafe: (text: string, params?: any[]) => PromiseLike<unknown> };
  const wrap = (s: Unsafe): Query =>
    (async (text: string, params: unknown[] = []) => (await s.unsafe(text, params)) as Row[]) as Query;
  return {
    kind: "supabase",
    query: wrap(sql),
    tx: async (fn) => (await sql.begin((t) => fn(wrap(t)))) as never,
    exec: async (script) => {
      await sql.begin(async (t) => {
        await t.unsafe(`select pg_advisory_xact_lock(${MIGRATION_LOCK})`);
        await t.unsafe(script);
      });
    },
  };
}

export async function pgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  const wrap = (s: { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Query =>
    (async (text: string, params: unknown[] = []) => (await s.query(text, params)).rows as Row[]) as Query;
  return {
    kind: "pglite",
    query: wrap(pg),
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
    exec: async (script) => {
      await pg.exec(script);
    },
  };
}

let dbPromise: Promise<Db> | null = null;

/** Connected, migrated database (memoised per server instance). */
export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const url = databaseUrl();
      const dir = process.env.VERCEL ? undefined : process.env.PGLITE_DIR ?? "./.pglite";
      const db = url ? await postgresDb(url) : await pgliteDb(dir);
      await db.exec(SCHEMA_SQL);
      return db;
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}
