const MCOIMG_SCRIPT_URLS = [
  "/mcoimg/mcoimg-codec.global.js",
  "/mcoimg/mcoimg-v3-codec.global.js",
  "/mcoimg/mcoimg-browser.global.js",
] as const;

type PayloadOutput = "text" | "binary" | "png" | "image" | "encoded";

export interface McoImgInspectResult {
  version?: number;
  width?: number;
  height?: number;
}

export interface McoImgBrowserRuntime {
  convertPayload(
    payload: string | Uint8Array,
    options?: { output?: PayloadOutput; input?: "auto" | "text" | "binary" | "png" },
  ): Promise<Uint8Array> | Uint8Array;
  inspectPayload(payload: string | Uint8Array): McoImgInspectResult | null;
  drawPngBytesToCanvas?(
    pngBytes: Uint8Array,
    targetCanvas: HTMLCanvasElement,
  ): Promise<{ width: number; height: number }>;
}

declare global {
  interface Window {
    MCOImgBrowser?: McoImgBrowserRuntime;
  }
}

const scriptLoadPromises = new Map<string, Promise<void>>();
let runtimePromise: Promise<McoImgBrowserRuntime> | null = null;

function loadScript(src: string): Promise<void> {
  if (scriptLoadPromises.has(src)) {
    return scriptLoadPromises.get(src)!;
  }

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-mcoimg-src="${src}"]`);

    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }

    const script = existing ?? document.createElement("script");

    const handleLoad = () => {
      script.dataset.loaded = "true";
      resolve();
    };

    const handleError = () => {
      scriptLoadPromises.delete(src);
      reject(new Error(`Failed to load MCOimg runtime: ${src}`));
    };

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });

    if (!existing) {
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.mcoimgSrc = src;
      document.head.appendChild(script);
    }
  });

  scriptLoadPromises.set(src, promise);
  return promise;
}

export async function ensureMcoImgBrowserLoaded(): Promise<McoImgBrowserRuntime> {
  if (typeof window === "undefined") {
    throw new Error("MCOimg runtime can only be loaded in the browser");
  }

  if (window.MCOImgBrowser) {
    return window.MCOImgBrowser;
  }

  if (!runtimePromise) {
    runtimePromise = (async () => {
      for (const src of MCOIMG_SCRIPT_URLS) {
        await loadScript(src);
      }

      if (!window.MCOImgBrowser) {
        throw new Error("MCOimg browser runtime did not initialize");
      }

      return window.MCOImgBrowser;
    })().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }

  return runtimePromise;
}

export function isMcoImagePayload(value: string): boolean {
  return /^(?:im|im3):\S+$/i.test(value.trim());
}
