import { useEffect, useRef } from "react";

/**
 * Tracks whether the Alt key is currently held, exposed as a ref (not state) so it can be
 * read synchronously inside a react-dnd `item` callback at drag start without forcing a
 * re-render of the drag source on every keypress. Resets on window blur so a key held while
 * focus leaves the page doesn't get stuck "down".
 */
export function useAltKeyRef(): React.RefObject<boolean> {
  const altRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") altRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") altRef.current = false;
    };
    const onBlur = () => {
      altRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return altRef;
}
