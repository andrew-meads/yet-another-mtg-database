import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "../../../../tests/msw/server";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { _id: "u1" } }, status: "authenticated" })
}));

import AiSettingsSection from "@/components/settings/AiSettingsSection";

const h = {
  settings: {} as Record<string, unknown>,
  putBodies: [] as unknown[],
  testCalls: 0,
  testOk: true
};

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={client}>
      <AiSettingsSection />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  h.settings = {};
  h.putBodies = [];
  h.testCalls = 0;
  h.testOk = true;

  server.use(
    http.get("/api/settings", () => HttpResponse.json({ settings: h.settings })),
    http.put("/api/settings/ai", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      h.putBodies.push(body);
      return HttpResponse.json({
        settings: {
          ai: {
            baseUrl: body.baseUrl || undefined,
            model: body.model || undefined,
            hasApiKey: body.apiKey !== "" && body.apiKey !== undefined,
            apiKeyHint: typeof body.apiKey === "string" && body.apiKey !== "" ? "…mock" : undefined
          }
        }
      });
    }),
    http.post("/api/ai/status/test", () => {
      h.testCalls += 1;
      return h.testOk
        ? HttpResponse.json({ ok: true })
        : HttpResponse.json({ ok: false, error: "bad key" }, { status: 502 });
    })
  );
});

describe("AiSettingsSection", () => {
  it("shows the not-configured state for a fresh user", async () => {
    renderSection();
    expect(await screen.findByTestId("ai-configured-status")).toHaveTextContent(
      "Not configured"
    );
    expect(screen.getByRole("button", { name: /test connection/i })).toBeDisabled();
  });

  /** Wait until the form has initialized from the (async) settings query. */
  async function waitForModelValue(value: string) {
    await waitFor(() =>
      expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe(value)
    );
  }

  it("shows the masked key hint and configured state from the server settings", async () => {
    h.settings = {
      ai: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        hasApiKey: true,
        apiKeyHint: "…abcd"
      }
    };
    renderSection();

    await waitFor(() =>
      expect(screen.getByTestId("ai-configured-status")).toHaveTextContent("Configured")
    );
    expect(screen.getByText(/A key is saved \(…abcd\)/)).toBeInTheDocument();
    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("gpt-4o-mini");
    // The raw key never appears anywhere.
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  });

  it("saves base URL and model without touching the stored key when the field is empty", async () => {
    h.settings = { ai: { model: "gpt-4o-mini", hasApiKey: true, apiKeyHint: "…abcd" } };
    renderSection();
    await waitForModelValue("gpt-4o-mini");

    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-4o" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(h.putBodies).toHaveLength(1));
    expect(h.putBodies[0]).toEqual({ baseUrl: "", model: "gpt-4o" }); // no apiKey field
  });

  it("includes the API key when one is typed", async () => {
    h.settings = { ai: { model: "gpt-4o-mini", hasApiKey: false } };
    renderSection();
    await waitForModelValue("gpt-4o-mini");

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(h.putBodies).toHaveLength(1));
    expect(h.putBodies[0]).toEqual({ baseUrl: "", model: "gpt-4o-mini", apiKey: "sk-new" });
    // The field is cleared after a successful save.
    await waitFor(() =>
      expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("")
    );
  });

  it("removes the stored key via the Remove key button", async () => {
    h.settings = { ai: { model: "gpt-4o-mini", hasApiKey: true, apiKeyHint: "…abcd" } };
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Remove key" }));

    await waitFor(() => expect(h.putBodies).toHaveLength(1));
    expect(h.putBodies[0]).toEqual({ apiKey: "" });
  });

  it("fires the connection test when configured", async () => {
    h.settings = { ai: { model: "gpt-4o-mini", hasApiKey: true } };
    renderSection();

    const testButton = screen.getByRole("button", { name: /test connection/i });
    await waitFor(() => expect(testButton).toBeEnabled());
    fireEvent.click(testButton);

    await waitFor(() => expect(h.testCalls).toBe(1));
  });
});
