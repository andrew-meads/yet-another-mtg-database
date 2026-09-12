/**
 * App
 * ---
 * Top-level component wiring the capture UI to the scan API and the results
 * view. Holds the small amount of page state: the in-flight flag, the latest
 * scan result, and any error message.
 */
import { useState } from 'react'
import { CameraCapture } from './components/CameraCapture'
import { CardResults } from './components/CardResults'
import { scanImage } from './api'
import type { ScanResponse } from './types'

export function App() {
  // True while a scan request is in flight (disables capture controls).
  const [busy, setBusy] = useState(false)
  // The most recent scan response, or null before the first scan.
  const [result, setResult] = useState<ScanResponse | null>(null)
  // The most recent error message, if any.
  const [error, setError] = useState<string | null>(null)

  /** Send a captured image to the backend and store the response. */
  async function handleCapture(image: Blob) {
    setBusy(true)
    setError(null)
    try {
      const response = await scanImage(image)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="app">
      <header>
        <h1>MTG Card Scanner</h1>
        <p>Photograph cards on a contrasting surface to detect &amp; de-skew them.</p>
      </header>

      <CameraCapture onCapture={handleCapture} busy={busy} />

      {busy && <p className="status">Scanning…</p>}
      {error && <p className="error">{error}</p>}

      <CardResults result={result} />
    </main>
  )
}
