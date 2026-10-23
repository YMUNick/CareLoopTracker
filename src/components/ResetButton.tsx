"use client";

import { useState } from "react";
import { resetDemo } from "@/lib/store";

export function ResetButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="ml-auto underline underline-offset-2 hover:no-underline disabled:opacity-50"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Start a fresh synthetic dataset for everyone? The current one is kept in the audit history but hidden.")) return;
        setBusy(true);
        try {
          await resetDemo();
        } catch (e) {
          alert(`Reset failed: ${(e as Error).message}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Resetting…" : "Reset demo data"}
    </button>
  );
}
