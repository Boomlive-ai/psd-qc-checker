"use client";

import type { ValidationResult } from "@/lib/types";

interface Props {
  results: ValidationResult[];
  onClear: () => void;
}

export function ResultsTable({ results, onClear }: Props) {
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          <span className="font-medium">{results.length}</span> file(s) checked
          &mdash;{" "}
          <span className="text-green-600 font-medium">{passCount} pass</span>,{" "}
          <span className="text-red-600 font-medium">{failCount} fail</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => downloadCsv(results)}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 rounded-md hover:bg-gray-50 shadow-sm"
          >
            Download CSV
          </button>
          <button
            onClick={onClear}
            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-md hover:bg-red-50 shadow-sm"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {[
                "File",
                "Source",
                "PSD?",
                "W x H",
                "DPI",
                "MP",
                "Layers (art/total)",
                "Preferred",
                "Status",
                "Reasons",
              ].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {results.map((r, i) => (
              <tr key={i} className={r.pass ? "" : "bg-red-50/40"}>
                <td
                  className="px-3 py-2 font-medium max-w-[200px] truncate"
                  title={r.fileName}
                >
                  {r.fileName}
                </td>
                <td className="px-3 py-2 capitalize">{r.source}</td>
                <td className="px-3 py-2">
                  {r.isPsd ? (
                    <span className="text-green-600">Yes</span>
                  ) : (
                    <span className="text-red-600">No</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.width != null && r.height != null
                    ? `${r.width} x ${r.height}`
                    : "-"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatDpi(r.dpiH, r.dpiV)}
                </td>
                <td className="px-3 py-2">{r.mp != null ? r.mp : "-"}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.artLayers != null && r.totalLayers != null
                    ? `${r.artLayers} / ${r.totalLayers}`
                    : "-"}
                </td>
                <td className="px-3 py-2">
                  {r.preferred16MP === true && (
                    <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                      16 MP+
                    </span>
                  )}
                  {r.preferred16MP === false && r.isPsd && (
                    <span className="text-gray-400 text-xs">below</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.pass ? (
                    <span className="inline-flex px-2 py-0.5 text-xs font-bold bg-green-100 text-green-700 rounded-full">
                      PASS
                    </span>
                  ) : (
                    <span className="inline-flex px-2 py-0.5 text-xs font-bold bg-red-100 text-red-700 rounded-full">
                      FAIL
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600 max-w-[250px]">
                  {r.reasons.length > 0 ? r.reasons.join("; ") : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format DPI for display. If H and V are the same, show once; otherwise show both. */
function formatDpi(h?: number, v?: number): string {
  if (h == null && v == null) return "-";
  if (h != null && v != null) {
    return h === v ? `${h}` : `${h} x ${v}`;
  }
  return `${h ?? v}`;
}

// ---------------------------------------------------------------------------
// CSV generation & download
// ---------------------------------------------------------------------------

function downloadCsv(results: ValidationResult[]) {
  const headers = [
    "File",
    "Source",
    "PSD",
    "Width",
    "Height",
    "DPI (H)",
    "DPI (V)",
    "MP",
    "Art Layers",
    "Total Layers",
    "Preferred 16MP",
    "Status",
    "Reasons",
  ];

  const rows = results.map((r) => [
    csvEscape(r.fileName),
    r.source,
    r.isPsd ? "Yes" : "No",
    r.width?.toString() ?? "",
    r.height?.toString() ?? "",
    r.dpiH?.toString() ?? "",
    r.dpiV?.toString() ?? "",
    r.mp?.toString() ?? "",
    r.artLayers?.toString() ?? "",
    r.totalLayers?.toString() ?? "",
    r.preferred16MP ? "Yes" : "No",
    r.pass ? "PASS" : "FAIL",
    csvEscape(r.reasons.join("; ")),
  ]);

  const csv =
    [headers.join(","), ...rows.map((r) => r.join(","))].join("\n") + "\n";

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `psd-qc-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Escape a value for CSV (wrap in quotes if it contains commas or quotes). */
function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
