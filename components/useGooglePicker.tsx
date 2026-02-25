"use client";

import { useCallback, useEffect, useRef } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Extend Window to include the Google Picker types we need
declare global {
  interface Window {
    google?: {
      picker: {
        PickerBuilder: new () => GooglePickerBuilder;
        ViewId: { DOCS: string };
        Feature: { MULTISELECT_ENABLED: string };
        Action: { PICKED: string; CANCEL: string };
        DocsViewMode: { LIST: string };
        DocsView: new (viewId?: string) => GooglePickerView;
      };
    };
    gapi?: {
      load: (api: string, callback: () => void) => void;
    };
  }
}

interface GooglePickerBuilder {
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (id: string) => GooglePickerBuilder;
  addView: (view: GooglePickerView) => GooglePickerBuilder;
  enableFeature: (feature: string) => GooglePickerBuilder;
  setCallback: (cb: (data: GooglePickerCallbackData) => void) => GooglePickerBuilder;
  setTitle: (title: string) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}

interface GooglePickerView {
  setMimeTypes: (types: string) => GooglePickerView;
  setMode: (mode: string) => GooglePickerView;
  setOwnedByMe: (owned: boolean) => GooglePickerView;
  setLabel: (label: string) => GooglePickerView;
  setIncludeFolders: (include: boolean) => GooglePickerView;
}

interface GooglePickerCallbackData {
  action: string;
  docs?: Array<{ id: string; name: string }>;
}

interface UseGooglePickerOptions {
  accessToken: string;
  onPicked: (fileIds: string[]) => void;
}

const PICKER_API_KEY =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY ?? ""
    : "";

const PICKER_APP_ID =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID ?? ""
    : "";

const PSD_MIME_TYPES =
  "image/vnd.adobe.photoshop,application/x-photoshop,application/photoshop";

/**
 * Loads the Google Picker API script and returns a function to open the picker.
 * The picker shows three tabs:
 *   1. "My Drive" – files you own
 *   2. "Shared with me" – files others shared with you
 *   3. "Shared Drives" – files from shared/team drives
 */
export function useGooglePicker({
  accessToken,
  onPicked,
}: UseGooglePickerOptions) {
  const scriptLoaded = useRef(false);

  // Load the Google API loader script once
  useEffect(() => {
    if (scriptLoaded.current) return;
    if (typeof document === "undefined") return;

    if (
      document.querySelector('script[src="https://apis.google.com/js/api.js"]')
    ) {
      scriptLoaded.current = true;
      return;
    }

    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      scriptLoaded.current = true;
    };
    document.body.appendChild(script);
  }, []);

  const openPicker = useCallback(() => {
    if (!accessToken) {
      console.warn("No access token for Google Picker");
      return;
    }

    if (!window.gapi) {
      console.warn("gapi not loaded yet");
      return;
    }

    window.gapi.load("picker", () => {
      const google = window.google;
      if (!google?.picker) {
        console.warn("Google Picker API not available");
        return;
      }

      // ── View 1: My Drive ──────────────────────────────────
      const myDriveView = new google.picker.DocsView();
      myDriveView.setMimeTypes(PSD_MIME_TYPES);
      myDriveView.setMode(google.picker.DocsViewMode.LIST);
      myDriveView.setOwnedByMe(true);
      myDriveView.setIncludeFolders(true);
      myDriveView.setLabel("My Drive");

      // ── View 2: Shared with me ────────────────────────────
      const sharedView = new google.picker.DocsView();
      sharedView.setMimeTypes(PSD_MIME_TYPES);
      sharedView.setMode(google.picker.DocsViewMode.LIST);
      sharedView.setOwnedByMe(false);
      sharedView.setIncludeFolders(true);
      sharedView.setLabel("Shared with me");

      // ── View 3: Shared Drives (Team Drives) ───────────────
      // ViewId "DOCS" with setEnableTeamDrives gives access to shared drives.
      // If the method isn't available, the first two views cover most cases.
      let sharedDrivesView: GooglePickerView | null = null;
      try {
        const sdView = new google.picker.DocsView() as any;
        if (typeof sdView.setEnableDrives === "function") {
          sdView.setEnableDrives(true);
          sdView.setMimeTypes(PSD_MIME_TYPES);
          sdView.setMode(google.picker.DocsViewMode.LIST);
          sdView.setIncludeFolders(true);
          sdView.setLabel("Shared Drives");
          sharedDrivesView = sdView;
        }
      } catch {
        // Not all Picker versions support shared drives; ignore
      }

      // ── Build the picker ──────────────────────────────────
      const builder = new google.picker.PickerBuilder()
        .setOAuthToken(accessToken)
        .setDeveloperKey(PICKER_API_KEY)
        .setTitle("Select PSD files")
        .addView(myDriveView)
        .addView(sharedView)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setCallback((data: GooglePickerCallbackData) => {
          if (data.action === google.picker.Action.PICKED && data.docs) {
            const ids = data.docs.map((d) => d.id);
            onPicked(ids);
          }
        });

      if (sharedDrivesView) {
        builder.addView(sharedDrivesView);
      }

      if (PICKER_APP_ID) {
        builder.setAppId(PICKER_APP_ID);
      }

      // Enable support for shared drive files in the API response
      try {
        (builder as any).setIncludeFolders?.(true);
        (builder as any).enableFeature?.("supportDrives");
      } catch {
        // Graceful fallback if the method isn't available
      }

      const picker = builder.build();
      picker.setVisible(true);
    });
  }, [accessToken, onPicked]);

  return openPicker;
}
