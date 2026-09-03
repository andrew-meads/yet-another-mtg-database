"use client";

import { useMutation } from "@tanstack/react-query";
import { DeckExportOptions, deckExportFileName, deckExportSearchParams } from "@/lib/deckExport";

export interface ExportDeckRequest {
  deckId: string;
  deckName: string;
  options: DeckExportOptions;
}

export interface ExportDeckResult {
  fileName: string;
  /** Size of the downloaded file in bytes. */
  size: number;
}

/** Pull the file name out of a Content-Disposition header (UTF-8 form preferred). */
export function fileNameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1];
}

/** Hand a blob to the browser as a download (object URL + synthetic anchor click). */
export function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The browser's IANA time zone, so the server stamps the export in local time. */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

async function exportDeck({
  deckId,
  deckName,
  options
}: ExportDeckRequest): Promise<ExportDeckResult> {
  const params = deckExportSearchParams({
    ...options,
    timeZone: options.timeZone ?? browserTimeZone()
  });
  const res = await fetch(`/api/decks/${deckId}/export?${params.toString()}`, {
    cache: "no-store"
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to export deck" }));
    throw new Error(error.error || "Failed to export deck");
  }
  const blob = await res.blob();
  const fileName =
    fileNameFromDisposition(res.headers.get("content-disposition")) ??
    deckExportFileName(deckName, options.format);
  triggerBrowserDownload(blob, fileName);
  return { fileName, size: blob.size };
}

/**
 * Export a deck as TXT/XLSX/PDF: fetches the rendered file from
 * GET /api/decks/[id]/export (with the session cookie, so errors surface as
 * normal rejections) and triggers a browser download. Reads nothing that
 * needs invalidating.
 */
export function useExportDeck() {
  return useMutation({ mutationFn: exportDeck });
}
