import { SquareLibrary, Heart, Layers } from "lucide-react";
import { CollectionType } from "@/types/CardCollection";

export function getCollectionIcon(type: CollectionType, size: string = "h-4 w-4") {
  switch (type) {
    case "collection":
      return <SquareLibrary className={size} />;
    case "wishlist":
      return <Heart className={size} />;
    case "deck":
      return <Layers className={size} />;
  }
}
