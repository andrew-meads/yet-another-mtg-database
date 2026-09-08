"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ArrowDown, ArrowUp } from "lucide-react";
import { usePricingSettings } from "@/context/SettingsContext";
import { SUPPORTED_CURRENCIES, isSupportedCurrency } from "@/lib/pricing";
import {
  PRICE_SOURCES,
  PriceSourcePreference,
  moveSourcePreference,
  normalizeSourcePreferences
} from "@/lib/priceSources";

/** Human names for the currency picker (falls back to the code). */
const CURRENCY_NAMES: Partial<Record<(typeof SUPPORTED_CURRENCIES)[number], string>> = {
  USD: "US Dollar",
  AUD: "Australian Dollar",
  CAD: "Canadian Dollar",
  CHF: "Swiss Franc",
  CNY: "Chinese Yuan",
  EUR: "Euro",
  GBP: "British Pound",
  HKD: "Hong Kong Dollar",
  INR: "Indian Rupee",
  JPY: "Japanese Yen",
  KRW: "South Korean Won",
  MXN: "Mexican Peso",
  NOK: "Norwegian Krone",
  NZD: "New Zealand Dollar",
  PLN: "Polish Złoty",
  SEK: "Swedish Krona",
  SGD: "Singapore Dollar",
  ZAR: "South African Rand"
};

/**
 * Pricing preferences: the currency card prices are displayed in, and the
 * price sources in priority order (a refresh tries them top to bottom until
 * one yields a price; disabled sources are skipped). Live-saving like the
 * card-preview controls.
 */
export default function PricingSettingsSection() {
  const { pricing, setPricing } = usePricingSettings();
  const sources = normalizeSourcePreferences(pricing.sources);

  const updateSources = (next: PriceSourcePreference[]) => setPricing({ sources: next });
  const move = (index: number, direction: -1 | 1) =>
    updateSources(moveSourcePreference(sources, index, direction));
  const toggle = (index: number, enabled: boolean) =>
    updateSources(sources.map((s, i) => (i === index ? { ...s, enabled } : s)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pricing</CardTitle>
        <CardDescription>
          Every price source quotes in US dollars; prices are converted into your chosen currency
          using a daily reference exchange rate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="pricing-currency">Display currency</Label>
            <p className="text-muted-foreground text-sm">
              Used everywhere a price is shown: search results, collections, and the card panel.
            </p>
          </div>
          <Select
            value={pricing.currency}
            onValueChange={(v) => isSupportedCurrency(v) && setPricing({ currency: v })}
          >
            <SelectTrigger id="pricing-currency" aria-label="Display currency" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_CURRENCIES.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                  {CURRENCY_NAMES[code] ? ` — ${CURRENCY_NAMES[code]}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Price sources</Label>
            <p className="text-muted-foreground text-sm">
              When a price is refreshed, sources are tried from the top down until one has a price
              for the card. Reorder them to set the priority; switch off any you don&apos;t want
              used.
            </p>
          </div>
          <ol className="divide-y rounded-md border" data-testid="price-sources">
            {sources.map((pref, index) => {
              const info = PRICE_SOURCES[pref.id];
              return (
                <li
                  key={pref.id}
                  data-testid={`price-source-${pref.id}`}
                  data-enabled={pref.enabled ? "true" : "false"}
                  className="flex items-center gap-3 p-3"
                >
                  <span className="text-muted-foreground w-5 text-center text-sm tabular-nums">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {info.name}{" "}
                      <span className="text-muted-foreground text-xs font-normal">
                        via {info.via}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-sm">{info.description}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${info.name} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${info.name} down`}
                      disabled={index === sources.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Switch
                      aria-label={`Use ${info.name}`}
                      checked={pref.enabled}
                      onCheckedChange={(enabled) => toggle(index, enabled)}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
