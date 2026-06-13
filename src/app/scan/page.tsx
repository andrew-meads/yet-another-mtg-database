"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X, SwitchCamera, AlertCircle, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useScanContext } from "@/context/ScanContext";
import { usePostImageForScan } from "@/hooks/react-query/usePostImageForScan";

// Non-standard camera-focus members not present in the lib DOM types.
type FocusCapabilities = MediaTrackCapabilities & { focusMode?: string[] };
type FocusConstraint = MediaTrackConstraintSet & {
  focusMode?: string;
  pointsOfInterest?: { x: number; y: number }[];
};

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const router = useRouter();
  const { setScanResult } = useScanContext();

  const { mutate: scanImage, isPending } = usePostImageForScan({
    onSuccess: (data) => {
      setScanResult(data);
      router.push("/scan/results");
    },
    onError: (err) => {
      setScanError(err.message || "Failed to scan image");
    }
  });

  // Detect whether the device has more than one camera (enables the switch button).
  useEffect(() => {
    async function checkCameras() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((device) => device.kind === "videoinput");
        setHasMultipleCameras(videoDevices.length > 1);
      } catch (err) {
        console.error("Error enumerating devices:", err);
      }
    }
    checkCameras();
  }, []);

  // Start (and restart on facing-mode change) the camera stream.
  useEffect(() => {
    let mounted = true;
    let localStream: MediaStream | null = null;

    async function startCamera() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        localStream = mediaStream;

        if (mounted && videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          setStream(mediaStream);
        } else {
          mediaStream.getTracks().forEach((track) => track.stop());
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        if (mounted) {
          setError("Unable to access camera. Please ensure camera permissions are granted.");
        }
      }
    }

    startCamera();

    return () => {
      mounted = false;
      if (localStream) localStream.getTracks().forEach((track) => track.stop());
    };
  }, [facingMode]);

  // Capture the full video frame and submit it for scanning.
  const handleCapture = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setScanError("Failed to capture image");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9)
    );
    if (!blob) {
      setScanError("Failed to capture image");
      return;
    }

    setScanError(null);
    scanImage(blob);
  };

  // Submit an existing image file (works even when the camera is unavailable).
  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file fires onChange again
    if (!file) return;
    setScanError(null);
    scanImage(file);
  };

  // Best-effort tap-to-focus. Supported mainly on Android Chrome; elsewhere the
  // focus ring still gives visual feedback.
  const handleVideoTap = async (e: React.MouseEvent<HTMLVideoElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const rect = video.getBoundingClientRect();
    setFocusPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    window.setTimeout(() => setFocusPoint(null), 800);

    const track = stream?.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;

    const capabilities = track.getCapabilities() as FocusCapabilities;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const mode = capabilities.focusMode?.includes("single-shot")
      ? "single-shot"
      : capabilities.focusMode?.includes("continuous")
        ? "continuous"
        : null;
    if (!mode) return;

    try {
      const constraint: FocusConstraint = { focusMode: mode, pointsOfInterest: [{ x, y }] };
      await track.applyConstraints({ advanced: [constraint] });
    } catch (err) {
      console.debug("Tap-to-focus not supported:", err);
    }
  };

  const handleSwitchCamera = () => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  };

  const handleClose = () => {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    router.back();
  };

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-black/50 backdrop-blur-sm z-10">
        <h1 className="text-white text-lg font-semibold">Scan Cards</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          className="text-white hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Camera Feed */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {error ? (
          <div className="text-white text-center p-6 max-w-md">
            <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
            <p className="mb-2">{error}</p>
            <p className="text-white/70 text-sm">
              You can still upload a photo using the button below.
            </p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onClick={handleVideoTap}
              className="w-full h-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Framing hint */}
            <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
              <p className="text-white/80 text-sm bg-black/40 rounded-full px-3 py-1">
                Place cards on a contrasting surface
              </p>
            </div>

            {/* Tap-to-focus ring */}
            {focusPoint && (
              <div
                className="absolute w-16 h-16 border-2 border-white rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2 animate-ping"
                style={{ left: focusPoint.x, top: focusPoint.y }}
              />
            )}
          </>
        )}

        {/* Scanning status overlay */}
        {isPending && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 flex flex-col items-center gap-3">
              <div className="h-8 w-8 border-3 border-white border-t-transparent rounded-full animate-spin" />
              <p className="text-white text-sm font-medium">Scanning…</p>
            </div>
          </div>
        )}

        {/* Scan error overlay */}
        {scanError && !isPending && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 max-w-md w-full">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-6 w-6 text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-white font-semibold mb-2">Scan Failed</h3>
                  <p className="text-white/90 text-sm mb-4">{scanError}</p>
                  <Button
                    onClick={() => setScanError(null)}
                    variant="secondary"
                    size="sm"
                    className="w-full"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="p-6 bg-black/50 backdrop-blur-sm z-10 flex justify-center items-center gap-4">
        {!error && (
          <Button
            size="icon"
            variant="ghost"
            onClick={handleSwitchCamera}
            disabled={!hasMultipleCameras || isPending}
            className="rounded-full w-12 h-12 text-white hover:bg-white/20 disabled:opacity-30"
            title="Switch camera"
          >
            <SwitchCamera className="h-5 w-5" />
          </Button>
        )}

        {!error && (
          <Button
            size="lg"
            onClick={handleCapture}
            disabled={!stream || isPending}
            className="rounded-full w-16 h-16 p-0"
            title="Capture photo"
          >
            {isPending ? (
              <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Camera className="h-6 w-6" />
            )}
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          onClick={handleUploadClick}
          disabled={isPending}
          className="rounded-full w-12 h-12 text-white hover:bg-white/20 disabled:opacity-30"
          title="Upload photo"
        >
          <Upload className="h-5 w-5" />
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  );
}
