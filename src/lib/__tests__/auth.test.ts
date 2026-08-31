import { describe, it, expect, afterEach, vi } from "vitest";
import { isDevLoginEnabled, DEV_USER_ID, DEV_USER_EMAIL } from "@/auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isDevLoginEnabled", () => {
  it("is true only when AUTH_DEV_LOGIN === 'true' outside production", () => {
    // NODE_ENV is "test" under Vitest — i.e. not production.
    vi.stubEnv("AUTH_DEV_LOGIN", "true");
    expect(isDevLoginEnabled()).toBe(true);

    vi.stubEnv("AUTH_DEV_LOGIN", "false");
    expect(isDevLoginEnabled()).toBe(false);

    vi.stubEnv("AUTH_DEV_LOGIN", undefined);
    expect(isDevLoginEnabled()).toBe(false);
  });

  it("is false in production even when the flag is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_DEV_LOGIN", "true");
    expect(isDevLoginEnabled()).toBe(false);
  });
});

describe("dev-login provider registration", () => {
  // The provider spread is evaluated at module load, so re-import @/auth fresh
  // under each env combination.
  afterEach(() => {
    vi.resetModules();
  });

  async function loadProviderIds(): Promise<string[]> {
    vi.resetModules();
    const { authOptions } = await import("@/auth");
    // A custom id given to a provider factory sits in `options` on the raw
    // config; NextAuth merges it over the default id at runtime.
    return authOptions.providers.map(
      (p) => (p as { options?: { id?: string } }).options?.id ?? p.id
    );
  }

  it("registers the dev-login provider when enabled", async () => {
    vi.stubEnv("AUTH_DEV_LOGIN", "true");
    expect(await loadProviderIds()).toContain("dev-login");
  });

  it("does not register it when the flag is off", async () => {
    vi.stubEnv("AUTH_DEV_LOGIN", "false");
    expect(await loadProviderIds()).toEqual(["google"]);
  });

  it("does not register it in production even when the flag is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_DEV_LOGIN", "true");
    expect(await loadProviderIds()).toEqual(["google"]);
  });
});

describe("dev user constants", () => {
  it("identifies the fixed dev user", () => {
    expect(DEV_USER_ID).toBe("000000000000000000000001");
    expect(DEV_USER_EMAIL).toBe("dev@localhost");
  });
});
