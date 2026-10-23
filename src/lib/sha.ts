import type { Sha256Hex } from "./audit";

/** SHA-256 via Web Crypto — available in modern browsers and Node 18+. */
export const sha256Hex: Sha256Hex = async (input) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
};
