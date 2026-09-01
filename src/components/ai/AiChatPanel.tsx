"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { CircleAlert, Loader2, Send, Square, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import AiNotConfigured from "@/components/ai/AiNotConfigured";
import ChatMarkdown from "@/components/ai/ChatMarkdown";
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
        if (part.type.startsWith("tool-")) {
          return <ToolChip key={index} part={part as unknown as ToolPartLike} />;
        }
        return null;
      })}
    </div>
  );
}

/** Activity chip for one tool call ("🔧 searched cards: t:goblin (14 matches)"). */
function ToolChip({ part }: { part: ToolPartLike }) {
  const failed = isToolPartError(part);
  const running = part.state === "input-streaming" || part.state === "input-available";
  return (
    <div
      className={cn(
        "text-muted-foreground bg-muted/50 flex w-fit max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
        failed && "border-destructive/50 text-destructive"
      )}
      data-testid="tool-chip"
    >
      {failed ? (
        <CircleAlert className="size-3 shrink-0" />
      ) : running ? (
        <Loader2 className="size-3 shrink-0 animate-spin" />
      ) : (
        <Wrench className="size-3 shrink-0" />
      )}
      <span className="truncate">{describeToolPart(part)}</span>
    </div>
  );
}
