"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X, SwitchCamera, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useScanContext } from "@/context/ScanContext";
import { usePostImageForRecognition } from "@/hooks/react-query/usePostImageForRecognition";

const DEBUG_MODE = false;

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const router = useRouter();
  const { setScannedImage, setRecognized, setCards } = useScanContext();
  const { mutate: recognizeImage, isPending: isRecognizing } = usePostImageForRecognition({
    onSuccess: (data) => {
      console.log("✅ Recognition successful:", data);
      setRecognized(data.recognized);
      setCards(data.cards);
      router.push("/scan/results");
    },
    onError: (error) => {
      console.error("❌ Recognition failed:", error);
      setRecognitionError(error.message || "Failed to recognize card");
      setIsProcessing(false);
    }
  });

  // Check if device has multiple cameras
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

  useEffect(() => {
    let mounted = true;

    async function startCamera() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        });

        if (mounted && videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          setStream(mediaStream);
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
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [facingMode]);

  // Cleanup stream when component unmounts
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsProcessing(true);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      // Get video dimensions (actual stream resolution)
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;

      // Get video element dimensions (displayed size on screen)
      const displayWidth = video.clientWidth;
      const displayHeight = video.clientHeight;

      // Calculate video aspect ratio and display aspect ratio
      const videoAspect = videoWidth / videoHeight;
      const displayAspect = displayWidth / displayHeight;

      // Calculate the visible portion of the video (accounting for object-cover)
      let visibleVideoWidth, visibleVideoHeight, offsetX, offsetY;

      if (videoAspect > displayAspect) {
        // Video is wider - height fills display, width is cropped
        visibleVideoHeight = videoHeight;
        visibleVideoWidth = videoHeight * displayAspect;
        offsetX = (videoWidth - visibleVideoWidth) / 2;
        offsetY = 0;
      } else {
        // Video is taller - width fills display, height is cropped
        visibleVideoWidth = videoWidth;
        visibleVideoHeight = videoWidth / displayAspect;
        offsetX = 0;
        offsetY = (videoHeight - visibleVideoHeight) / 2;
      }

      // Calculate scaling factor (visible video to display)
      const scale = visibleVideoWidth / displayWidth;

      // Calculate guide dimensions on the display (in CSS pixels)
      // Guide is 80% width (w-4/5) with max-w-md (448px) and aspect ratio 2.5:3.5
      const displayGuideWidth = Math.min(displayWidth * 0.8, 448);
      const displayGuideHeight = displayGuideWidth * (3.5 / 2.5);

      // Convert guide dimensions to video stream coordinates
      const guideWidth = displayGuideWidth * scale;
      const guideHeight = displayGuideHeight * scale;

      // Calculate guide position (centered) in visible video coordinates, then add offset
      const guideX = offsetX + (visibleVideoWidth - guideWidth) / 2;
      const guideY = offsetY + (visibleVideoHeight - guideHeight) / 2;

      // Set canvas to cropped dimensions
      canvas.width = guideWidth;
      canvas.height = guideHeight;

      // Draw cropped video frame to canvas
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        console.error("Failed to get canvas context");
        return;
      }

      ctx.drawImage(
        video,
        guideX,
        guideY,
        guideWidth,
        guideHeight, // Source rectangle (crop area)
        0,
        0,
        guideWidth,
        guideHeight // Destination rectangle (canvas)
      );

      // Save the cropped image to display (debug only)
      if (DEBUG_MODE) {
        const dataUrl = canvas.toDataURL("image/png");
        setCapturedImage(dataUrl);
        console.log("Cropped image captured and displayed");
      }

      // Convert canvas to blob and save it.
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => resolve(blob!), "image/png");
      });
      setScannedImage(blob);

      // Send image for recognition
      recognizeImage(blob);
    } catch (err) {
      console.error("Error during capture:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSwitchCamera = () => {
    // Stop current stream
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    // Toggle facing mode
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  };

  const handleClose = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    router.back();
  };

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-black/50 backdrop-blur-sm z-10">
        <h1 className="text-white text-lg font-semibold">Scan Card</h1>
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
          <div className="text-white text-center p-4">
            <p className="mb-4">{error}</p>
            <Button variant="secondary" onClick={handleClose}>
              Go Back
            </Button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {/* Hidden canvas for image capture */}
            <canvas ref={canvasRef} className="hidden" />
            {/* Overlay guide for card placement */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="border-2 border-white/50 rounded-lg w-4/5 max-w-md aspect-[2.5/3.5] shadow-lg" />
            </div>
            {/* Display captured image for debugging */}
            {DEBUG_MODE && capturedImage && (
              <div className="absolute top-4 right-4 border-2 border-white bg-black p-2 rounded max-w-xs pointer-events-none">
                <img src={capturedImage} alt="Captured crop" className="w-full" />
                <p className="text-white text-xs mt-1 text-center">Captured Image</p>
              </div>
            )}
            {/* Recognition status overlay */}
            {isRecognizing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 flex flex-col items-center gap-3">
                  <div className="h-8 w-8 border-3 border-white border-t-transparent rounded-full animate-spin" />
                  <p className="text-white text-sm font-medium">Recognizing card...</p>
                </div>
              </div>
            )}
            {/* Recognition error overlay */}
            {recognitionError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 max-w-md w-full">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-6 w-6 text-red-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h3 className="text-white font-semibold mb-2">Recognition Failed</h3>
                      <p className="text-white/90 text-sm mb-4">{recognitionError}</p>
                      <Button
                        onClick={() => setRecognitionError(null)}
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
          </>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="p-6 bg-black/50 backdrop-blur-sm z-10 flex justify-center items-center gap-4">
        <Button
          size="icon"
          variant="ghost"
          onClick={handleSwitchCamera}
          disabled={!!error || !hasMultipleCameras || isProcessing || isRecognizing}
          className="rounded-full w-12 h-12 text-white hover:bg-white/20 disabled:opacity-30"
        >
          <SwitchCamera className="h-5 w-5" />
        </Button>
        <Button
          size="lg"
          onClick={handleCapture}
          disabled={!!error || isProcessing || isRecognizing}
          className="rounded-full w-16 h-16 p-0"
        >
          {isProcessing ? (
            <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Camera className="h-6 w-6" />
          )}
        </Button>
      </div>
    </div>
  );
}
