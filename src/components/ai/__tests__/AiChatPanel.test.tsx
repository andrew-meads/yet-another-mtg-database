import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "../../../../tests/msw/server";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { _id: "u1" } }, status: "authenticated" })
}));

/**
 * useChat is mocked so the panel's rendering (messages, tool chips, streaming
 * states, send plumbing) is tested without a live transport; the chat route's
 * real streaming behavior is covered by tests/integration/aiChat.test.ts.
 */
const h = {
  configured: true,
  messages: [] as unknown[],
  status: "ready" as string,
  error: undefined as Error | undefined,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  setMessages: vi.fn(),
  clearError: vi.fn()
};

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: h.messages,
    status: h.status,
    error: h.error,
    sendMessage: h.sendMessage,
    stop: h.stop,
    setMessages: h.setMessages,
    clearError: h.clearError
  })
}));

import AiChatPanel from "@/components/ai/AiChatPanel";
import { SearchDocsProvider } from "@/context/SearchDocsContext";
import { AiChatProvider } from "@/context/AiChatContext";

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <SearchDocsProvider>
        <AiChatProvider>
          <AiChatPanel />
        </AiChatProvider>
      </SearchDocsProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  h.configured = true;
  h.messages = [];
  h.status = "ready";
  h.error = undefined;
  h.sendMessage.mockClear();
  h.stop.mockClear();
  h.setMessages.mockClear();
  h.clearError.mockClear();

  server.use(
    http.get("/api/ai/status", () =>
      HttpResponse.json(
        h.configured
          ? { configured: true, model: "gpt-4o-mini", baseUrlHost: "api.openai.com" }
          : { configured: false }
      )
    )
  );
});

describe("AiChatPanel", () => {
  it("shows setup guidance instead of the chat when AI is not configured", async () => {
    h.configured = false;
    renderPanel();

    expect(await screen.findByText(/AI features are not set up yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Chat message")).not.toBeInTheDocument();
  });

  it("renders user and assistant messages including tool-activity chips", async () => {
    h.messages = [
      { id: "m1", role: "user", parts: [{ type: "text", text: "How is my mana base?" }] },
      {
        id: "m2",
        role: "assistant",
        parts: [
          {
            type: "tool-manaBaseStats",
            state: "output-available",
            input: { deckId: "d1" },
            output: { deckName: "Gruul" }
          },
          { type: "text", text: "Your mana base looks solid." }
        ]
      }
    ];
    renderPanel();

    expect(await screen.findByText("How is my mana base?")).toBeInTheDocument();
    expect(screen.getByText("Your mana base looks solid.")).toBeInTheDocument();
    expect(screen.getByTestId("tool-chip")).toHaveTextContent('analyzed mana base of "Gruul"');
  });

  it("renders assistant messages as markdown (bold, lists, tables, code)", async () => {
    h.messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: [
              "Cut **Grizzly Bears** for these:",
              "- run `t:elf mv<=2`",
              "",
              "| Color | Sources |",
              "| --- | --- |",
              "| G | 12 |"
            ].join("\n")
          }
        ]
      }
    ];
    renderPanel();

    const bold = await screen.findByText("Grizzly Bears");
    expect(bold.tagName).toBe("STRONG");
    expect(screen.getByRole("listitem")).toHaveTextContent("run t:elf mv<=2");
    expect(screen.getByText("t:elf mv<=2").tagName).toBe("CODE");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Sources" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "12" })).toBeInTheDocument();
  });

  it("expands a tool chip to show the raw input and result", async () => {
    h.messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "tool-searchMyCards",
            state: "output-available",
            input: { q: "t:creature c:g" },
            output: { total: 3, cards: [{ name: "Llanowar Elves" }] }
          }
        ]
      }
    ];
    renderPanel();

    const chip = await screen.findByTestId("tool-chip");
    expect(screen.queryByTestId("tool-chip-details")).not.toBeInTheDocument();

    fireEvent.click(chip);
    const details = screen.getByTestId("tool-chip-details");
    expect(details).toHaveTextContent('"q": "t:creature c:g"');
    expect(details).toHaveTextContent('"name": "Llanowar Elves"');

    fireEvent.click(chip);
    expect(screen.queryByTestId("tool-chip-details")).not.toBeInTheDocument();
  });

  it("renders reasoning parts collapsed, expandable to the reasoning text", async () => {
    h.messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "reasoning", state: "done", text: "The deck is mono-green, so filter by c:g." },
          { type: "text", text: "Here are my picks." }
        ]
      }
    ];
    renderPanel();

    const block = await screen.findByTestId("reasoning-block");
    expect(block).toHaveTextContent("Reasoning");
    expect(screen.queryByTestId("reasoning-text")).not.toBeInTheDocument();

    fireEvent.click(block);
    expect(screen.getByTestId("reasoning-text")).toHaveTextContent(
      "The deck is mono-green, so filter by c:g."
    );
  });

  it("shows a spinner label while reasoning is still streaming", async () => {
    h.messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "reasoning", state: "streaming", text: "Thinking about the curve" }]
      }
    ];
    renderPanel();

    expect(await screen.findByTestId("reasoning-block")).toHaveTextContent("Reasoning…");
  });

  it("keeps user messages as plain text (no markdown parsing)", async () => {
    h.messages = [
      { id: "m1", role: "user", parts: [{ type: "text", text: "is **this** parsed?" }] }
    ];
    renderPanel();

    expect(await screen.findByText("is **this** parsed?")).toBeInTheDocument();
  });

  it("sends a message with the agent id and context, then clears the input", async () => {
    renderPanel();

    const textarea = await screen.findByLabelText("Chat message");
    fireEvent.change(textarea, { target: { value: "What should I cut?" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(h.sendMessage).toHaveBeenCalledWith(
      { text: "What should I cut?" },
      { body: { agentId: "deck-advisor", context: {} } }
    );
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("shows a streaming indicator and a stop button while busy", async () => {
    h.status = "streaming";
    renderPanel();

    expect(await screen.findByText("Thinking…")).toBeInTheDocument();
    const stopButton = screen.getByLabelText("Stop response");
    fireEvent.click(stopButton);
    expect(h.stop).toHaveBeenCalled();
    expect(screen.queryByLabelText("Send message")).not.toBeInTheDocument();
  });

  it("does not send while busy", async () => {
    h.status = "streaming";
    renderPanel();

    const textarea = await screen.findByLabelText("Chat message");
    fireEvent.change(textarea, { target: { value: "another question" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it("surfaces stream errors", async () => {
    h.error = new Error("upstream exploded");
    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent("upstream exploded");
  });

  it("clears the transcript on New chat", async () => {
    h.messages = [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }];
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "New chat" }));
    expect(h.stop).toHaveBeenCalled();
    expect(h.setMessages).toHaveBeenCalledWith([]);
  });
});
