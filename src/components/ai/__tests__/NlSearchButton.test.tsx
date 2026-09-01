import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "../../../../tests/msw/server";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { _id: "u1" } }, status: "authenticated" })
}));

import NlSearchButton from "@/components/ai/NlSearchButton";

const h = {
  configured: true,
  translateBodies: [] as unknown[],
  translateResponse: { query: "t:goblin c:r", notes: undefined as string | undefined },
  translateStatus: 200
};

function renderButton(onQuery = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <NlSearchButton onQuery={onQuery} />
    </QueryClientProvider>
  );
  return onQuery;
}

beforeEach(() => {
  h.configured = true;
  h.translateBodies = [];
  h.translateResponse = { query: "t:goblin c:r", notes: undefined };
  h.translateStatus = 200;

  server.use(
    http.get("/api/ai/status", () =>
      HttpResponse.json(
        h.configured
          ? { configured: true, model: "gpt-4o-mini", baseUrlHost: "api.openai.com" }
          : { configured: false }
      )
    ),
    http.post("/api/ai/translate-search", async ({ request }) => {
      h.translateBodies.push(await request.json());
      if (h.translateStatus !== 200) {
        return HttpResponse.json({ error: "boom" }, { status: h.translateStatus });
      }
      return HttpResponse.json(h.translateResponse);
    })
  );
});

describe("NlSearchButton", () => {
  it("shows setup guidance when AI is not configured", async () => {
    h.configured = false;
    renderButton();

    fireEvent.click(screen.getByLabelText("AI search"));
    expect(await screen.findByText(/AI features are not set up yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Settings → AI Assistant/ })).toHaveAttribute(
      "href",
      "/settings"
    );
    expect(screen.queryByRole("button", { name: "Translate" })).not.toBeInTheDocument();
  });

  it("translates a prompt and hands the query to the search bar", async () => {
    const onQuery = renderButton();

    fireEvent.click(screen.getByLabelText("AI search"));
    const textarea = await screen.findByPlaceholderText(/cheap green creatures/);
    fireEvent.change(textarea, { target: { value: "red goblins" } });
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));

    await waitFor(() => expect(onQuery).toHaveBeenCalledWith("t:goblin c:r"));
    expect(h.translateBodies).toEqual([{ prompt: "red goblins" }]);
    // The popover closes after a successful translation.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Translate" })).not.toBeInTheDocument()
    );
  });

  it("submits on Enter (without shift)", async () => {
    const onQuery = renderButton();

    fireEvent.click(screen.getByLabelText("AI search"));
    const textarea = await screen.findByPlaceholderText(/cheap green creatures/);
    fireEvent.change(textarea, { target: { value: "red goblins" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onQuery).toHaveBeenCalledWith("t:goblin c:r"));
  });

  it("keeps the popover open and does not call onQuery when translation fails", async () => {
    h.translateStatus = 502;
    const onQuery = renderButton();

    fireEvent.click(screen.getByLabelText("AI search"));
    const textarea = await screen.findByPlaceholderText(/cheap green creatures/);
    fireEvent.change(textarea, { target: { value: "red goblins" } });
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));

    await waitFor(() => expect(h.translateBodies).toHaveLength(1));
    expect(onQuery).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Translate" })).toBeInTheDocument();
  });

  it("disables Translate while the prompt is empty", async () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("AI search"));
    expect(await screen.findByRole("button", { name: "Translate" })).toBeDisabled();
  });
});
