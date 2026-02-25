"use client";

import { useCallback, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import type { ValidationResult } from "@/lib/types";
import type { ProgressInfo } from "@/app/page";

interface Props {
  onResults: (results: ValidationResult[]) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setProgress: (v: ProgressInfo) => void;
}

export function DriveUrlInput({
  onResults,
  loading,
  setLoading,
  setProgress,
}: Props) {
  const { data: session } = useSession();
  const isSignedIn = !!session?.accessToken;
  const [urlText, setUrlText] = useState("");

  const handleSubmit = useCallback(async () => {
    const urls = urlText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (urls.length === 0) return;

    setLoading(true);
    setProgress({
      total: urls.length,
      done: 0,
      label: `Scanning ${urls.length} Drive link(s)... (folder links may take a moment to list files)`,
    });

    try {
      const res = await fetch("/api/validate/drive-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `Server error ${res.status}`);
      }

      const data = (await res.json()) as { results: ValidationResult[] };
      onResults(data.results);

      setProgress({
        total: data.results.length,
        done: data.results.length,
        label: `Done — ${data.results.length} file(s) checked`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "URL check failed";
      onResults([
        {
          fileName: "URL Error",
          source: "drive",
          isPsd: false,
          pass: false,
          reasons: [msg],
        },
      ]);
    } finally {
      setLoading(false);
      setProgress({ total: 0, done: 0, label: "" });
    }
  }, [urlText, onResults, setLoading, setProgress]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
      {/* Sign-in hint */}
      {!isSignedIn && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
          <svg
            className="h-5 w-5 text-amber-500 shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <span className="text-amber-800">
              For best results with private/shared files,{" "}
              <button
                onClick={() => signIn("google")}
                className="font-semibold underline hover:text-amber-900"
              >
                sign in with Google
              </button>{" "}
              first.
            </span>
            <span className="text-amber-600 block text-xs mt-0.5">
              Without sign-in, only publicly shared links work and may be rate-limited by Google.
            </span>
          </div>
        </div>
      )}

      {isSignedIn && (
        <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
              clipRule="evenodd"
            />
          </svg>
          Signed in — full access to shared and private Drive files
        </div>
      )}

      <div>
        <label
          htmlFor="drive-urls"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Paste Google Drive links
        </label>
        <textarea
          id="drive-urls"
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
          placeholder={`https://drive.google.com/drive/folders/abc123...\nhttps://drive.google.com/file/d/def456/view?usp=sharing`}
          rows={4}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder:text-gray-400"
        />
        <p className="mt-1 text-xs text-gray-400">
          Supports file links AND folder links (scans all PSDs in folder
          including subfolders). One URL per line or comma-separated.
        </p>
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading || urlText.trim().length === 0}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 shadow-sm disabled:opacity-50"
      >
        Check Links
      </button>
    </div>
  );
}
