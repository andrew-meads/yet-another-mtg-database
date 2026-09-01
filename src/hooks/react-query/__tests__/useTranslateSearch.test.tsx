import { describe, it, expect } from "vitest";
import { buildErrorMessage } from "@/hooks/react-query/useTranslateSearch";

describe("buildErrorMessage", () => {
  it("falls back to the status code when the body is empty", () => {
    expect(buildErrorMessage(502, {})).toBe("Request failed with status 502");
  });

  it("appends the rejection detail and raw reply", () => {
    const message = buildErrorMessage(502, {
      error: "The AI returned an unusable response.",
      detail: "AI response did not contain a JSON object",
      finishReason: "stop",
      raw: "Sure! Goblins are great."
    });
    expect(message).toBe(
      "The AI returned an unusable response. AI response did not contain a JSON object. " +
        "Raw reply: “Sure! Goblins are great.”"
    );
  });

  it("calls out an empty reply and a non-stop finish reason", () => {
    const message = buildErrorMessage(502, {
      error: "The AI returned an unusable response.",
      detail: "AI response did not contain a JSON object",
      finishReason: "length",
      raw: ""
    });
    expect(message).toContain("Finish reason: length.");
    expect(message).toContain("The model returned no text.");
  });

  it("truncates a long raw reply", () => {
    const message = buildErrorMessage(502, { error: "Bad.", raw: "x".repeat(300) });
    expect(message).toContain(`${"x".repeat(200)}…`);
    expect(message).not.toContain("x".repeat(201));
  });
});
