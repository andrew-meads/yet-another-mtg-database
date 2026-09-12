/**
 * CameraCapture
 * -------------
 * Lets the user produce a photo of their cards in one of two ways:
 *
 *   1. Live camera — `navigator.mediaDevices.getUserMedia` streams the rear
 *      camera into a <video>; "Capture" paints the current frame onto an
 *      off-screen <canvas> and exports it as a JPEG Blob.
 *   2. File fallback — a native <input type="file" capture="environment"> which,
 *      on phones, opens the camera app directly. This matters because
 *      getUserMedia requires a *secure context* (HTTPS or localhost); on a phone
 *      hitting the dev server over plain http://<lan-ip> live capture is blocked,
 *      but the native file/camera picker still works.
 *
 * Either path ends by handing a Blob to the `onCapture` callback.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** Props for {@link CameraCapture}. */
interface CameraCaptureProps {
  /** Called with the captured image once the user takes/selects a photo. */
  onCapture: (image: Blob) => void
  /** Disables the controls while a scan request is in flight. */
  busy: boolean
}

export function CameraCapture({ onCapture, busy }: CameraCaptureProps) {
  // Live <video> preview element and the MediaStream backing it.
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Whether a live camera stream is currently active.
  const [streaming, setStreaming] = useState(false)
  // Human-readable reason the live camera is unavailable (if any).
  const [cameraError, setCameraError] = useState<string | null>(null)

  /** Stop and release any active camera stream. */
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStreaming(false)
  }, [])

  /** Request the rear camera and attach it to the <video> preview. */
  const startStream = useCallback(async () => {
    setCameraError(null)

    // getUserMedia is only exposed in secure contexts. Detect that up front so
    // we can show a helpful message and steer the user to the file fallback.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'Live camera needs HTTPS or localhost. Use "Take / choose photo" below instead.',
      )
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Prefer the rear camera on phones; harmless on a single-camera laptop.
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setStreaming(true)
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Could not access the camera.')
    }
  }, [])

  // Release the camera when the component unmounts.
  useEffect(() => stopStream, [stopStream])

  /** Capture the current video frame and hand it off as a JPEG Blob. */
  const captureFrame = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    // Size the canvas to the video's intrinsic resolution so we capture full
    // detail (not the smaller on-screen display size).
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // toBlob is async; only forward once we actually have the JPEG bytes.
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob)
      },
      'image/jpeg',
      0.95,
    )
  }, [onCapture])

  /** Handle a photo chosen via the native file-input fallback. */
  const onFileChosen = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) onCapture(file)
      // Reset so selecting the same file again still re-fires onChange.
      event.target.value = ''
    },
    [onCapture],
  )

  return (
    <section className="capture">
      {/* Live preview. Kept mounted (so the ref is always valid) but hidden
          until a stream is running. */}
      <div className="preview" hidden={!streaming}>
        <video ref={videoRef} autoPlay playsInline muted />
      </div>

      {cameraError && <p className="error">{cameraError}</p>}

      <div className="controls">
        {!streaming ? (
          <button type="button" onClick={startStream} disabled={busy}>
            Start camera
          </button>
        ) : (
          <>
            <button type="button" onClick={captureFrame} disabled={busy}>
              Capture
            </button>
            <button type="button" onClick={stopStream} disabled={busy}>
              Stop camera
            </button>
          </>
        )}

        {/* Fallback: always available. On mobile this opens the camera app. */}
        <label className="file-fallback">
          Take / choose photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFileChosen}
            disabled={busy}
            hidden
          />
        </label>
      </div>
    </section>
  )
}
