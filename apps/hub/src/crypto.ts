import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Separate keys for separate purposes, all derived from SECRETS_KEY. */
const derive = (secret: string, purpose: string) => createHash("sha256").update(`${purpose}\0${secret}`).digest();

export class Secrets {
  readonly #encKey: Buffer;
  readonly #macKey: Buffer;

  constructor(secretsKey: string) {
    this.#encKey = derive(secretsKey, "agent-office/enc/v1");
    this.#macKey = derive(secretsKey, "agent-office/mac/v1");
  }

  /** AES-256-GCM. Output: base64url(iv[12] | tag[16] | ciphertext). */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#encKey, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
  }

  decrypt(token: string): string {
    const buf = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", this.#encKey, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  }

  sign(value: string): string {
    return createHmac("sha256", this.#macKey).update(value).digest("base64url");
  }

  verify(value: string, signature: string): boolean {
    return safeEqual(this.sign(value), signature);
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** For high-entropy tokens a plain SHA-256 is enough (no need for a slow KDF). */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

/** Human-friendly one-time code, e.g. "K7PD-Q2XM". */
export function pairingCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const keyHint = (key: string) => (key.length >= 8 ? `••••${key.slice(-4)}` : "••••");
