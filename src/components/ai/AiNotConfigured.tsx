"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared empty state for every AI entry point when the user has no configured
 * OpenAI-compatible endpoint. Server routes independently return
 * 409 ai_not_configured, so this is guidance, not enforcement.
 */
export default function AiNotConfigured({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2 text-sm", className)}>
      <div className="flex items-center gap-2 font-medium">
        <Sparkles className="size-4" />
        <span>AI features are not set up yet</span>
      </div>
      <p className="text-muted-foreground">
        AI features need an OpenAI-compatible endpoint. Add your API key, model, and (optionally) a
        base URL under{" "}
        <Link href="/settings" className="text-primary underline underline-offset-2">
          Settings → AI Assistant
        </Link>
        .
      </p>
    </div>
  );
}
