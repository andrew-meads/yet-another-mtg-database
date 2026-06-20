import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./tests/msw/server";

// ---------------------------------------------------------------------------
// next/navigation — stable router mock shared across all jsdom tests.
// Use vi.hoisted so the object exists when the (hoisted) vi.mock factory runs.
// ---------------------------------------------------------------------------
const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn()
}));

// next/image — render a plain <img> so jsdom can handle it.
vi.mock("next/image", () => ({
  __esModule: true,
  default: ({
    src,
    alt,
    fill: _fill,
    priority: _priority,
    quality: _quality,
    loader: _loader,
    sizes: _sizes,
    ...rest
  }: any) =>
    React.createElement("img", { src: typeof src === "string" ? src : "", alt: alt ?? "", ...rest })
}));

// ---------------------------------------------------------------------------
// Browser APIs missing from jsdom.
// ---------------------------------------------------------------------------
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  })
});

class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver = MockObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver = MockObserver as unknown as typeof IntersectionObserver;
window.scrollTo = vi.fn();
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// ---------------------------------------------------------------------------
// MSW lifecycle.
// ---------------------------------------------------------------------------
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
