import { describe, it, expect, vi, beforeEach } from "vitest";
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

import AppBar from "@/components/AppBar";

beforeEach(() => {
  h.session = { data: null, status: "unauthenticated" };
});

describe("AppBar auth states", () => {
  it("shows the Login button and no nav when unauthenticated", () => {
    render(<AppBar />);
    expect(screen.getByText("Login")).toBeInTheDocument();
    expect(screen.queryByText("Sign out")).not.toBeInTheDocument();
    expect(screen.queryByText("Card Search")).not.toBeInTheDocument();
  });

  it("shows the avatar and nav, and no Login button, when authenticated", () => {
    h.session = {
      data: { user: { _id: "abc", name: "Dev User", email: "dev@localhost", image: null } },
      status: "authenticated"
    };
    render(<AppBar />);
    expect(screen.queryByText("Login")).not.toBeInTheDocument();
    // Avatar falls back to the user's initial when there is no image.
    expect(screen.getByText("D")).toBeInTheDocument();
    expect(screen.getByText("Card Search")).toBeInTheDocument();
  });
});
