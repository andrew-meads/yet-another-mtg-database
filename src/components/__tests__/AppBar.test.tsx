import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  signOut: vi.fn(),
  session: { data: null as unknown, status: "unauthenticated" as string }
}));

vi.mock("next-auth/react", () => ({
  useSession: () => h.session,
  signOut: h.signOut
}));

vi.mock("@/hooks/useIsDesktop", () => ({
  useIsDesktop: () => ({ isDesktop: true, mounted: true })
}));

// AppBar renders the open-collections buttons, which pull in query/dnd hooks not
// under test here — stub them out.
vi.mock("@/components/OpenCollectionButtons", () => ({
  __esModule: true,
  default: () => null,
  OpenCollectionsList: () => null
}));

import { AuthModeProvider } from "@/context/AuthModeContext";
import AppBar from "@/components/AppBar";

function renderAppBar(disableLogin: boolean) {
  return render(
    <AuthModeProvider disableLogin={disableLogin}>
      <AppBar />
    </AuthModeProvider>
  );
}

describe("AppBar no-auth mode", () => {
  it("shows the no-auth indicator and no sign-out/login when login is disabled", () => {
    renderAppBar(true);
    expect(screen.getByText("No-auth mode")).toBeInTheDocument();
    expect(screen.queryByText("Sign out")).not.toBeInTheDocument();
    expect(screen.queryByText("Login")).not.toBeInTheDocument();
  });

  it("shows the Login button in normal mode when unauthenticated", () => {
    renderAppBar(false);
    expect(screen.queryByText("No-auth mode")).not.toBeInTheDocument();
    expect(screen.getByText("Login")).toBeInTheDocument();
  });
});
