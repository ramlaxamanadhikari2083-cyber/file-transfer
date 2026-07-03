import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface QrCodeDisplayProps {
  text: string;
  size?: number;
}

export default function QrCodeDisplay({ text, size = 240 }: QrCodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef.current && text) {
      QRCode.toCanvas(
        canvasRef.current,
        text,
        {
          width: size,
          margin: 2,
          color: {
            dark: "#2e1065", // Deep indigo/purple color
            light: "#ffffff", // Pure white background
          },
          errorCorrectionLevel: "H",
        },
        (error) => {
          if (error) {
            console.error("Error generating QR code:", error);
          }
        }
      );
    }
  }, [text, size]);

  return (
    <div className="p-4 bg-white border border-slate-700/50 rounded-2xl inline-block shadow-2xl transition-transform hover:scale-102 duration-300">
      <canvas ref={canvasRef} className="rounded-lg max-w-full h-auto" />
    </div>
  );
}
