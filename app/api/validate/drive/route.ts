import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { validatePsd } from "@/lib/psdValidator";
import type { ValidationResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Maximum individual file size we'll download from Drive (200 MB). */
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

interface DriveRequestBody {
  fileIds: string[];
}

export async function POST(req: NextRequest) {
  try {
    // Authenticate: get the Google access token from the session.
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return NextResponse.json(
        { error: "Not authenticated. Please sign in with Google first." },
        { status: 401 }
      );
    }

    const body = (await req.json()) as DriveRequestBody;
    if (!Array.isArray(body.fileIds) || body.fileIds.length === 0) {
      return NextResponse.json(
        { error: "fileIds[] is required" },
        { status: 400 }
      );
    }

    const accessToken = session.accessToken;
    const results: ValidationResult[] = [];

    for (const fileId of body.fileIds) {
      try {
        const result = await downloadAndValidate(fileId, accessToken);
        results.push(result);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown Drive error";
        results.push({
          fileName: fileId,
          source: "drive",
          isPsd: false,
          pass: false,
          reasons: [`Drive download error: ${message}`],
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err: unknown) {
    console.error("POST /api/validate/drive error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Download a single file from Google Drive and validate it
// ---------------------------------------------------------------------------

async function downloadAndValidate(
  fileId: string,
  accessToken: string
): Promise<ValidationResult> {
  // 1. Fetch file metadata to get the name and size.
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,size&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!metaRes.ok) {
    const text = await metaRes.text();
    throw new Error(`Metadata fetch failed (${metaRes.status}): ${text}`);
  }

  const meta = (await metaRes.json()) as { name?: string; size?: string };
  const fileName = meta.name ?? fileId;
  const fileSize = meta.size ? parseInt(meta.size, 10) : 0;

  // Guard: reject oversized files before downloading.
  if (fileSize > MAX_DOWNLOAD_BYTES) {
    return {
      fileName,
      source: "drive",
      isPsd: false,
      pass: false,
      reasons: ["File too large (>200 MB)"],
    };
  }

  // 2. Download the file content.
  const contentRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!contentRes.ok) {
    const text = await contentRes.text();
    throw new Error(`Download failed (${contentRes.status}): ${text}`);
  }

  const arrayBuffer = await contentRes.arrayBuffer();

  // 3. Validate.
  return validatePsd(arrayBuffer, fileName, "drive");
}
