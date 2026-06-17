import { DetailedPhysicalCard } from "./PhysicalCard";

export interface CardLocation {
  collectionId: string;
  collectionName: string;
  cards: Array<DetailedPhysicalCard>;
}
