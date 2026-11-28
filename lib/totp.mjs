import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Two-factor sign-in with an authenticator app (RFC 6238 TOTP: SHA-1, 6 digits, 30-second steps), recovery codes, and
 * encryption of the stored secret with a key derived from AUTH_SECRET. Pure functions; lib/two-factor.ts stores them.
 */
export const STEP_SECONDS = 30;
export const DIGITS = 6;
/** Codes from one step before or after are accepted, for a phone clock that is slightly off. */
export const WINDOW = 1;
export const RECOVERY_CODES = 10;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes) {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Invalid base32");
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function newSecret() {
  return base32Encode(randomBytes(20));
}

export function stepAt(ms) {
  return Math.floor(ms / 1000 / STEP_SECONDS);
}

/** The code for one time step (RFC 4226 dynamic truncation). */
export function codeForStep(secretBase32, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const number = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(number % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * The matching step for a typed code within the window, or null. `lastStep` is the newest step already used: a code
 * from that step or older is refused, so a code seen over someone's shoulder cannot be used again.
 */
export function verifyCode(secretBase32, typed, nowMs, lastStep = -1) {
  const code = String(typed ?? "").replace(/\s/g, "");
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(code)) return null;
  const now = stepAt(nowMs);
  for (let step = now - WINDOW; step <= now + WINDOW; step += 1) {
    if (step <= lastStep) continue;
    const expected = Buffer.from(codeForStep(secretBase32, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** otpauth:// link for authenticator apps (tap on the phone, or type the key). */
export function otpauthUrl(secretBase32, account, issuer = "Flockence") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** Ten recovery codes like "k7qm-2xpd"; only their hashes are stored. */
export function newRecoveryCodes() {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: RECOVERY_CODES }, () => {
    const bytes = randomBytes(8);
    const chars = [...bytes].map((b) => letters[b % letters.length]).join("");
    return chars.slice(0, 4) + "-" + chars.slice(4, 8);
  });
}

export function hashRecoveryCode(code) {
  return createHash("sha256").update(String(code).toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");
}

/** The index of a matching unused recovery code hash, or -1. */
export function findRecoveryCode(hashes, typed) {
  const hash = hashRecoveryCode(typed ?? "");
  return (hashes ?? []).findIndex((h) => h === hash);
}

function keyFrom(authSecret) {
  if (!authSecret || authSecret.length < 32) throw new Error("AUTH_SECRET must be configured with at least 32 characters.");
  return createHash("sha256").update("flockence-totp-v1:" + authSecret).digest();
}

export function encryptSecret(secretBase32, authSecret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(authSecret), iv);
  const data = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(sealed, authSecret) {
  const [iv, tag, data] = String(sealed).split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(authSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
