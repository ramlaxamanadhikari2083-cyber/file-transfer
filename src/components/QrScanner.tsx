import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, Upload, AlertCircle, X, Check, RefreshCw } from "lucide-react";

interface QrScannerProps {
  onScanSuccess: (data: string) => void;
  onClose: () => void;
}

export default function QrScanner({ onScanSuccess, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState<boolean>(true);
  
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const scanningActiveRef = useRef<boolean>(true);

  // Keep scanningActiveRef in sync with scanning state
  useEffect(() => {
    scanningActiveRef.current = scanning;
  }, [scanning]);

  // Start Camera
  const startCamera = async () => {
    try {
      setError(null);
      setHasPermission(null);
      setScanning(true);

      // Clean up previous stream if any
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
      });

      streamRef.current = stream;
      setHasPermission(true);

      // We wait for a tiny frame cycle or verify videoRef is ready
      setTimeout(() => {
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute("playsinline", "true"); // required for iOS Safari
          video.play()
            .then(() => {
              console.log("Camera playing successfully.");
              // Start processing frames
              if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
              }
              animationFrameRef.current = requestAnimationFrame(tick);
            })
            .catch((e) => {
              console.error("Video play failed:", e);
              setError("क्यामेरा भिडियो प्ले गर्न सकिएन। कृपया पुनः प्रयास गर्नुहोस्।");
            });
        } else {
          console.warn("Video element ref not found even after delay");
          // Fallback check
          setError("क्यामेरा लोड हुन सकेन। कृपया फेरि स्क्यान बटन थिच्नुहोस्।");
        }
      }, 100);

    } catch (err: any) {
      console.error("Camera access error:", err);
      setHasPermission(false);
      setError(
        "क्यामेरा पहुँच गर्न सकिएन। कृपया क्यामेरा अनुमति दिनुहोस् वा अन्य माध्यम (PIN वा QR फाइल) प्रयोग गर्नुहोस्।"
      );
    }
  };

  // Process frames with throttling to keep the UI butter-smooth (no frame lag)
  const tick = () => {
    if (!scanningActiveRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const now = Date.now();
      // Throttle scanning to once every 120ms to conserve CPU and keep the camera preview butter-smooth
      if (now - lastScanTimeRef.current >= 120) {
        lastScanTimeRef.current = now;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          // Downscale the processing resolution if original feed is too large (optimization)
          const processingWidth = Math.min(video.videoWidth, 640);
          const processingHeight = Math.min(video.videoHeight, 480);
          
          canvas.width = processingWidth;
          canvas.height = processingHeight;
          ctx.drawImage(video, 0, 0, processingWidth, processingHeight);

          try {
            const imageData = ctx.getImageData(0, 0, processingWidth, processingHeight);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: "dontInvert",
            });

            if (code && code.data) {
              // Found QR Code! Disable scanning immediately
              scanningActiveRef.current = false;
              setScanning(false);
              
              if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
                streamRef.current = null;
              }
              
              onScanSuccess(code.data);
              return;
            }
          } catch (e) {
            console.error("Error reading image data from canvas", e);
          }
        }
      }
    }

    if (scanningActiveRef.current) {
      animationFrameRef.current = requestAnimationFrame(tick);
    }
  };

  // Handle uploaded QR code file
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (ctx) {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0, img.width, img.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);

          if (code && code.data) {
            scanningActiveRef.current = false;
            setScanning(false);
            if (streamRef.current) {
              streamRef.current.getTracks().forEach((track) => track.stop());
              streamRef.current = null;
            }
            onScanSuccess(code.data);
          } else {
            setError("यस तस्विरमा कुनै मान्य क्युआर (QR) कोड फेला परेन। कृपया स्पष्ट तस्विर अपलोड गर्नुहोस्।");
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    startCamera();

    return () => {
      scanningActiveRef.current = false;
      // Clean up stream tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white max-w-md w-full mx-auto relative overflow-hidden shadow-2xl">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors z-10"
        id="btn-close-scanner"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="flex items-center gap-3 mb-4">
        <Camera className="w-6 h-6 text-emerald-400 animate-pulse" />
        <h3 className="text-lg font-semibold tracking-tight">QR कोड स्क्यान गर्नुहोस्</h3>
      </div>

      {/* Main scanner container */}
      <div className="relative aspect-video w-full bg-black rounded-lg overflow-hidden flex items-center justify-center border border-slate-800 mb-6">
        {/* Always render the video tag in the layout so the ref is bound, toggle display based on active streaming state */}
        <video
          ref={videoRef}
          className={`w-full h-full object-cover transition-opacity duration-300 ${hasPermission === true ? "opacity-100 block" : "opacity-0 hidden"}`}
          style={{ transform: "scaleX(1)" }}
          playsInline
          muted
        />

        {hasPermission === true && scanning && (
          /* Overlay Target Framing */
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="w-48 h-48 border-2 border-emerald-500 rounded-xl relative">
              {/* Scanner Scanning Line Animation */}
              <div className="absolute left-0 right-0 h-0.5 bg-emerald-400 animate-[bounce_2s_infinite]" />
              {/* Corner Accents */}
              <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white -translate-x-0.5 -translate-y-0.5" />
              <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white translate-x-0.5 -translate-y-0.5" />
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white -translate-x-0.5 translate-y-0.5" />
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white translate-x-0.5 translate-y-0.5" />
            </div>
          </div>
        )}

        {hasPermission === null && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-slate-400 gap-2.5 z-20">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-emerald-500 border-r-2" />
            <span className="text-xs font-bold tracking-wide">क्यामेरा सुरु हुँदैछ...</span>
          </div>
        )}

        {(hasPermission === false || error) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 p-4 text-center z-20 space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 animate-bounce" />
            <p className="text-xs text-slate-300 leading-relaxed font-semibold px-2">{error || "क्यामेरा खोल्न सकिएन।"}</p>
            <button
              onClick={startCamera}
              className="flex items-center gap-1.5 py-1.5 px-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] rounded-lg shadow-md transition-all active:scale-95 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>पुनः प्रयास गर्नुहोस्</span>
            </button>
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Alternate Option: Upload QR Code screenshot */}
      <div className="pt-4 border-t border-slate-800">
        <p className="text-xs text-slate-400 text-center mb-3">
          वा QR कोड भएको तस्विर (स्क्रीनशट) अपलोड गर्नुहोस्:
        </p>
        <label
          className="flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl cursor-pointer text-sm font-medium transition-all group active:scale-95"
          id="qr-file-upload-label"
        >
          <Upload className="w-4 h-4 text-emerald-400 group-hover:text-emerald-300" />
          <span>तस्विर अपलोड गर्नुहोस्</span>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
            id="qr-image-input"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
        <Check className="w-3.5 h-3.5 text-emerald-500" />
        <span>क्यामेरा र QR कोड स्क्यान पूर्ण सुरक्षित र स्थानीय रूपमा मात्र प्रशोधन हुन्छ।</span>
      </div>
    </div>
  );
}
