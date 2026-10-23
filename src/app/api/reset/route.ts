import { NextResponse } from "next/server";
import { startNewDataset } from "@/lib/db/repo";
import { withDb } from "@/lib/server";

export const dynamic = "force-dynamic";

// Starts a fresh synthetic dataset. Nothing is deleted: audit history is
// append-only, so the previous dataset stays in the database, just inactive.
export async function POST() {
  return withDb(async (db) => NextResponse.json({ datasetId: await startNewDataset(db) }));
}
