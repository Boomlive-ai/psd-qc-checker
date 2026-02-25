"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { ValidationResult } from "@/lib/types";
import { LocalUpload } from "@/components/LocalUpload";
import { DriveUpload } from "@/components/DriveUpload";
import { DriveUrlInput } from "@/components/DriveUrlInput";
import { ResultsTable } from "@/components/ResultsTable";

type Tab = "local" | "drive-url" | "drive";

/** Shared progress state passed to upload components. */
export interface ProgressInfo {
  /** Total number of files to process (known after scan/upload). */
  total: number;
  /** Number of files completed so far. */
  done: number;
  /** Short status label. */
  label: string;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("local");
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo>({
    total: 0,
    done: 0,
    label: "",
  });

  // Timer: track elapsed seconds while loading
  const startTimeRef = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);

  // Start/stop a 1-second interval timer when loading changes
  useEffect(() => {
    if (loading) {
      startTimeRef.current = Date.now();
      setElapsed(0);
      const id = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
      return () => clearInterval(id);
    }
  }, [loading]);

  const addResults = useCallback((newResults: ValidationResult[]) => {
    setResults((prev) => [...prev, ...newResults]);
  }, []);

  const clearResults = () => setResults([]);

  // Compute ETA
  const eta = computeEta(progress, elapsed);

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6">
          <h1 className="text-2xl font-bold tracking-tight">
            PSD QC Checker
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            PSD &bull; &ge;3 layers &bull; &ge;2 MP (preferred 16 MP)
          </p>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 sm:px-6 space-y-6">
        {/* Tab bar */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          <TabButton active={tab === "local"} onClick={() => setTab("local")}>
            Local Upload
          </TabButton>
          <TabButton
            active={tab === "drive-url"}
            onClick={() => setTab("drive-url")}
          >
            Drive Link
          </TabButton>
          <TabButton active={tab === "drive"} onClick={() => setTab("drive")}>
            Drive Picker
          </TabButton>
        </div>

        {/* Upload area */}
        {tab === "local" && (
          <LocalUpload
            onResults={addResults}
            loading={loading}
            setLoading={setLoading}
            setProgress={setProgress}
          />
        )}
        {tab === "drive-url" && (
          <DriveUrlInput
            onResults={addResults}
            loading={loading}
            setLoading={setLoading}
            setProgress={setProgress}
          />
        )}
        {tab === "drive" && (
          <DriveUpload
            onResults={addResults}
            loading={loading}
            setLoading={setLoading}
            setProgress={setProgress}
          />
        )}

        {/* Progress indicator */}
        {loading && (
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 space-y-2">
            {/* Progress bar */}
            {progress.total > 0 && (
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, (progress.done / progress.total) * 100)}%`,
                  }}
                />
              </div>
            )}

            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <Spinner />
                <span>{progress.label || "Processing..."}</span>
              </div>

              <div className="flex items-center gap-4 text-xs text-gray-400">
                {progress.total > 0 && (
                  <span>
                    {progress.done} / {progress.total} files
                  </span>
                )}
                <span>Elapsed: {formatTime(elapsed)}</span>
                {eta !== null && <span>ETA: {formatTime(eta)}</span>}
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <ResultsTable results={results} onClear={clearResults} />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeEta(progress: ProgressInfo, elapsed: number): number | null {
  if (progress.total === 0 || progress.done === 0 || elapsed === 0)
    return null;

  const rate = progress.done / elapsed; // files per second
  const remaining = progress.total - progress.done;
  return Math.ceil(remaining / rate);
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
        active
          ? "bg-white text-gray-900 shadow-sm"
          : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-indigo-600"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
