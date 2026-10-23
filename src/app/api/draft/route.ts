import { NextResponse } from "next/server";
import { azureConfigured, azureDraft, draftContext, draftInput, simulatedFaultyDraft, templateDraft } from "@/lib/drafts";
import { checkBilingual } from "@/lib/guardrail";
import { readTicket } from "@/lib/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const read = await readTicket(body);
  if ("error" in read) return read.error;
  const { ticket } = read;
  const simulateError = Boolean((body as { simulateError?: boolean }).simulateError);

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
}
