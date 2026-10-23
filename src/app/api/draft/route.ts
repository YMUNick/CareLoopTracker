import { NextResponse } from "next/server";
import { getTicket } from "@/lib/db/repo";
import { azureConfigured, azureDraft, draftContext, draftInput, simulatedFaultyDraft, templateDraft } from "@/lib/drafts";
import { checkBilingual } from "@/lib/guardrail";
import { jsonError, readJson, withDb } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ ticketId?: string; simulateError?: boolean }>(req);
  if (!body?.ticketId) return jsonError(400, "ticketId is required.");
  const { ticketId, simulateError } = body;

  return withDb(async (db, ds) => {
    const ticket = await getTicket(db, ds, ticketId);
    if (!ticket) return jsonError(404, `Ticket ${ticketId} not found.`);

    const input = draftInput(ticket);
    let draft;
    let warning: string | undefined;
    if (simulateError) {
      draft = simulatedFaultyDraft(input);
    } else if (azureConfigured()) {
      try {
        draft = await azureDraft(input);
      } catch (e) {
        draft = templateDraft(input);
        warning = `AI drafting failed (${(e as Error).message}); fell back to the template.`;
      }
    } else {
      draft = templateDraft(input);
    }

    return NextResponse.json({
      draft,
      findings: checkBilingual(draft.en, draft.ar, draftContext(ticket)),
      aiConfigured: azureConfigured(),
      warning,
    });
  });
}
