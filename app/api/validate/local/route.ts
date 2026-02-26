import { NextRequest, NextResponse } from "next/server";
import { validatePsd } from "@/lib/psdValidator";
import type { ValidationResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120; // seconds

/**
 * Number of files to validate concurrently.
 * ag-psd parsing is CPU-bound and synchronous, so we limit concurrency
 * to avoid blocking the event loop for too long.
 */
const CONCURRENCY = 5;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files");

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files provided" },
        { status: 400 }
      );
    }

    // Read all file buffers first (I/O), then validate in parallel batches
    const fileEntries: { name: string; buffer: ArrayBuffer }[] = [];

    for (const entry of files) {
      // Use Blob check instead of `instanceof File` — File may not exist in all Node versions
      if (typeof entry === "string") continue;
      const blob = entry as Blob & { name?: string };
      const buffer = await blob.arrayBuffer();
      const name = blob.name || "unknown.psd";
      fileEntries.push({ name, buffer });
    }

    // Process in parallel chunks of CONCURRENCY
    const results: ValidationResult[] = [];

    for (let i = 0; i < fileEntries.length; i += CONCURRENCY) {
      const batch = fileEntries.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((f) => validatePsd(f.buffer, f.name, "local"))
      );
      results.push(...batchResults);
    }

    return NextResponse.json({ results });
  } catch (err: unknown) {
    console.error("POST /api/validate/local error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
