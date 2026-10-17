// Signatures for the Command Center. The same three functions exist in the
// phone app (lib/command.ts) and the desktop agent (fiarep-agent/agent.mjs);
// the strings must match byte for byte.
import { createHash, createPublicKey, verify } from "node:crypto";

/** JSON with object keys sorted at every level. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export const sha256hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** Signed by the device key on every request. */
export function requestMessage(method: string, path: string, time: string, bodyHash: string): string {
  return `FIAREP-CMD-REQ\n${method.toUpperCase()}\n${path}\n${time}\n${bodyHash}`;
}

/** Signed by the Face ID confirm key to approve one action. */
export function confirmMessage(a: { id: string; action: string; target: string; params: unknown; nonce: string; expiresAt: number }): string {
  return `FIAREP-CMD-CONFIRM\n${a.id}\n${a.action}\n${a.target}\n${sha256hex(canonicalJson(a.params))}\n${a.nonce}\n${a.expiresAt}`;
}

/** Raw 32-byte Ed25519 public key (base64) → is it a valid key? */
export function isEd25519Key(b64: string): boolean {
  try { publicKey(b64); return true; } catch { return false; }
}

function publicKey(b64: string) {
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) throw new Error("Ed25519 key must be 32 bytes");
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
}

export function verifyEd25519(publicKeyB64: string, message: string, signatureB64: string): boolean {
  try {
    const sig = Buffer.from(signatureB64, "base64");
    if (sig.length !== 64) return false;
    return verify(null, Buffer.from(message, "utf8"), publicKey(publicKeyB64), sig);
  } catch {
    return false;
  }
}
