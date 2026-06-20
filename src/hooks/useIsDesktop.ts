import { useState, useEffect } from "react";

/**
 * Hook to detect if the viewport is desktop size (≥768px)
 *
 * Uses the `matchMedia` API to check the viewport width against the `md` breakpoint (768px).
 * Automatically updates when the viewport is resized across the breakpoint.
 *
 * @returns Object with `isDesktop` (boolean) and `mounted` (boolean)
 * - `isDesktop`: `true` if viewport width is ≥768px, `false` otherwise
 * - `mounted`: `true` after first client-side render (prevents hydration mismatches)
 *
 * @example
 * ```tsx
 * function ResponsiveComponent() {
 *   const { isDesktop, mounted } = useIsDesktop();
 *
 *   if (!mounted) return <div />; // Prevent hydration mismatch
 *
 *   return isDesktop ? <DesktopView /> : <MobileView />;
 * }
 * ```
 */
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);

    // Set initial value
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mediaQuery.matches);

    // Listen for changes
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mediaQuery.addEventListener("change", handler);

    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return { isDesktop, mounted };
}
