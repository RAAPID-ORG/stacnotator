/**
 * Specification: import times typed by the user become the exact UTC payload the
 * backend accepts (issue #158). One instant OR one complete interval per file;
 * timezone-aware or date-only input only; date-only means whole UTC days.
 *
 * Contract: `toImportFile(object, time)` from `./importFiles`
 *   object: { path: string; etag: string }
 *   time:   { kind: 'instant'; value: string } | { kind: 'interval'; start: string; end: string }
 *   -> { ok: true; file: ImportFile } | { ok: false; error: string }
 *   ImportFile = { path, etag, datetime } | { path, etag, start_datetime, end_datetime }
 */
import { describe, expect, it } from "vitest";
import { toImportFile } from "./importFiles";

const obj = { path: "flights/a.tif", etag: '"0x1"' };

describe("toImportFile", () => {
  it.each([
    ["2026-01-12T12:20:00+02:00", "2026-01-12T10:20:00Z"],
    ["2026-01-12T10:20:00.250Z", "2026-01-12T10:20:00.250Z"],
    ["2026-01-12", "2026-01-12T00:00:00Z"],
  ])("normalizes instant %s to UTC", (value, datetime) => {
    expect(toImportFile(obj, { kind: "instant", value })).toEqual({
      ok: true,
      file: { ...obj, datetime },
    });
  });

  it("expands a date-only interval to inclusive UTC day bounds", () => {
    expect(
      toImportFile(obj, {
        kind: "interval",
        start: "2026-01-01",
        end: "2026-01-31",
      }),
    ).toEqual({
      ok: true,
      file: {
        ...obj,
        start_datetime: "2026-01-01T00:00:00Z",
        end_datetime: "2026-01-31T23:59:59.999999Z",
      },
    });
  });

  it.each([
    [
      "naive timestamp",
      { kind: "instant" as const, value: "2026-01-12T10:20:00" },
    ],
    ["not a date", { kind: "instant" as const, value: "January" }],
    ["empty instant", { kind: "instant" as const, value: "" }],
    [
      "missing end",
      { kind: "interval" as const, start: "2026-01-01", end: "" },
    ],
    [
      "start after end",
      { kind: "interval" as const, start: "2026-02-01", end: "2026-01-01" },
    ],
  ])("rejects %s with a message", (_name, time) => {
    const result = toImportFile(obj, time);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
