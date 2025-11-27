"use client";

import { useEffect, useState } from "react";
import { Field, FieldContent, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { Switch } from "@/components/ui/switch";

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

  const debouncedQ = useDebouncedValue(q, 350);

  // Emit changes
  useEffect(() => {
    onChange?.({ q: debouncedQ, order, dir, pageLen, owned });
  }, [debouncedQ, order, dir, pageLen, owned, onChange]);

  return (
    <div className={cn("w-full", className)}>
      <form>
        <FieldGroup
          className={cn(
            "grid",
            compact ? "grid-cols-[1fr_auto_auto_auto]" : "grid-cols-1 md:grid-cols-3",
            "gap-3"
          )}
        >
          <Field className={!compact ? "col-span-full" : undefined}>
            <FieldLabel htmlFor="search-q">Search</FieldLabel>
            <FieldContent>
              <div className="flex items-center gap-2">
                <Input
                  id="search-q"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={compact ? "Search..." : "Try: t:creature c:gr (flying or trample)"}
                  className={compact ? "h-8" : undefined}
                />
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <Switch
                    id="search-owned"
                    checked={owned}
                    onCheckedChange={setOwned}
                    className="data-[state=checked]:bg-primary"
                  />
                  <label
                    htmlFor="search-owned"
                    className="text-sm font-medium cursor-pointer select-none"
                  >
                    Owned
                  </label>
                </div>
              </div>
            </FieldContent>
          </Field>

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
        </FieldGroup>
      </form>
    </div>
  );
}
