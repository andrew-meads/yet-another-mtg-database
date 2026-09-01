"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUserSettings } from "@/hooks/react-query/useUserSettings";
import { useUpdateAiSettings } from "@/hooks/react-query/useUpdateAiSettings";
import { useTestAiConnection } from "@/hooks/react-query/useTestAiConnection";

/**
 * The "AI Assistant" settings group: OpenAI-compatible base URL, model, and API
 * key. Unlike the live-save preference controls, this section uses an explicit
 * Save button (server round-trip + secret handling). The stored key is never
 * shown — only a hint of its last characters.
 */
export default function AiSettingsSection() {
  const { data } = useUserSettings();
  const updateAi = useUpdateAiSettings();
  const testConnection = useTestAiConnection();

  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  // Initialize the form once from the loaded (masked) settings.
  const initializedRef = useRef(false);
  const ai = data?.settings.ai;
  useEffect(() => {
    if (!data || initializedRef.current) return;
    initializedRef.current = true;
    setBaseUrl(data.settings.ai?.baseUrl ?? "");
    setModel(data.settings.ai?.model ?? "");
  }, [data]);

  const configured = Boolean(ai?.hasApiKey && ai?.model);

  const handleSave = () => {
    updateAi.mutate(
      {
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        // Omit apiKey entirely when the field is empty so the stored key is kept.
        ...(apiKey.trim() !== "" ? { apiKey: apiKey.trim() } : {})
      },
      {
        onSuccess: () => {
          setApiKey("");
          toast.success("AI settings saved");
        },
        onError: (error) => toast.error(error.message)
      }
    );
  };

  const handleRemoveKey = () => {
    updateAi.mutate(
      { apiKey: "" },
      {
        onSuccess: () => toast.success("API key removed"),
        onError: (error) => toast.error(error.message)
      }
    );
  };

  const handleTest = () => {
    testConnection.mutate(undefined, {
      onSuccess: () => toast.success("Connection OK — the endpoint answered."),
      onError: (error) => toast.error(`Connection failed: ${error.message}`)
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Assistant</CardTitle>
        <CardDescription>
          Connect an OpenAI-compatible endpoint (OpenAI, OpenRouter, a local server, …) to enable
          AI features like natural-language card search. Your API key is stored server-side and
          never shown again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="ai-base-url">Base URL</Label>
          <Input
            id="ai-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1 (default when left blank)"
          />
          <p className="text-muted-foreground text-sm">
            Leave blank for OpenAI. Any OpenAI-compatible URL works (e.g.
            https://openrouter.ai/api/v1, http://localhost:11434/v1).
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ai-model">Model</Label>
          <Input
            id="ai-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. gpt-4o-mini"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ai-api-key">API key</Label>
          <Input
            id="ai-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={ai?.hasApiKey ? `Saved (${ai.apiKeyHint ?? "hidden"}) — type to replace` : "sk-…"}
            autoComplete="off"
          />
          {ai?.hasApiKey && (
            <div className="flex items-center gap-2">
              <p className="text-muted-foreground text-sm">
                A key is saved{ai.apiKeyHint ? ` (${ai.apiKeyHint})` : ""}. Leave the field empty
                to keep it.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRemoveKey}
                disabled={updateAi.isPending}
              >
                Remove key
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" onClick={handleSave} disabled={updateAi.isPending}>
            {updateAi.isPending && <Loader2 className="animate-spin" />}
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={!configured || testConnection.isPending}
          >
            {testConnection.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
            Test connection
          </Button>
          <p className="text-muted-foreground ml-auto text-sm" data-testid="ai-configured-status">
            {configured ? "Configured" : "Not configured"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
