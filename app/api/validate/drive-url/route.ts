import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { validatePsd } from "@/lib/psdValidator";
import type { ValidationResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for large folders

/**
 * Download + validate this many files simultaneously from Drive.
 * Keep low (3-5) to avoid Google rate limiting when using API keys.
 * With OAuth tokens, can go higher.
 */
const DRIVE_CONCURRENCY_OAUTH = 8;
const DRIVE_CONCURRENCY_APIKEY = 3;

/** Delay in ms between batches to avoid Google's bot detection. */
const BATCH_DELAY_MS_OAUTH = 200;
const BATCH_DELAY_MS_APIKEY = 1500;

/** Max retries per file on transient errors (403, 429, 5xx). */
const MAX_RETRIES = 3;

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

interface DriveUrlRequestBody {
  urls: string[];
}

// ---------------------------------------------------------------------------
// URL → ID extraction
// ---------------------------------------------------------------------------

interface ParsedUrl {
  id: string;
  type: "file" | "folder";
}

/**
 * Extracts a Google Drive file or folder ID from various URL formats:
 *   - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 *   - https://drive.google.com/open?id=FILE_ID
 *   - https://drive.google.com/uc?export=download&id=FILE_ID
 *   - https://drive.google.com/drive/folders/FOLDER_ID
 *   - https://drive.google.com/drive/mobile/folders/FOLDER_ID
 *   - https://drive.google.com/drive/u/0/folders/FOLDER_ID
 *   - Plain file/folder ID
 */
function parseUrl(input: string): ParsedUrl | null {
  const trimmed = input.trim();

  // Folder patterns: /folders/FOLDER_ID (with optional path prefixes)
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return { id: folderMatch[1], type: "folder" };

  // File pattern: /file/d/FILE_ID/
  const fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return { id: fileMatch[1], type: "file" };

  // Query param: ?id=FILE_ID or &id=FILE_ID
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return { id: idMatch[1], type: "file" };

  // Plain ID (10+ alphanumeric chars) — assume file
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return { id: trimmed, type: "file" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

interface AuthContext {
  headers: Record<string, string>;
  query: string;
  hasOAuth: boolean;
}

function buildAuth(accessToken?: string, apiKey?: string): AuthContext {
  if (accessToken) {
    return {
      headers: { Authorization: `Bearer ${accessToken}` },
      query: "",
      hasOAuth: true,
    };
  }
  if (apiKey) {
    return {
      headers: {},
      query: `&key=${encodeURIComponent(apiKey)}`,
      hasOAuth: false,
    };
  }
  throw new Error(
    "Not authenticated. Sign in with Google (Drive Picker tab) or use a publicly shared link."
  );
}

// ---------------------------------------------------------------------------
// Retry-aware fetch
// ---------------------------------------------------------------------------

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);

    // Success or client error (except 403/429) → return immediately
    if (res.ok) return res;
    if (res.status < 500 && res.status !== 403 && res.status !== 429) {
      return res;
    }

    // Retryable: 403 (bot detection), 429 (rate limit), 5xx
    lastError = new Error(`HTTP ${res.status}`);

    if (attempt < retries) {
      // Exponential backoff: 2s, 4s, 8s
      const delay = Math.pow(2, attempt + 1) * 1000;
      await sleep(delay);
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DriveUrlRequestBody;
    if (!Array.isArray(body.urls) || body.urls.length === 0) {
      return NextResponse.json(
        { error: "urls[] is required" },
        { status: 400 }
      );
    }

    const session = await getServerSession(authOptions);
    const accessToken = session?.accessToken;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;

    let auth: AuthContext;
    try {
      auth = buildAuth(accessToken, apiKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Auth error";
      return NextResponse.json({ error: msg }, { status: 401 });
    }

    const results: ValidationResult[] = [];

    for (const url of body.urls) {
      const parsed = parseUrl(url);

      if (!parsed) {
        results.push({
          fileName: url.length > 80 ? url.slice(0, 77) + "..." : url,
          source: "drive",
          isPsd: false,
          pass: false,
          reasons: [
            "Could not extract file/folder ID from URL. Supported formats: drive.google.com/file/d/ID/..., drive.google.com/drive/folders/ID, or a plain ID.",
          ],
        });
        continue;
      }

      try {
        if (parsed.type === "folder") {
          const folderResults = await validateFolder(parsed.id, auth);
          results.push(...folderResults);
        } else {
          const result = await downloadAndValidate(parsed.id, url, auth);
          results.push(result);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown Drive error";
        results.push({
          fileName: url.length > 80 ? url.slice(0, 77) + "..." : url,
          source: "drive",
          isPsd: false,
          pass: false,
          reasons: [`Drive error: ${message}`],
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err: unknown) {
    console.error("POST /api/validate/drive-url error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// List all files in a Drive folder (recursive into subfolders)
// ---------------------------------------------------------------------------

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

async function listFolderFiles(
  folderId: string,
  auth: AuthContext
): Promise<DriveFile[]> {
  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;

  const query = `'${folderId}' in parents and trashed = false`;

  do {
    const params = new URLSearchParams({
      q: query,
      fields: "nextPageToken, files(id, name, mimeType, size)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `https://www.googleapis.com/drive/v3/files?${params}${auth.query}`;
    const res = await fetchWithRetry(url, { headers: auth.headers });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to list folder (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      files?: DriveFile[];
      nextPageToken?: string;
    };

    if (data.files) {
      for (const file of data.files) {
        if (file.mimeType === "application/vnd.google-apps.folder") {
          const subFiles = await listFolderFiles(file.id, auth);
          allFiles.push(...subFiles);
        } else {
          allFiles.push(file);
        }
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

/**
 * Validate all files in a Google Drive folder.
 */
async function validateFolder(
  folderId: string,
  auth: AuthContext
): Promise<ValidationResult[]> {
  const files = await listFolderFiles(folderId, auth);

  if (files.length === 0) {
    return [
      {
        fileName: `Folder ${folderId}`,
        source: "drive",
        isPsd: false,
        pass: false,
        reasons: ["Folder is empty or not accessible"],
      },
    ];
  }

  const psdFiles = files.filter(
    (f) =>
      f.name.toLowerCase().endsWith(".psd") ||
      f.mimeType === "image/vnd.adobe.photoshop" ||
      f.mimeType === "application/x-photoshop" ||
      f.mimeType === "application/photoshop"
  );

  if (psdFiles.length === 0) {
    return [
      {
        fileName: `Folder (${files.length} files scanned)`,
        source: "drive",
        isPsd: false,
        pass: false,
        reasons: [
          `No .psd files found in folder. Found ${files.length} other file(s).`,
        ],
      },
    ];
  }

  // Pick concurrency & delay based on auth type
  const concurrency = auth.hasOAuth
    ? DRIVE_CONCURRENCY_OAUTH
    : DRIVE_CONCURRENCY_APIKEY;
  const batchDelay = auth.hasOAuth
    ? BATCH_DELAY_MS_OAUTH
    : BATCH_DELAY_MS_APIKEY;

  const results: ValidationResult[] = [];

  for (let i = 0; i < psdFiles.length; i += concurrency) {
    const batch = psdFiles.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        try {
          return await downloadAndValidate(file.id, file.name, auth);
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Unknown Drive error";
          return {
            fileName: file.name,
            source: "drive" as const,
            isPsd: false,
            pass: false,
            reasons: [`Download error: ${message}`],
          };
        }
      })
    );
    results.push(...batchResults);

    // Pause between batches to avoid rate limiting
    if (i + concurrency < psdFiles.length) {
      await sleep(batchDelay);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Download a single file from Google Drive and validate it
// ---------------------------------------------------------------------------

async function downloadAndValidate(
  fileId: string,
  displayName: string,
  auth: AuthContext
): Promise<ValidationResult> {
  // 1. Fetch metadata (with retry)
  const metaRes = await fetchWithRetry(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,size&supportsAllDrives=true${auth.query}`,
    { headers: auth.headers }
  );

  if (!metaRes.ok) {
    const text = await metaRes.text();
    if (metaRes.status === 404) {
      throw new Error(
        "File not found — check the URL or make sure it is shared"
      );
    }
    throw new Error(`Metadata fetch failed (${metaRes.status}): ${text}`);
  }

  const meta = (await metaRes.json()) as { name?: string; size?: string };
  const fileName = meta.name ?? displayName;
  const fileSize = meta.size ? parseInt(meta.size, 10) : 0;

  if (fileSize > MAX_DOWNLOAD_BYTES) {
    return {
      fileName,
      source: "drive",
      isPsd: false,
      pass: false,
      reasons: ["File too large (>200 MB)"],
    };
  }

  // 2. Download content (with retry)
  const contentRes = await fetchWithRetry(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true${auth.query}`,
    { headers: auth.headers }
  );

  if (!contentRes.ok) {
    const text = await contentRes.text();
    throw new Error(`Download failed (${contentRes.status}): ${text}`);
  }

  const arrayBuffer = await contentRes.arrayBuffer();
  return validatePsd(arrayBuffer, fileName, "drive");
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
