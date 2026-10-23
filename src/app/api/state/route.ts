import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { snapshot } from "@/lib/db/repo";
import { jsonError } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    return NextResponse.json({ ...(await snapshot(db)), storage: db.kind, shared: db.kind === "supabase" || !process.env.VERCEL });
  } catch (e) {
    console.error(e);
    return jsonError(500, "Could not load data from storage.");
  }
}
