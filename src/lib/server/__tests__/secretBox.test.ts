import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { seal, open } from "@/lib/server/secretBox";

const TEST_KEY = "a".repeat(64); // 64 hex chars = 32 bytes

const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
  else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
});

describe("secretBox with SETTINGS_ENCRYPTION_KEY set", () => {
  beforeEach(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = TEST_KEY;
  });

  it("round-trips a secret", () => {
    const sealed = seal("sk-test-1234");
    expect(open(sealed)).toBe("sk-test-1234");
  });

  it("does not contain the plaintext in the sealed value", () => {
    const sealed = seal("sk-test-1234");
    expect(sealed).toContain("enc.v1.");
    expect(sealed).not.toContain("sk-test-1234");
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    expect(seal("same")).not.toBe(seal("same"));
  });

  it("throws on a tampered ciphertext", () => {
    const sealed = seal("sk-test-1234");
    const parts = sealed.slice("enc.v1.".length).split(".");
    // Flip the ciphertext segment.
    const tampered = "enc.v1." + [parts[0], parts[1], parts[2].slice(0, -4) + "AAAA"].join(".");
    expect(() => open(tampered)).toThrow();
  });

  it("still opens a value stored before encryption was enabled", () => {
    expect(open("plain.sk-old-key")).toBe("sk-old-key");
  });

  it("rejects a malformed key", () => {
    process.env.SETTINGS_ENCRYPTION_KEY = "not-hex";
    expect(() => seal("x")).toThrow(/64 hex/);
  });
});

describe("secretBox without SETTINGS_ENCRYPTION_KEY", () => {
  beforeEach(() => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
  });

  it("round-trips via the plain format", () => {
    const sealed = seal("sk-test-1234");
    expect(sealed).toBe("plain.sk-test-1234");
    expect(open(sealed)).toBe("sk-test-1234");
  });

  it("cannot open an encrypted value", () => {
    process.env.SETTINGS_ENCRYPTION_KEY = TEST_KEY;
    const sealed = seal("sk-test-1234");
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    expect(() => open(sealed)).toThrow(/SETTINGS_ENCRYPTION_KEY/);
  });
});
