import { describe, it, expect } from "vitest";
import { deckAdvisorPersona } from "@/lib/ai/agents/deckAdvisor";

describe("deckAdvisorPersona system prompt", () => {
  it("names the viewed deck when one is in context", () => {
    const prompt = deckAdvisorPersona.buildSystemPrompt({ deckId: "abc123" });
    expect(prompt).toContain("deck abc123");
  });

  it("handles an empty context", () => {
    const prompt = deckAdvisorPersona.buildSystemPrompt({});
    expect(prompt).toContain("No deck or collection is in view");
  });

  it("carries the search-syntax cheat sheet and core grounding", () => {
    const prompt = deckAdvisorPersona.buildSystemPrompt({});
    expect(prompt).toContain("## Basics");
    expect(prompt).toContain("manaBaseStats");
  });

  it("instructs the model to answer in Markdown (the panel renders it)", () => {
    const prompt = deckAdvisorPersona.buildSystemPrompt({});
    expect(prompt).toContain("Format answers in Markdown");
  });
});
