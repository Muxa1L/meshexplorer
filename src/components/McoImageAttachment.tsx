"use client";

import { useEffect, useRef, useState } from "react";
import { ensureMcoImgBrowserLoaded } from "@/lib/mcoimg";

interface McoImageAttachmentProps {
  payload: string | Uint8Array;
  input?: "auto" | "text" | "binary" | "png";
}

interface ImageSize {
  width: number;
  height: number;
}

interface DecodeFailure {
  message: string;
  fallbackToText: boolean;
}

function preferredDisplayWidth(size: ImageSize | null): number {
  if (!size) {
    return 160;
  }

  return Math.min(Math.max(size.width * 8, 96), 320);
}

export default function McoImageAttachment({ payload, input = "auto" }: McoImageAttachmentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<ImageSize | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [decodeFailure, setDecodeFailure] = useState<DecodeFailure | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function decodeAndDraw(): Promise<void> {
      setIsLoading(true);
      setDecodeFailure(null);
      setSize(null);

      try {
        const runtime = await ensureMcoImgBrowserLoaded();
        const pngBytes = await runtime.convertPayload(payload, {
          input,
          output: "png",
        });

        if (typeof runtime.drawPngBytesToCanvas !== "function") {
          throw new Error("MCOimg draw helper is unavailable");
        }

        if (cancelled || !canvasRef.current) {
          return;
        }

        const drawn = await runtime.drawPngBytesToCanvas(pngBytes, canvasRef.current);
        if (!cancelled) {
          const inspected = runtime.inspectPayload(payload);
          setSize({
            width: drawn?.width ?? inspected?.width ?? canvasRef.current.width,
            height: drawn?.height ?? inspected?.height ?? canvasRef.current.height,
          });
          setIsLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setDecodeFailure({
            message: error instanceof Error ? error.message : "Unknown image decode error",
            fallbackToText: typeof payload === "string" && input !== "binary" && input !== "png",
          });
          setIsLoading(false);
        }
      }
    }

    void decodeAndDraw();

    return () => {
      cancelled = true;
    };
  }, [input, payload]);

  if (decodeFailure?.fallbackToText && typeof payload === "string") {
    return <span className="whitespace-pre-wrap break-all">{payload}</span>;
  }

  if (decodeFailure) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
        <div className="font-medium">Image decode failed</div>
        <div className="mt-1 opacity-80">{decodeFailure.message}</div>
        <div className="mt-1 break-all font-mono text-[11px] opacity-80">
          {typeof payload === "string" ? payload : `${payload.length} bytes`}
        </div>
      </div>
    );
  }

  return (
    <div className="inline-flex max-w-full flex-col gap-2 rounded-2xl border border-gray-200/80 bg-gray-50/90 p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-950/70">
      <canvas
        ref={canvasRef}
        className="h-auto rounded-lg bg-white shadow-sm [image-rendering:pixelated] dark:bg-neutral-900"
        style={{ width: preferredDisplayWidth(size) }}
      />
      {isLoading ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">Decoding image…</div>
      ) : size ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">{size.width} x {size.height}</div>
      ) : null}
    </div>
  );
}
