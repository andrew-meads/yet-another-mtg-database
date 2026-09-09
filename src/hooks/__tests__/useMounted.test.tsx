import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useMounted } from "@/hooks/useMounted";

function Probe() {
  return <span>{useMounted() ? "mounted" : "hydrating"}</span>;
}

describe("useMounted", () => {
  it("is false when rendered on the server", () => {
    expect(renderToString(<Probe />)).toContain("hydrating");
  });

  it("is true once rendered on the client", () => {
    const { result } = renderHook(() => useMounted());
    expect(result.current).toBe(true);
  });
});
