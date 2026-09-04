import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFound from "../not-found";

describe("NotFound page", () => {
  it("shows the mascot, the 404 message, and links back into the app", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { name: "Noughty ate this page" })).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/noughty-404.png");
    expect(screen.getByRole("link", { name: "Take me home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "My cards" })).toHaveAttribute("href", "/my-cards");
  });
});
