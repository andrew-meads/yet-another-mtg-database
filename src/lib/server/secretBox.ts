import crypto from "crypto";

/**
 * Seal/open small secrets (e.g. the user's AI API key) for storage in Mongo.
 *
 * When SETTINGS_ENCRYPTION_KEY (64 hex chars = 32 bytes) is set, values are
 * encrypted with AES-256-GCM and stored as "enc.v1.<iv>.<tag>.<ciphertext>"
 * (base64 segments). When it is unset, values are stored as "plain.<value>" with
 * a one-time warning — acceptable for a personal deployment, but set the key in
 * production (see README). `open` handles both formats, so turning encryption on
 * later only affects newly saved secrets.
 */

const ENC_PREFIX = "enc.v1.";
const PLAIN_PREFIX = "plain.";

let warnedAboutMissingKey = false;

function getEncryptionKey(): Buffer | null {
  const hex = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!hex) {
    if (!warnedAboutMissingKey) {
      console.warn(
        "SETTINGS_ENCRYPTION_KEY is not set — secrets in user settings are stored unencrypted. " +
          "Generate one with: openssl rand -hex 32"
      );
      warnedAboutMissingKey = true;
    }
    return null;
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function seal(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) return PLAIN_PREFIX + plaintext;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    ENC_PREFIX +
    [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".")
  );
}

export function open(sealed: string): string {
  if (sealed.startsWith(PLAIN_PREFIX)) return sealed.slice(PLAIN_PREFIX.length);
  if (!sealed.startsWith(ENC_PREFIX)) {
    // Unknown format — treat as a raw legacy value rather than failing hard.
    return sealed;
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error("Cannot decrypt stored secret: SETTINGS_ENCRYPTION_KEY is not set");
  }

  const [ivB64, tagB64, dataB64] = sealed.slice(ENC_PREFIX.length).split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed sealed secret");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final()
  ]).toString("utf8");
}
