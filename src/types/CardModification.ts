/**
 * Card modification operation for updating quantities in a collection
 */
export interface CardModification {
  /** The ID of the card to modify */
  cardId: string;
  /** The operation to perform: add, subtract, or set the quantity */
  operator: "add" | "subtract" | "set";
  /** The amount to add, subtract, or set */
  amount: number;
}
