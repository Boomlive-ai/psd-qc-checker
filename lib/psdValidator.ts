import { readPsd } from "ag-psd";
import type { Layer } from "ag-psd";
import type { ValidationResult } from "./types";

/** Maximum file size: 200 MB */
const MAX_FILE_SIZE = 200 * 1024 * 1024;

/** Minimum required megapixels */
const MIN_MP = 2.0;

/** Preferred megapixels threshold */
const PREFERRED_MP = 16.0;

/** Minimum required layers */
const MIN_LAYERS = 3;

/** Per-file parsing timeout in milliseconds */
const PARSE_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// PSD signature check
// ---------------------------------------------------------------------------

/** Returns true if the buffer starts with the PSD magic bytes "8BPS". */
function isPsdSignature(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  const view = new Uint8Array(buffer, 0, 4);
  // ASCII: '8' = 56, 'B' = 66, 'P' = 80, 'S' = 83
  return view[0] === 56 && view[1] === 66 && view[2] === 80 && view[3] === 83;
}

// ---------------------------------------------------------------------------
// Layer counting helpers
// ---------------------------------------------------------------------------

interface LayerCounts {
  totalLayers: number;
  artLayers: number;
}

/**
 * Recursively count layers.
 *
 * A layer is considered a "group" (folder) if it has a non-empty `children`
 * array. Everything else is counted as an art layer. Group folders themselves
 * are still counted toward `totalLayers` but NOT toward `artLayers`.
 */
function countLayers(layers: Layer[] | undefined): LayerCounts {
  if (!layers || layers.length === 0) return { totalLayers: 0, artLayers: 0 };

  let total = 0;
  let art = 0;

  for (const layer of layers) {
    total += 1;

    const isGroup = Array.isArray(layer.children) && layer.children.length > 0;
    if (!isGroup) {
      art += 1;
    }

    // Recurse into group children
    if (layer.children) {
      const child = countLayers(layer.children);
      total += child.totalLayers;
      art += child.artLayers;
    }
  }

  return { totalLayers: total, artLayers: art };
}

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

/**
 * Validate a single PSD file represented as an ArrayBuffer.
 *
 * @param buffer  Raw file bytes
 * @param fileName  Display name of the file
 * @param source  Where the file came from ("local" | "drive")
 * @returns A fully-populated ValidationResult
 */
export async function validatePsd(
  buffer: ArrayBuffer,
  fileName: string,
  source: "local" | "drive"
): Promise<ValidationResult> {
  const reasons: string[] = [];

  // --- Size guard ---
  if (buffer.byteLength > MAX_FILE_SIZE) {
    return {
      fileName,
      source,
      isPsd: false,
      pass: false,
      reasons: ["File too large (>200 MB)"],
    };
  }

  // --- Signature check ---
  if (!isPsdSignature(buffer)) {
    return {
      fileName,
      source,
      isPsd: false,
      pass: false,
      reasons: ["Not a PSD signature"],
    };
  }

  // --- Parse PSD with timeout ---
  let width: number;
  let height: number;
  let dpiH: number | undefined;
  let dpiV: number | undefined;
  let totalLayers: number;
  let artLayers: number;

  try {
    const psd = await parseWithTimeout(buffer, PARSE_TIMEOUT_MS);

    width = psd.width;
    height = psd.height;

    // Extract DPI from imageResources.resolutionInfo
    const resInfo = psd.imageResources?.resolutionInfo;
    if (resInfo) {
      dpiH = Math.round(resInfo.horizontalResolution);
      dpiV = Math.round(resInfo.verticalResolution);
    }

    const counts = countLayers(psd.children);
    totalLayers = counts.totalLayers;
    artLayers = counts.artLayers;
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown parsing error";
    return {
      fileName,
      source,
      isPsd: true,
      pass: false,
      reasons: [`Parse error: ${message}`],
    };
  }

  // --- Resolution check ---
  const mp = (width * height) / 1_000_000;
  const preferred16MP = mp >= PREFERRED_MP;

  if (mp < MIN_MP) {
    reasons.push(`Resolution below 2MP (${mp.toFixed(2)} MP)`);
  }

  // --- Layer check ---
  if (totalLayers < MIN_LAYERS) {
    reasons.push(`Less than 3 layers (found ${totalLayers})`);
  }

  const pass = reasons.length === 0;

  return {
    fileName,
    source,
    isPsd: true,
    width,
    height,
    mp: parseFloat(mp.toFixed(2)),
    dpiH,
    dpiV,
    totalLayers,
    artLayers,
    preferred16MP,
    pass,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

/**
 * Parse a PSD buffer, aborting if parsing takes longer than `timeoutMs`.
 *
 * ag-psd's `readPsd` is synchronous, so we run it inside a microtask and
 * race against a timer. This prevents a single huge file from blocking the
 * event loop indefinitely.
 */
function parseWithTimeout(
  buffer: ArrayBuffer,
  timeoutMs: number
): Promise<ReturnType<typeof readPsd>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Parsing timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    // Run synchronous parse on the next tick so the timeout can fire
    setImmediate(() => {
      try {
        const psd = readPsd(buffer, {
          skipLayerImageData: true,
          skipCompositeImageData: true,
          skipThumbnail: true,
          skipLinkedFilesData: true,
        });
        clearTimeout(timer);
        resolve(psd);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}
