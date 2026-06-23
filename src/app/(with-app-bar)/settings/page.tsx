"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  CARD_PREVIEW_MAX_DELAY,
  CARD_PREVIEW_MIN_DELAY,
  useCardPreviewSettings,
  type CardPreviewSize
} from "@/context/SettingsContext";

const SIZE_OPTIONS: CardPreviewSize[] = ["small", "normal", "large"];
const SIZE_LABELS: Record<CardPreviewSize, string> = {
  small: "Small",
  normal: "Normal",
  large: "Large"
};

export default function SettingsPage() {
  const { cardPreview, setCardPreview } = useCardPreviewSettings();
  const sizeIndex = Math.max(0, SIZE_OPTIONS.indexOf(cardPreview.size));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Preferences are saved to this browser and apply immediately.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Card preview</CardTitle>
          <CardDescription>
            The preview that appears when you hover over a row in search results or a collection.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* Enable / disable */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="card-preview-enabled">Show card preview on hover</Label>
              <p className="text-muted-foreground text-sm">
                Turn the hover preview on or off entirely.
              </p>
            </div>
            <Switch
              id="card-preview-enabled"
              checked={cardPreview.enabled}
              onCheckedChange={(enabled) => setCardPreview({ enabled })}
            />
          </div>

          {/* Size */}
          <div className="space-y-3" data-disabled={!cardPreview.enabled}>
            <div className="flex items-center justify-between">
              <Label>Preview size</Label>
              <span className="text-muted-foreground text-sm">{SIZE_LABELS[cardPreview.size]}</span>
            </div>
            <Slider
              aria-label="Preview size"
              min={0}
              max={SIZE_OPTIONS.length - 1}
              step={1}
              value={[sizeIndex]}
              disabled={!cardPreview.enabled}
              onValueChange={([index]) => setCardPreview({ size: SIZE_OPTIONS[index] })}
            />
            <div className="text-muted-foreground flex justify-between text-xs">
              {SIZE_OPTIONS.map((size) => (
                <span key={size}>{SIZE_LABELS[size]}</span>
              ))}
            </div>
          </div>

          {/* Delay */}
          <div className="space-y-3" data-disabled={!cardPreview.enabled}>
            <div className="flex items-center justify-between">
              <Label>Preview delay</Label>
              <span className="text-muted-foreground text-sm">{cardPreview.delayMs}ms</span>
            </div>
            <Slider
              aria-label="Preview delay"
              min={CARD_PREVIEW_MIN_DELAY}
              max={CARD_PREVIEW_MAX_DELAY}
              step={100}
              value={[cardPreview.delayMs]}
              disabled={!cardPreview.enabled}
              onValueChange={([delayMs]) => setCardPreview({ delayMs })}
            />
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>{CARD_PREVIEW_MIN_DELAY}ms</span>
              <span>{CARD_PREVIEW_MAX_DELAY}ms</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
