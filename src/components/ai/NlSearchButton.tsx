"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import AiNotConfigured from "@/components/ai/AiNotConfigured";
import { useAiStatus } from "@/hooks/react-query/useAiStatus";
import { useTranslateSearch } from "@/hooks/react-query/useTranslateSearch";

export interface NlSearchButtonProps {
  /** Receives the translated (editable) query string. */
  onQuery: (query: string) => void;
}

/**
 * Sparkle button for the search bar: describe cards in natural language, get an
 * editable Scryfall-style query back (one AI call — no chat). Shows setup
 * guidance instead when the AI endpoint is not configured.
 */
export default function NlSearchButton({ onQuery }: NlSearchButtonProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const { data: status } = useAiStatus();
  const translate = useTranslateSearch();

  const configured = status?.configured === true;

  const handleTranslate = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    translate.mutate(
      { prompt: trimmed },
      {
        onSuccess: ({ query, notes }) => {
          onQuery(query);
          setPopoverOpen(false);
          setPrompt("");
          if (notes) toast.info(notes);
        },
        onError: (error) => toast.error(error.message)
      }
    );
  };

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon-sm" aria-label="AI search">
              <Sparkles />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>AI search</p>
        </TooltipContent>
      </Tooltip>

      <PopoverContent className="w-96 max-w-[90vw]" align="end">
        {configured ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Describe the cards you&apos;re looking for</p>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleTranslate();
                }
              }}
              placeholder="e.g. cheap green creatures that make mana"
              rows={3}
              autoFocus
            />
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-xs">
                The result appears in the search bar — edit it freely.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={handleTranslate}
                disabled={prompt.trim() === "" || translate.isPending}
              >
                {translate.isPending && <Loader2 className="animate-spin" />}
                Translate
              </Button>
            </div>
          </div>
        ) : (
          <AiNotConfigured />
        )}
      </PopoverContent>
    </Popover>
  );
}
