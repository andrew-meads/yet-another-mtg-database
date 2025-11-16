"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ManaCost } from "@/components/CardTextView";
import { DetailedCardEntry } from "@/types/CardCollection";
import { MtgCard } from "@/types/MtgCard";

/**
 * Color filter mode options
 */
type ColorFilterMode = "contains" | "exactly" | "does-not-contain";

/**
 * Numeric comparison operators
 */
type NumericOperator = "=" | ">" | "<" | ">=" | "<=";

/**
 * Search filters that can be applied
 */
export interface SearchFilters {
  name?: string;
  typeLine?: string;
  power?: string;
  powerOperator?: NumericOperator;
  toughness?: string;
  toughnessOperator?: NumericOperator;
  loyalty?: string;
  loyaltyOperator?: NumericOperator;
  colors?: string[]; // Array of selected color codes: W, U, B, R, G, C
  colorMode?: ColorFilterMode;
  colorIdentity?: string[]; // Array of selected color codes: W, U, B, R, G, C
  colorIdentityMode?: ColorFilterMode;
  set?: string;
  cmc?: string;
  cmcOperator?: NumericOperator;
  oracleText?: string;
}

/**
 * Props for SearchDialog component
 */
export interface SearchDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog close is requested */
  onOpenChange: (open: boolean) => void;
  /** Callback when search is triggered with filters */
  onSearch: (filters: SearchFilters) => void;
  /** Initial filter values */
  initialFilters?: SearchFilters;
}

/**
 * Dialog component for setting advanced search parameters
 *
 * Provides various filters for searching Magic: The Gathering cards including:
 * - Text searches (name, type, oracle text, set)
 * - Numeric searches (power, toughness, loyalty, CMC)
 * - Color searches with mode selection (contains/exactly/does not contain)
 */
export default function SearchDialog({
  open,
  onOpenChange,
  onSearch,
  initialFilters = {}
}: SearchDialogProps) {
  // === STATE MANAGEMENT ===

  const [filters, setFilters] = useState<SearchFilters>(initialFilters);

  // === HANDLERS ===

  /**
   * Update a single filter value
   */
  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  /**
   * Toggle a color in the colors array
   */
  const toggleColor = (color: string) => {
    const current = filters.colors || [];
    const newColors = current.includes(color)
      ? current.filter((c) => c !== color)
      : [...current, color];
    updateFilter("colors", newColors.length > 0 ? newColors : undefined);
  };

  /**
   * Toggle a color in the colorIdentity array
   */
  const toggleColorIdentity = (color: string) => {
    const current = filters.colorIdentity || [];
    const newColors = current.includes(color)
      ? current.filter((c) => c !== color)
      : [...current, color];
    updateFilter("colorIdentity", newColors.length > 0 ? newColors : undefined);
  };

  /**
   * Handle search button click
   */
  const handleSearch = () => {
    // Filter out empty/undefined values
    const activeFilters = Object.entries(filters).reduce((acc, [key, value]) => {
      if (value !== undefined && value !== "") {
        acc[key as keyof SearchFilters] = value;
      }
      return acc;
    }, {} as SearchFilters);

    onSearch(activeFilters);
    onOpenChange(false);
  };

  /**
   * Handle cancel button click
   */
  const handleCancel = () => {
    onOpenChange(false);
  };

  /**
   * Reset all filters
   */
  const handleReset = () => {
    setFilters({});
  };

  // === RENDER ===

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Advanced Search</DialogTitle>
          <DialogDescription>
            Set filters to narrow down your card search. All filters are optional and
            case-insensitive.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="stats">Stats</TabsTrigger>
            <TabsTrigger value="colors">Colors</TabsTrigger>
          </TabsList>

          {/* BASIC FILTERS TAB */}
          <TabsContent value="basic" className="space-y-4 mt-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Card Name</Label>
              <Input
                id="name"
                placeholder="e.g., Lightning Bolt"
                value={filters.name || ""}
                onChange={(e) => updateFilter("name", e.target.value)}
              />
            </div>

            {/* Type Line */}
            <div className="space-y-2">
              <Label htmlFor="typeLine">Type Line</Label>
              <Input
                id="typeLine"
                placeholder="e.g., Creature, Instant, Legendary"
                value={filters.typeLine || ""}
                onChange={(e) => updateFilter("typeLine", e.target.value)}
              />
            </div>

            {/* Set */}
            <div className="space-y-2">
              <Label htmlFor="set">Set Code</Label>
              <Input
                id="set"
                placeholder="e.g., M21, NEO, BRO"
                value={filters.set || ""}
                onChange={(e) => updateFilter("set", e.target.value.toUpperCase())}
              />
            </div>

            {/* Oracle Text */}
            <div className="space-y-2">
              <Label htmlFor="oracleText">Oracle Text</Label>
              <Input
                id="oracleText"
                placeholder="e.g., draw a card, destroy target"
                value={filters.oracleText || ""}
                onChange={(e) => updateFilter("oracleText", e.target.value)}
              />
            </div>
          </TabsContent>

          {/* STATS FILTERS TAB */}
          <TabsContent value="stats" className="space-y-4 mt-4">
            {/* Mana Value / CMC */}
            <div className="space-y-2">
              <Label htmlFor="cmc">Mana Value (CMC)</Label>
              <div className="flex gap-2">
                <Select
                  value={filters.cmcOperator || "="}
                  onValueChange={(value) => updateFilter("cmcOperator", value as NumericOperator)}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="=">=</SelectItem>
                    <SelectItem value=">">&gt;</SelectItem>
                    <SelectItem value="<">&lt;</SelectItem>
                    <SelectItem value=">=">&gt;=</SelectItem>
                    <SelectItem value="<=">&lt;=</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  id="cmc"
                  type="number"
                  min="0"
                  placeholder="e.g., 3"
                  value={filters.cmc || ""}
                  onChange={(e) => updateFilter("cmc", e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>

            {/* Power */}
            <div className="space-y-2">
              <Label htmlFor="power">Power</Label>
              <div className="flex gap-2">
                <Select
                  value={filters.powerOperator || "="}
                  onValueChange={(value) => updateFilter("powerOperator", value as NumericOperator)}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="=">=</SelectItem>
                    <SelectItem value=">">&gt;</SelectItem>
                    <SelectItem value="<">&lt;</SelectItem>
                    <SelectItem value=">=">&gt;=</SelectItem>
                    <SelectItem value="<=">&lt;=</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  id="power"
                  placeholder="e.g., 2, *, X"
                  value={filters.power || ""}
                  onChange={(e) => updateFilter("power", e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>

            {/* Toughness */}
            <div className="space-y-2">
              <Label htmlFor="toughness">Toughness</Label>
              <div className="flex gap-2">
                <Select
                  value={filters.toughnessOperator || "="}
                  onValueChange={(value) =>
                    updateFilter("toughnessOperator", value as NumericOperator)
                  }
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="=">=</SelectItem>
                    <SelectItem value=">">&gt;</SelectItem>
                    <SelectItem value="<">&lt;</SelectItem>
                    <SelectItem value=">=">&gt;=</SelectItem>
                    <SelectItem value="<=">&lt;=</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  id="toughness"
                  placeholder="e.g., 3, *, X"
                  value={filters.toughness || ""}
                  onChange={(e) => updateFilter("toughness", e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>

            {/* Loyalty */}
            <div className="space-y-2">
              <Label htmlFor="loyalty">Loyalty</Label>
              <div className="flex gap-2">
                <Select
                  value={filters.loyaltyOperator || "="}
                  onValueChange={(value) =>
                    updateFilter("loyaltyOperator", value as NumericOperator)
                  }
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="=">=</SelectItem>
                    <SelectItem value=">">&gt;</SelectItem>
                    <SelectItem value="<">&lt;</SelectItem>
                    <SelectItem value=">=">&gt;=</SelectItem>
                    <SelectItem value="<=">&lt;=</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  id="loyalty"
                  placeholder="e.g., 4, X"
                  value={filters.loyalty || ""}
                  onChange={(e) => updateFilter("loyalty", e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>
          </TabsContent>

          {/* COLORS FILTERS TAB */}
          <TabsContent value="colors" className="space-y-6 mt-4">
            {/* Color */}
            <div className="space-y-3">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-3">
                {/* White */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="color-w"
                    checked={filters.colors?.includes("W") || false}
                    onCheckedChange={() => toggleColor("W")}
                  />
                  <Label htmlFor="color-w" className="cursor-pointer flex items-center">
                    <ManaCost cost="{W}" />
                  </Label>
                </div>
                {/* Blue */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="color-u"
                    checked={filters.colors?.includes("U") || false}
                    onCheckedChange={() => toggleColor("U")}
                  />
                  <Label htmlFor="color-u" className="cursor-pointer flex items-center">
                    <ManaCost cost="{U}" />
                  </Label>
                </div>
                {/* Black */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="color-b"
                    checked={filters.colors?.includes("B") || false}
                    onCheckedChange={() => toggleColor("B")}
                  />
                  <Label htmlFor="color-b" className="cursor-pointer flex items-center">
                    <ManaCost cost="{B}" />
                  </Label>
                </div>
                {/* Red */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="color-r"
                    checked={filters.colors?.includes("R") || false}
                    onCheckedChange={() => toggleColor("R")}
                  />
                  <Label htmlFor="color-r" className="cursor-pointer flex items-center">
                    <ManaCost cost="{R}" />
                  </Label>
                </div>
                {/* Green */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="color-g"
                    checked={filters.colors?.includes("G") || false}
                    onCheckedChange={() => toggleColor("G")}
                  />
                  <Label htmlFor="color-g" className="cursor-pointer flex items-center">
                    <ManaCost cost="{G}" />
                  </Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="color-mode">Filter Mode</Label>
                <Select
                  value={filters.colorMode || "contains"}
                  onValueChange={(value) => updateFilter("colorMode", value as ColorFilterMode)}
                >
                  <SelectTrigger id="color-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">Contains these colors</SelectItem>
                    <SelectItem value="exactly">Exactly these colors</SelectItem>
                    <SelectItem value="does-not-contain">Does not contain these colors</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Color Identity */}
            <div className="space-y-3">
              <Label>Color Identity</Label>
              <div className="flex flex-wrap gap-3">
                {/* White */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="identity-w"
                    checked={filters.colorIdentity?.includes("W") || false}
                    onCheckedChange={() => toggleColorIdentity("W")}
                  />
                  <Label htmlFor="identity-w" className="cursor-pointer flex items-center">
                    <ManaCost cost="{W}" />
                  </Label>
                </div>
                {/* Blue */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="identity-u"
                    checked={filters.colorIdentity?.includes("U") || false}
                    onCheckedChange={() => toggleColorIdentity("U")}
                  />
                  <Label htmlFor="identity-u" className="cursor-pointer flex items-center">
                    <ManaCost cost="{U}" />
                  </Label>
                </div>
                {/* Black */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="identity-b"
                    checked={filters.colorIdentity?.includes("B") || false}
                    onCheckedChange={() => toggleColorIdentity("B")}
                  />
                  <Label htmlFor="identity-b" className="cursor-pointer flex items-center">
                    <ManaCost cost="{B}" />
                  </Label>
                </div>
                {/* Red */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="identity-r"
                    checked={filters.colorIdentity?.includes("R") || false}
                    onCheckedChange={() => toggleColorIdentity("R")}
                  />
                  <Label htmlFor="identity-r" className="cursor-pointer flex items-center">
                    <ManaCost cost="{R}" />
                  </Label>
                </div>
                {/* Green */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="identity-g"
                    checked={filters.colorIdentity?.includes("G") || false}
                    onCheckedChange={() => toggleColorIdentity("G")}
                  />
                  <Label htmlFor="identity-g" className="cursor-pointer flex items-center">
                    <ManaCost cost="{G}" />
                  </Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="identity-mode">Filter Mode</Label>
                <Select
                  value={filters.colorIdentityMode || "contains"}
                  onValueChange={(value) =>
                    updateFilter("colorIdentityMode", value as ColorFilterMode)
                  }
                >
                  <SelectTrigger id="identity-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">Contains these colors</SelectItem>
                    <SelectItem value="exactly">Exactly these colors</SelectItem>
                    <SelectItem value="does-not-contain">Does not contain these colors</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button variant="outline" onClick={handleReset}>
            Reset
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleSearch}>Search</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function searchPredicate(filters: SearchFilters | null) {
  if (!filters) {
    // No filters, match all
    return () => true;
  }
  return (item: DetailedCardEntry | MtgCard) => {
    const card = "card" in item ? item.card : item;

    // Helper function to get values from card or card_faces
    const getCardValues = <T,>(
      mainValue: T | undefined,
      faceExtractor: (face: NonNullable<MtgCard["card_faces"]>[0]) => T | undefined
    ): T[] => {
      const values: T[] = [];
      if (mainValue !== undefined) values.push(mainValue);
      if (card.card_faces) {
        card.card_faces.forEach((face) => {
          const faceValue = faceExtractor(face);
          if (faceValue !== undefined) values.push(faceValue);
        });
      }
      return values;
    };

    // Helper function for numeric comparison
    const compareNumeric = (value: string, target: string, operator: NumericOperator): boolean => {
      const numValue = parseFloat(value);
      const numTarget = parseFloat(target);
      if (isNaN(numValue) || isNaN(numTarget)) return false;

      switch (operator) {
        case "=":
          return numValue === numTarget;
        case ">":
          return numValue > numTarget;
        case "<":
          return numValue < numTarget;
        case ">=":
          return numValue >= numTarget;
        case "<=":
          return numValue <= numTarget;
        default:
          return false;
      }
    };

    // Helper function for color filtering
    const matchColors = (
      cardColors: string[] | undefined,
      filterColors: string[] | undefined,
      mode: ColorFilterMode
    ): boolean => {
      if (!filterColors || filterColors.length === 0) return true;
      if (!cardColors) cardColors = [];

      switch (mode) {
        case "contains":
          return filterColors.every((color) => cardColors!.includes(color));
        case "exactly":
          return (
            filterColors.length === cardColors.length &&
            filterColors.every((color) => cardColors!.includes(color))
          );
        case "does-not-contain":
          return !filterColors.some((color) => cardColors!.includes(color));
        default:
          return true;
      }
    };

    // Name filter
    if (filters.name) {
      const names = getCardValues(card.name, (face) => face.name);
      if (card.flavor_name) names.push(card.flavor_name);

      if (!names.some((name) => name.toLowerCase().includes(filters.name!.toLowerCase()))) {
        return false;
      }
    }

    // Type line filter
    if (filters.typeLine) {
      const typeLines = getCardValues(card.type_line, (face) => face.type_line);
      if (
        !typeLines.some((typeLine) =>
          typeLine.toLowerCase().includes(filters.typeLine!.toLowerCase())
        )
      ) {
        return false;
      }
    }

    // Power filter
    if (filters.power) {
      const powers = getCardValues(card.power, (face) => face.power);
      const operator = filters.powerOperator || "=";
      if (!powers.some((power) => compareNumeric(power, filters.power!, operator))) {
        return false;
      }
    }

    // Toughness filter
    if (filters.toughness) {
      const toughnesses = getCardValues(card.toughness, (face) => face.toughness);
      const operator = filters.toughnessOperator || "=";
      if (!toughnesses.some((tough) => compareNumeric(tough, filters.toughness!, operator))) {
        return false;
      }
    }

    // Loyalty filter
    if (filters.loyalty) {
      const loyalties = getCardValues(card.loyalty, (face) => face.loyalty);
      const operator = filters.loyaltyOperator || "=";
      if (!loyalties.some((loyalty) => compareNumeric(loyalty, filters.loyalty!, operator))) {
        return false;
      }
    }

    // Color filter
    if (filters.colors && filters.colors.length > 0) {
      const mode = filters.colorMode || "contains";
      // For cards, use the main colors property. For double-faced cards,
      // if main colors doesn't exist, check if any face matches
      let cardColors = card.colors;
      if (card.card_faces) {
        // For double-faced cards without main colors, collect unique colors from all faces
        const faceColors = new Set<string>(cardColors || []);
        card.card_faces.forEach((face) => {
          if (face.colors) {
            face.colors.forEach((c) => faceColors.add(c));
          }
        });
        cardColors = Array.from(faceColors);
      }

      if (!matchColors(cardColors, filters.colors, mode)) {
        return false;
      }
    }

    // Color identity filter
    if (filters.colorIdentity && filters.colorIdentity.length > 0) {
      const mode = filters.colorIdentityMode || "contains";
      if (!matchColors(card.color_identity, filters.colorIdentity, mode)) {
        return false;
      }
    }

    // Set filter
    if (filters.set) {
      if (!card.set.toLowerCase().includes(filters.set.toLowerCase())) {
        return false;
      }
    }

    // CMC filter
    if (filters.cmc) {
      const operator = filters.cmcOperator || "=";
      if (!compareNumeric(card.cmc.toString(), filters.cmc, operator)) {
        return false;
      }
    }

    // Oracle text filter
    if (filters.oracleText) {
      const oracleTexts = getCardValues(card.oracle_text, (face) => face.oracle_text);
      if (
        !oracleTexts.some((text) => text.toLowerCase().includes(filters.oracleText!.toLowerCase()))
      ) {
        return false;
      }
    }

    return true;
  };
}
