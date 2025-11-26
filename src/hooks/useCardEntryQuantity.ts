import { useState, useRef, useEffect } from "react";
import { useUpdateCardEntry } from "@/hooks/react-query/useUpdateCardEntry";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

interface UseCardEntryQuantityParams {
  collectionId: string;
  cardIndex: number;
  initialQuantity: number;
}

/**
 * Custom hook for managing card entry quantity with debouncing
 * Handles both immediate updates (e.g., delete) and debounced updates (e.g., slider)
 */
export function useCardEntryQuantity({
  collectionId,
  cardIndex,
  initialQuantity
}: UseCardEntryQuantityParams) {
  const { mutate: updateCardEntry } = useUpdateCardEntry();

  // Local state for quantity (allows immediate UI updates)
  const [localQuantity, setLocalQuantity] = useState(initialQuantity);

  // Track if the change was user-initiated (to distinguish from external updates)
  const isUserChangeRef = useRef(false);

  // Debounce the quantity changes
  const debouncedQuantity = useDebouncedValue(localQuantity, 500);

  // Update local quantity when entry changes (e.g., from external updates)
  useEffect(() => {
    // Mark as external change (not user-initiated)
    isUserChangeRef.current = false;
    setLocalQuantity(initialQuantity);
  }, [initialQuantity]);

  // Handler for immediate quantity updates (e.g., delete button)
  const handleImmediateQuantityChange = (newQuantity: number) => {
    // Validate input (minimum 0, where 0 means remove)
    if (newQuantity < 0) return;

    // Update via API immediately
    updateCardEntry({
      collectionId,
      cardIndex,
      quantity: newQuantity
    });
  };

  // Handle user input changes (debounced)
  const handleUserQuantityChange = (newQuantity: number) => {
    isUserChangeRef.current = true;
    setLocalQuantity(newQuantity);
  };

  // Send API update when debounced quantity changes
  useEffect(() => {
    // Only update if this was a user-initiated change
    if (isUserChangeRef.current && debouncedQuantity !== initialQuantity) {
      handleImmediateQuantityChange(debouncedQuantity);
      isUserChangeRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuantity]);

  return {
    localQuantity,
    handleUserQuantityChange,
    handleImmediateQuantityChange
  };
}
