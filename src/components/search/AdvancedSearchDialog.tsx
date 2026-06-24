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
import {
  ColorFilterMode,
  NumericOperator,
  SearchFilters,
  filtersToQueryString
} from "@/lib/search/filtersToQueryString";

export type { SearchFilters } from "@/lib/search/filtersToQueryString";

export interface AdvancedSearchDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog close is requested */
  onOpenChange: (open: boolean) => void;
  /** Callback when the user applies the built query string */
  onApply: (query: string) => void;
  /** Initial field values */
  initialFilters?: SearchFilters;
}

const COLORS: { code: string; symbol: string }[] = [
  { code: "W", symbol: "{W}" },
  { code: "U", symbol: "{U}" },
  { code: "B", symbol: "{B}" },
  { code: "R", symbol: "{R}" },
  { code: "G", symbol: "{G}" }
];

const NUMERIC_OPERATORS: NumericOperator[] = ["=", ">", "<", ">=", "<="];

const RARITIES = ["common", "uncommon", "rare", "mythic"];

/**
 * Advanced ("helper") search dialog. The user fills in fields covering every
 * Scryfall operator and, on Apply, we generate the equivalent query string via
 * {@link filtersToQueryString} and emit it. There is no reverse parsing — this
 * is a one-way builder for the shared text query bar.
 */
export default function AdvancedSearchDialog({
  open,
  onOpenChange,
  onApply,
  initialFilters = {}
}: AdvancedSearchDialogProps) {
  const [filters, setFilters] = useState<SearchFilters>(initialFilters);

  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleColor = (key: "colors" | "colorIdentity", color: string) => {
    const current = filters[key] || [];
    const next = current.includes(color)
      ? current.filter((c) => c !== color)
      : [...current, color];
    updateFilter(key, next.length > 0 ? next : undefined);
  };

  const handleApply = () => {
    onApply(filtersToQueryString(filters));
    onOpenChange(false);
  };

  const handleReset = () => setFilters({});

  const numericField = (
    id: string,
    label: string,
    valueKey: "cmc" | "power" | "toughness" | "loyalty",
    opKey: "cmcOperator" | "powerOperator" | "toughnessOperator" | "loyaltyOperator",
    placeholder: string
  ) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Select
          value={filters[opKey] || "="}
          onValueChange={(v) => updateFilter(opKey, v as NumericOperator)}
        >
          <SelectTrigger className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NUMERIC_OPERATORS.map((op) => (
              <SelectItem key={op} value={op}>
                {op}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          id={id}
          placeholder={placeholder}
          value={filters[valueKey] || ""}
          onChange={(e) => updateFilter(valueKey, e.target.value)}
          className="flex-1"
        />
      </div>
    </div>
  );

  const colorSection = (
    label: string,
    key: "colors" | "colorIdentity",
    modeKey: "colorMode" | "colorIdentityMode",
    idPrefix: string
  ) => (
    <div className="space-y-3">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-3">
        {COLORS.map(({ code, symbol }) => (
          <div key={code} className="flex items-center space-x-2">
            <Checkbox
              id={`${idPrefix}-${code}`}
              checked={filters[key]?.includes(code) || false}
              onCheckedChange={() => toggleColor(key, code)}
            />
            <Label htmlFor={`${idPrefix}-${code}`} className="flex cursor-pointer items-center">
              <ManaCost cost={symbol} />
            </Label>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-mode`}>Filter Mode</Label>
        <Select
          value={filters[modeKey] || "contains"}
          onValueChange={(v) => updateFilter(modeKey, v as ColorFilterMode)}
        >
          <SelectTrigger id={`${idPrefix}-mode`}>
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
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Advanced Search</DialogTitle>
          <DialogDescription>
            Fill in any fields to build a search query. All fields are optional and
            case-insensitive.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="stats">Stats</TabsTrigger>
            <TabsTrigger value="colors">Colors</TabsTrigger>
            <TabsTrigger value="more">More</TabsTrigger>
          </TabsList>

          {/* BASIC */}
          <TabsContent value="basic" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Card Name</Label>
              <Input
                id="name"
                placeholder="e.g., Lightning Bolt"
                value={filters.name || ""}
                onChange={(e) => updateFilter("name", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="flavorName">Flavor Name</Label>
              <Input
                id="flavorName"
                placeholder="e.g., Godzilla"
                value={filters.flavorName || ""}
                onChange={(e) => updateFilter("flavorName", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="typeLine">Type Line</Label>
              <Input
                id="typeLine"
                placeholder="e.g., Creature, Instant, Legendary"
                value={filters.typeLine || ""}
                onChange={(e) => updateFilter("typeLine", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="oracleText">Oracle Text</Label>
              <Input
                id="oracleText"
                placeholder="e.g., draw a card, destroy target"
                value={filters.oracleText || ""}
                onChange={(e) => updateFilter("oracleText", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="set">Set Code</Label>
                <Input
                  id="set"
                  placeholder="e.g., M21, NEO"
                  value={filters.set || ""}
                  onChange={(e) => updateFilter("set", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lang">Language</Label>
                <Input
                  id="lang"
                  placeholder="e.g., en, ja"
                  value={filters.lang || ""}
                  onChange={(e) => updateFilter("lang", e.target.value)}
                />
              </div>
            </div>
          </TabsContent>

          {/* STATS */}
          <TabsContent value="stats" className="mt-4 space-y-4">
            {numericField("cmc", "Mana Value (CMC)", "cmc", "cmcOperator", "e.g., 3")}
            {numericField("power", "Power", "power", "powerOperator", "e.g., 2, *, X")}
            {numericField("toughness", "Toughness", "toughness", "toughnessOperator", "e.g., 3")}
            {numericField("loyalty", "Loyalty", "loyalty", "loyaltyOperator", "e.g., 4")}

            <div className="space-y-2">
              <Label htmlFor="rarity">Rarity</Label>
              <div className="flex gap-2">
                <Select
                  value={filters.rarityOperator || "="}
                  onValueChange={(v) => updateFilter("rarityOperator", v as NumericOperator)}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NUMERIC_OPERATORS.map((op) => (
                      <SelectItem key={op} value={op}>
                        {op}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filters.rarity || ""}
                  onValueChange={(v) => updateFilter("rarity", v)}
                >
                  <SelectTrigger id="rarity" className="flex-1">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    {RARITIES.map((r) => (
                      <SelectItem key={r} value={r} className="capitalize">
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          {/* COLORS */}
          <TabsContent value="colors" className="mt-4 space-y-6">
            {colorSection("Color", "colors", "colorMode", "color")}
            {colorSection("Color Identity", "colorIdentity", "colorIdentityMode", "identity")}
          </TabsContent>

          {/* MORE */}
          <TabsContent value="more" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="keyword">Keyword</Label>
              <Input
                id="keyword"
                placeholder="e.g., flying, haste"
                value={filters.keyword || ""}
                onChange={(e) => updateFilter("keyword", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="layout">Layout</Label>
              <Input
                id="layout"
                placeholder="e.g., transform, normal"
                value={filters.layout || ""}
                onChange={(e) => updateFilter("layout", e.target.value)}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="excludeExtras"
                checked={filters.excludeExtras || false}
                onCheckedChange={(checked) => updateFilter("excludeExtras", checked === true)}
              />
              <Label htmlFor="excludeExtras" className="cursor-pointer">
                Exclude extras (tokens, emblems, etc.)
              </Label>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button variant="outline" onClick={handleReset}>
            Reset
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleApply}>Apply</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
