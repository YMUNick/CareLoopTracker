import { NextResponse } from "next/server";
import { runEscalations } from "@/lib/db/repo";
import { jsonError, withDb } from "@/lib/server";

export const dynamic = "force-dynamic";

// Called daily by Vercel Cron (see vercel.json). Safe to call any number of
// times: each notice is keyed and recorded at most once.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return jsonError(401, "Unauthorized.");
  return withDb(async (db, ds) => {
    const recorded = await runEscalations(db, ds);
    return NextResponse.json({ recorded: recorded.length, notices: recorded });
  });
}
