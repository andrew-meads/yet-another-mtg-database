import { describe, it, expect, afterEach } from "vitest";
import { isLoginDisabled, noAuthSession, NO_AUTH_USER_ID } from "@/auth";

const original = process.env.DISABLE_LOGIN;

afterEach(() => {
  if (original === undefined) delete process.env.DISABLE_LOGIN;
  else process.env.DISABLE_LOGIN = original;
});

describe("isLoginDisabled", () => {
  it("is true only when DISABLE_LOGIN === 'true'", () => {
    process.env.DISABLE_LOGIN = "true";
    expect(isLoginDisabled()).toBe(true);

    process.env.DISABLE_LOGIN = "false";
    expect(isLoginDisabled()).toBe(false);

    delete process.env.DISABLE_LOGIN;
    expect(isLoginDisabled()).toBe(false);
  });
});

describe("noAuthSession", () => {
  it("identifies the fixed no-auth user", () => {
    expect(NO_AUTH_USER_ID).toBe("000000000000000000000001");
    expect(noAuthSession.user._id).toBe(NO_AUTH_USER_ID);
    expect(new Date(noAuthSession.expires).getTime()).toBeGreaterThan(Date.now());
  });
});
