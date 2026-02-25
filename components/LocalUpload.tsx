"use client";

import { useCallback, useRef, useState } from "react";
import type { ValidationResult } from "@/lib/types";
import type { ProgressInfo } from "@/app/page";

interface Props {
  onResults: (results: ValidationResult[]) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setProgress: (v: ProgressInfo) => void;
}

/** Batch size: send files in chunks to avoid huge single requests. */
const BATCH_SIZE = 50;

export function LocalUpload({
  onResults,
  loading,
  setLoading,
  setProgress,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  /** Filter to only .psd files (useful when a whole folder is selected). */
  const filterPsd = (files: File[]): File[] =>
    files.filter((f) => f.name.toLowerCase().endsWith(".psd"));

  const handleFiles = useCallback(
    async (rawFiles: FileList | File[]) => {
      const psdFiles = filterPsd(Array.from(rawFiles));
      if (psdFiles.length === 0) {
        onResults([
          {
            fileName: "No PSD files",
            source: "local",
            isPsd: false,
            pass: false,
            reasons: ["No .psd files found in selection"],
          },
        ]);
        return;
      }

      setLoading(true);
      let done = 0;
      const total = psdFiles.length;

      setProgress({ total, done: 0, label: `Preparing ${total} file(s)...` });

      try {
        for (let i = 0; i < psdFiles.length; i += BATCH_SIZE) {
          const batch = psdFiles.slice(i, i + BATCH_SIZE);

          setProgress({
            total,
            done,
            label: `Uploading & validating files ${i + 1}–${Math.min(i + BATCH_SIZE, total)} of ${total}...`,
          });

          const form = new FormData();
          for (const f of batch) {
            form.append("files", f);
          }

          const res = await fetch("/api/validate/local", {
            method: "POST",
            body: form,
          });

          if (!res.ok) {
            const err = await res
              .json()
              .catch(() => ({ error: res.statusText }));
            throw new Error(err.error ?? `Server error ${res.status}`);
          }

          const data = (await res.json()) as { results: ValidationResult[] };
          onResults(data.results);

          done += batch.length;
          setProgress({
            total,
            done,
            label: `Validated ${done} of ${total} files`,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        onResults([
          {
            fileName: "Upload Error",
            source: "local",
            isPsd: false,
            pass: false,
            reasons: [msg],
          },
        ]);
      } finally {
        setLoading(false);
        setProgress({ total: 0, done: 0, label: "" });
      }
    },
    [onResults, setLoading, setProgress]
  );

  // --- Drag & drop: support both files and folders ---

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      // Try to read folder entries via DataTransferItem.webkitGetAsEntry
      const items = e.dataTransfer.items;
      if (
        items &&
        items.length > 0 &&
        typeof items[0].webkitGetAsEntry === "function"
      ) {
        const allFiles = await readDroppedEntries(items);
        if (allFiles.length > 0) {
          handleFiles(allFiles);
          return;
        }
      }

      // Fallback: plain file list
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
        dragOver
          ? "border-indigo-400 bg-indigo-50"
          : "border-gray-300 bg-white hover:border-gray-400"
      }`}
    >
      {/* Hidden file input (individual files) */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".psd"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Hidden folder input */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error -- webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="space-y-3">
        <svg
          className="mx-auto h-10 w-10 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 16v-8m0 0l-3 3m3-3l3 3M3 16.5V18a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 18v-1.5M7.5 12.75L12 8.25l4.5 4.5"
          />
        </svg>

        <p className="text-sm text-gray-600">
          Drag &amp; drop PSD files or folders here
        </p>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors"
          >
            Browse Files
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => folderInputRef.current?.click()}
            className="px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors"
          >
            Browse Folder
          </button>
        </div>

        <p className="text-xs text-gray-400">
          Scans all .psd files (including subfolders) &middot; Max 200 MB per
          file
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers: recursively read files from dropped folder entries
// ---------------------------------------------------------------------------

async function readDroppedEntries(
  items: DataTransferItemList
): Promise<File[]> {
  const files: File[] = [];

  const readEntry = (entry: FileSystemEntry): Promise<void> => {
    return new Promise((resolve) => {
      if (entry.isFile) {
        (entry as FileSystemFileEntry).file((f) => {
          files.push(f);
          resolve();
        });
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        reader.readEntries(async (entries) => {
          for (const e of entries) {
            await readEntry(e);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  };

  const promises: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry();
    if (entry) {
      promises.push(readEntry(entry));
    }
  }
  await Promise.all(promises);

  return files;
}
