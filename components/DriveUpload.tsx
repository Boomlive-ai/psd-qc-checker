"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useCallback } from "react";
import type { ValidationResult } from "@/lib/types";
import type { ProgressInfo } from "@/app/page";
import { useGooglePicker } from "@/components/useGooglePicker";

interface Props {
  onResults: (results: ValidationResult[]) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setProgress: (v: ProgressInfo) => void;
}

export function DriveUpload({
  onResults,
  loading,
  setLoading,
  setProgress,
}: Props) {
  const { data: session, status } = useSession();
  const accessToken = session?.accessToken;

  const handlePicked = useCallback(
    async (fileIds: string[]) => {
      if (fileIds.length === 0) return;

      setLoading(true);
      setProgress({
        total: fileIds.length,
        done: 0,
        label: `Downloading & validating ${fileIds.length} file(s) from Drive...`,
      });

      try {
        const res = await fetch("/api/validate/drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileIds }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error ?? `Server error ${res.status}`);
        }

        const data = (await res.json()) as { results: ValidationResult[] };
        onResults(data.results);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Drive validation failed";
        onResults([
          {
            fileName: "Drive Error",
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
    },
    [onResults, setLoading, setProgress]
  );

  const openPicker = useGooglePicker({
    accessToken: accessToken ?? "",
    onPicked: handlePicked,
  });

  // Not signed in
  if (status === "unauthenticated" || !session) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center space-y-4">
        <p className="text-sm text-gray-600">
          Sign in with Google to pick files from your Drive.
        </p>
        <button
          onClick={() => signIn("google")}
          disabled={status === "loading"}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm disabled:opacity-50"
        >
          <GoogleIcon />
          Connect Google
        </button>
      </div>
    );
  }

  // Signed in
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-10 text-center space-y-4">
      <p className="text-sm text-gray-600">
        Signed in as{" "}
        <span className="font-medium">{session.user?.email}</span>
        <button
          onClick={() => signOut()}
          className="ml-2 text-xs text-red-500 hover:text-red-600 underline"
        >
          Sign out
        </button>
      </p>

      <button
        onClick={openPicker}
        disabled={loading || !accessToken}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 shadow-sm disabled:opacity-50"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7.71 3.5l1.63 2.82h6.32L17.29 3.5H7.71zm8.37 3.82H7.92L2.39 17.35l1.63 2.82 5.53-9.59h6.9l5.53 9.59 1.63-2.82-7.53-10.03zm-8.16 6.18L2.39 3.5.76 6.32l5.53 9.59 1.63-2.41z" />
        </svg>
        Pick from Drive
      </button>
      <p className="text-xs text-gray-400">
        Select one or more PSD files from your Google Drive
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
