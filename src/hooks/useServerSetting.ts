"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUserSettings } from "@/hooks/react-query/useUserSettings";
import {
  UpdateUserSettingsRequest,
  useUpdateUserSettings
} from "@/hooks/react-query/useUpdateUserSettings";
import { UserSettingsPayload } from "@/types/UserSettings";

type ServerSettingSection = keyof UpdateUserSettingsRequest;

export interface ServerSettingOptions<T> {
  /**
   * A legacy localStorage key to migrate from. When the server has no value for
   * the section yet but this key holds one, it is adopted, persisted to the
   * server, and the key is removed (only after the write succeeds).
   */
  legacyStorageKey?: string;
  /**
   * How to combine the server value with local edits made before hydration
   * completed (e.g. an entity opened while the settings request was in flight).
   * Defaults to local-wins.
   */
  reconcile?: (server: T, local: T) => T;
}

/** Delay before local edits are written back to the server. */
const PERSIST_DEBOUNCE_MS = 600;

function readLegacyValue<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch (error) {
    console.warn(`Error reading localStorage key "${key}":`, error);
    return undefined;
  }
}

/**
 * Like useState, but persisted to one section of the user's server-side
 * settings document (PATCH /api/settings, debounced).
 *
 * Lifecycle: starts at `initialValue`; when the `["user-settings"]` query
 * resolves, the hook hydrates once — adopting the server value, or migrating a
 * legacy localStorage value when the server has none. Local edits apply
 * immediately and are debounced to the server; edits made before hydration are
 * reconciled with the server value rather than clobbering it. When
 * unauthenticated, the hook behaves like plain useState (no persistence).
 */
export function useServerSetting<T>(
  section: ServerSettingSection,
  initialValue: T,
  options?: ServerSettingOptions<T>
): [T, (value: T | ((prev: T) => T)) => void, { hydrated: boolean }] {
  const { data, isSuccess } = useUserSettings();
  const { mutate } = useUpdateUserSettings();

  const [local, setLocal] = useState<T | null>(null);
  const localRef = useRef<T | null>(null);
  const touchedRef = useRef(false);
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Options and the initial value are captured on first render — they are
  // conceptually constant per call site (a storage key and a merge strategy),
  // and pinning them keeps `setValue` stable even when callers pass fresh
  // object/array literals each render.
  const optionsRef = useRef(options);
  const initialValueRef = useRef(initialValue);

  const applyLocal = useCallback((value: T) => {
    localRef.current = value;
    setLocal(value);
  }, []);

  const persist = useCallback(
    (value: T, onSuccess?: () => void) => {
      mutate({ [section]: value } as UpdateUserSettingsRequest, onSuccess ? { onSuccess } : {});
    },
    [mutate, section]
  );

  const schedulePersist = useCallback(
    (value: T) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => persist(value), PERSIST_DEBOUNCE_MS);
    },
    [persist]
  );

  // Clear any pending write on unmount (the value is lost, same as an unflushed
  // localStorage write would have been under sync persistence — acceptable for
  // preferences).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // One-time hydration when the settings query first resolves.
  useEffect(() => {
    if (!isSuccess || hydratedRef.current) return;
    hydratedRef.current = true;

    const server = (data.settings as UserSettingsPayload)[section] as T | undefined;
    const localValue = localRef.current;
    const opts = optionsRef.current;

    if (server !== undefined) {
      if (touchedRef.current && localValue !== null) {
        const merged = opts?.reconcile ? opts.reconcile(server, localValue) : localValue;
        applyLocal(merged);
        if (JSON.stringify(merged) !== JSON.stringify(server)) persist(merged);
      } else {
        applyLocal(server);
      }
      // The server value is authoritative now; drop any stale legacy copy.
      if (opts?.legacyStorageKey && typeof window !== "undefined") {
        window.localStorage.removeItem(opts.legacyStorageKey);
      }
    } else {
      const legacy = opts?.legacyStorageKey ? readLegacyValue<T>(opts.legacyStorageKey) : undefined;
      const removeLegacy = () => {
        if (opts?.legacyStorageKey && typeof window !== "undefined") {
          window.localStorage.removeItem(opts.legacyStorageKey);
        }
      };

      if (touchedRef.current && localValue !== null) {
        // The user changed the value before the first load finished — their
        // edits win over anything the legacy key holds.
        persist(localValue, removeLegacy);
      } else if (legacy !== undefined) {
        applyLocal(legacy);
        persist(legacy, removeLegacy);
      }
    }

    setHydrated(true);
  }, [isSuccess, data, section, applyLocal, persist]);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      const next =
        value instanceof Function ? value(localRef.current ?? initialValueRef.current) : value;
      touchedRef.current = true;
      applyLocal(next);
      if (hydratedRef.current) schedulePersist(next);
    },
    [applyLocal, schedulePersist]
  );

  return [local ?? initialValue, setValue, { hydrated }];
}
