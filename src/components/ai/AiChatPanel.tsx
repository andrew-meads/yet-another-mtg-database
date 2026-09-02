"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Brain, ChevronDown, ChevronRight, CircleAlert, Loader2, Send, Square, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import AiNotConfigured from "@/components/ai/AiNotConfigured";
import ChatMarkdown from "@/components/ai/ChatMarkdown";
import ProposalCard, { DeckChangeProposal } from "@/components/ai/ProposalCard";
import { describeToolPart, isToolPartError, ToolPartLike } from "@/components/ai/toolPartLabel";
import { useAiChat } from "@/context/AiChatContext";
import { useAiStatus } from "@/hooks/react-query/useAiStatus";

export interface AiChatPanelProps {
  /** Placement / sizing classes supplied by the host layout. */
  className?: string;
}

const AGENT_ID = "deck-advisor";

/**
 * Docked, non-modal AI chat panel (the deck advisor). Mirrors
 * {@link SearchDocsPanel}: an in-flow flex sibling in {@link MainWorkspace}, so
 * opening it reflows the workspace instead of overlaying it. Conversation state
 * is client-held (`useChat` resends the transcript per turn) and survives the
 * panel being closed and reopened, but not a page reload.
 */
export default function AiChatPanel({ className }: AiChatPanelProps) {
  const { setOpen, chatContext } = useAiChat();
  const { data: status } = useAiStatus();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/ai/chat" }), []);
  const chat = useChat({ transport });
  const { messages, sendMessage, status: chatStatus, stop, setMessages, error, clearError } = chat;

  const busy = chatStatus === "submitted" || chatStatus === "streaming";
  const configured = status?.configured === true;

  // Keep the newest message in view while streaming.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, chatStatus]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || busy) return;
    clearError();
    // agentId + viewed-entity context ride along on every request.
    sendMessage({ text }, { body: { agentId: AGENT_ID, context: chatContext } });
    setInput("");
  };

  return (
    <aside
      aria-label="AI deck advisor panel"
      className={cn(
        "bg-background flex h-full flex-col overflow-hidden rounded-md border",
        className
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b p-3">
        <h2 className="text-foreground font-semibold">Deck advisor</h2>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              stop();
              setMessages([]);
              clearError();
            }}
            disabled={messages.length === 0}
          >
            New chat
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpen(false)}
            aria-label="Close AI chat"
          >
            <X />
          </Button>
        </div>
      </div>

      {!configured ? (
        <div className="flex-1 overflow-y-auto p-4">
          <AiNotConfigured />
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 && (
              <p className="text-muted-foreground p-2 text-sm">
                Ask about your deck&apos;s mana base, what to cut or add, cards you own that could
                fit, or how a card or rule works.
              </p>
            )}
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {busy && (
              <div className="text-muted-foreground flex items-center gap-2 px-2 text-sm">
                <Loader2 className="size-3.5 animate-spin" />
                Thinking…
              </div>
            )}
            {error && (
              <div
                className="border-destructive bg-destructive/10 text-destructive rounded-md border p-2 text-sm"
                role="alert"
              >
                {error.message || "The AI request failed."}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t p-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask the deck advisor…"
                rows={2}
                className="min-h-0 resize-none"
                aria-label="Chat message"
              />
              {busy ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => stop()}
                  aria-label="Stop response"
                >
                  <Square />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  onClick={handleSend}
                  disabled={input.trim() === ""}
                  aria-label="Send message"
                >
                  <Send />
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

function ChatMessage({ message }: { message: UIMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
          {message.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as { text: string }).text)
            .join("")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          const text = (part as { text: string }).text;
          if (!text) return null;
          return <ChatMarkdown key={index} text={text} />;
        }
        if (part.type === "reasoning") {
          return (
            <ReasoningBlock
              key={index}
              part={part as unknown as { text?: string; state?: string }}
            />
          );
        }
        if (part.type.startsWith("tool-")) {
          const toolPart = part as unknown as ToolPartLike;
          // A validated proposal renders as an interactive apply card; while
          // running (or when rejected in-band) it stays a normal chip.
          const proposal =
            part.type === "tool-proposeDeckChanges" && toolPart.state === "output-available"
              ? (toolPart.output as { proposal?: DeckChangeProposal } | undefined)?.proposal
              : undefined;
          if (proposal) return <ProposalCard key={index} proposal={proposal} />;
          return <ToolChip key={index} part={toolPart} />;
        }
        return null;
      })}
    </div>
  );
}

/** Pretty-print any tool input/output value for the debug expansion. */
function pretty(value: unknown): string {
  if (value === undefined) return "(none yet)";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Activity chip for one tool call ("🔧 searched cards: t:goblin (14 matches)").
 * Click to expand the raw input and result the model actually exchanged —
 * the debug view for "what did that tool really return?".
 */
function ToolChip({ part }: { part: ToolPartLike }) {
  const [expanded, setExpanded] = useState(false);
  const failed = isToolPartError(part);
  const running = part.state === "input-streaming" || part.state === "input-available";
  return (
    <div className="max-w-full">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={cn(
          "text-muted-foreground bg-muted/50 hover:bg-muted flex w-fit max-w-full cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
          failed && "border-destructive/50 text-destructive"
        )}
        data-testid="tool-chip"
        aria-expanded={expanded}
      >
        {failed ? (
          <CircleAlert className="size-3 shrink-0" />
        ) : running ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : (
          <Wrench className="size-3 shrink-0" />
        )}
        <span className="truncate">{describeToolPart(part)}</span>
        {expanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
      </button>
      {expanded && (
        <div
          className="bg-muted/30 mt-1 space-y-1 rounded-md border p-2 text-xs"
          data-testid="tool-chip-details"
        >
          <div className="text-muted-foreground font-semibold">Input</div>
          <pre className="max-h-48 overflow-auto font-mono whitespace-pre-wrap break-all">
            {pretty(part.input)}
          </pre>
          <div className="text-muted-foreground font-semibold">
            {part.state === "output-error" ? "Error" : "Result"}
          </div>
          <pre className="max-h-48 overflow-auto font-mono whitespace-pre-wrap break-all">
            {part.state === "output-error" ? (part.errorText ?? "(unknown error)") : pretty(part.output)}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * The model's chain-of-thought, when the provider streams it
 * (`reasoning_content` on OpenAI-compatible endpoints). Collapsed by default;
 * the header spins while reasoning is still streaming — so a "thinking forever"
 * turn shows you what the model is actually chewing on.
 */
function ReasoningBlock({ part }: { part: { text?: string; state?: string } }) {
  const [expanded, setExpanded] = useState(false);
  const streaming = part.state === "streaming";
  return (
    <div className="max-w-full">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="text-muted-foreground hover:bg-muted flex w-fit max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs"
        data-testid="reasoning-block"
        aria-expanded={expanded}
      >
        {streaming ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : (
          <Brain className="size-3 shrink-0" />
        )}
        <span>{streaming ? "Reasoning…" : "Reasoning"}</span>
        {expanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
      </button>
      {expanded && (
        <div
          className="text-muted-foreground bg-muted/30 mt-1 max-h-64 overflow-auto rounded-md border border-dashed p-2 text-xs whitespace-pre-wrap italic"
          data-testid="reasoning-text"
        >
          {part.text || "(no reasoning text yet)"}
        </div>
      )}
    </div>
  );
}
