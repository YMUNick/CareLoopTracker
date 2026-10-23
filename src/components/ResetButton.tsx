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
        if (!confirm("Reset all demo data to the initial synthetic set?")) return;
        setBusy(true);
        await resetDemo();
        setBusy(false);
      }}
    >
      {busy ? "Resetting…" : "Reset demo data"}
    </button>
  );
}
