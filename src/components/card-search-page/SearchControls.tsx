"use client";

import { useEffect, useState } from "react";
import { Field, FieldContent, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import CardSearchBar from "@/components/search/CardSearchBar";

export type SortField =
  | "name"
  | "cmc"
  | "power"
  | "toughness"
  | "rarity"
  | "set"
  | "color"
  | "identity";

export interface SearchControlsValues {
  q: string;
  order: SortField;
  dir: "asc" | "desc";
  pageLen: number;
  owned: boolean;
  useDefaultFilters: boolean;
}

export interface SearchControlsProps {
  initial?: Partial<SearchControlsValues>;
  onChange?: (values: SearchControlsValues) => void;
  className?: string;
  compact?: boolean;
}

const ORDER_FIELDS: { value: SortField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "cmc", label: "Mana Value" },
  { value: "power", label: "Power" },
  { value: "toughness", label: "Toughness" },
  { value: "rarity", label: "Rarity" },
  { value: "set", label: "Set" },
  { value: "color", label: "Colors" },
  { value: "identity", label: "Color Identity" }
];

const PAGE_LENGTHS = [25, 50, 100, 200];

export default function SearchControls({
  initial,
  onChange,
  className,
  compact
}: SearchControlsProps) {
  const [q, setQ] = useState(initial?.q ?? "");
  const [order, setOrder] = useState<SortField>(initial?.order ?? "name");
  const [dir, setDir] = useState<"asc" | "desc">(initial?.dir ?? "asc");
  const [pageLen, setPageLen] = useState<number>(initial?.pageLen ?? 100);
  const [owned, setOwned] = useState<boolean>(initial?.owned ?? false);
  const [useDefaultFilters, setUseDefaultFilters] = useState<boolean>(true);

  // Emit changes (`q` is already debounced by CardSearchBar).
  useEffect(() => {
    onChange?.({ q, useDefaultFilters, order, dir, pageLen, owned });
  }, [q, order, dir, pageLen, owned, onChange, useDefaultFilters]);

  return (
    <div className={cn("w-full", className)}>
      <form>
        <FieldGroup className="flex flex-col gap-3">
          {/* Search field - full width */}
          <Field>
            <FieldLabel htmlFor="search-q">Search</FieldLabel>
            <FieldContent>
              <CardSearchBar
                initialQuery={initial?.q ?? ""}
                onQueryChange={setQ}
                compact={compact}
                showOwned
                owned={owned}
                onOwnedChange={setOwned}
                showDefaultFilters
                useDefaultFilters={useDefaultFilters}
                onDefaultFiltersChange={setUseDefaultFilters}
              />
            </FieldContent>
          </Field>

          {/* Order, Direction, Page length - horizontal on all screens */}
          <div className="grid grid-cols-3 gap-3">
            <Field>
              <FieldLabel>Order</FieldLabel>
              <FieldContent>
                <Select value={order} onValueChange={(v) => setOrder(v as SortField)}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Order" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Order by</SelectLabel>
                      {ORDER_FIELDS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>Direction</FieldLabel>
              <FieldContent>
                <Select value={dir} onValueChange={(v) => setDir(v as "asc" | "desc")}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Direction" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">
                      <ArrowDownAZ className="size-5" />
                      Asc
                    </SelectItem>
                    <SelectItem value="desc">
                      <ArrowUpAZ className="size-5" />
                      Desc
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>Page length</FieldLabel>
              <FieldContent>
                <Select value={String(pageLen)} onValueChange={(v) => setPageLen(parseInt(v, 10))}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Page length" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_LENGTHS.map((len) => (
                      <SelectItem key={len} value={String(len)}>
                        {len}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>
          </div>
        </FieldGroup>
      </form>
    </div>
  );
}
