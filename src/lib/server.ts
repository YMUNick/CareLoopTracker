import { NextResponse } from "next/server";
import { getDb, type Db } from "./db/client";
import { activeDataset, ChangeRejected } from "./db/repo";

// Shared plumbing for the API routes. Tickets are read from the database on
// every request, so the client can never supply (or tamper with) the state a
// change is applied to.

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function withDb(handler: (db: Db, datasetId: string) => Promise<Response>): Promise<Response> {
  try {
    const db = await getDb();
    const ds = await activeDataset(db);
    return await handler(db, ds.id);
  } catch (e) {
    if (e instanceof ChangeRejected) return jsonError(e.status, e.message, e.extra);
    console.error(e);
    return jsonError(500, "Storage error. Nothing was changed.");
  }
}

export async function readJson<T>(req: Request): Promise<T | null> {
  return (await req.json().catch(() => null)) as T | null;
}
