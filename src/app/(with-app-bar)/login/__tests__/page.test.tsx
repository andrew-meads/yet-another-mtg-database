import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientSafeProvider } from "next-auth/react";

const h = vi.hoisted(() => ({
  signIn: vi.fn(),
  providers: {} as Record<string, unknown>
}));

vi.mock("next-auth/react", () => ({
  signIn: h.signIn,
  getProviders: () => Promise.resolve(h.providers)
}));

import LoginPage from "../page";

function provider(id: string): ClientSafeProvider {
  return {
    id,
    name: id,
    type: id === "google" ? "oauth" : "credentials",
    signinUrl: `/api/auth/signin/${id}`,
    callbackUrl: `/api/auth/callback/${id}`
  } as ClientSafeProvider;
}

beforeEach(() => {
  h.signIn.mockClear();
});

describe("LoginPage dev login button", () => {
  it("shows the dev button when the dev-login provider is registered and signs in with it", async () => {
    h.providers = { google: provider("google"), "dev-login": provider("dev-login") };
    render(<LoginPage />);

    const devButton = await screen.findByText("Continue as dev user");
    expect(screen.getByText("Sign in with Google")).toBeInTheDocument();

    await userEvent.click(devButton);
    expect(h.signIn).toHaveBeenCalledWith("dev-login", { callbackUrl: "/search" });
  });

  it("hides the dev button when only Google is registered", async () => {
    h.providers = { google: provider("google") };
    render(<LoginPage />);

    // Flush the getProviders fetch before asserting the button stayed hidden
    // (the Google button renders immediately, so it can't be waited on).
    await act(async () => {});
    expect(screen.getByText("Sign in with Google")).toBeInTheDocument();
    expect(screen.queryByText("Continue as dev user")).not.toBeInTheDocument();
  });
});
