import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `false` during server rendering and the hydration render, `true` from the
 * first client render after that. Gate UI whose first frame depends on
 * browser-only state (localStorage, `matchMedia`) so the server HTML and the
 * hydrating client render agree — a mismatch makes React throw the whole tree
 * away and re-render it. Implemented with `useSyncExternalStore` so React
 * itself picks the server snapshot while hydrating; no effect, no state.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
