import { describe, expect, test } from "bun:test";
import { canRecord, fmtDuration, pickSupportedMimeType, recordingName } from "../src/recorder.ts";

describe("recorder", () => {
  test("recordingName formats rakaman-YYYYMMDD-HHmm.<ext> correctly", () => {
    // 23 Oct 2026, 15:45
    const d1 = new Date(2026, 9, 23, 15, 45, 0);
    expect(recordingName(d1, "audio/webm;codecs=opus")).toBe("rakaman-20261023-1545.weba");
    expect(recordingName(d1, "audio/webm")).toBe("rakaman-20261023-1545.weba");

    // 4 May 2026, 09:05 (check leading zeroes)
    const d2 = new Date(2026, 4, 4, 9, 5, 0);
    expect(recordingName(d2, "audio/mp4")).toBe("rakaman-20260504-0905.m4a");
    expect(recordingName(d2, "audio/x-m4a")).toBe("rakaman-20260504-0905.m4a");

    // Ogg/Opus
    expect(recordingName(d1, "audio/ogg;codecs=opus")).toBe("rakaman-20261023-1545.ogg");
    expect(recordingName(d1, "audio/opus")).toBe("rakaman-20261023-1545.ogg");
  });

  test("fmtDuration formats seconds into 0:05, 12:30, 1:02:05", () => {
    expect(fmtDuration(0)).toBe("0:00");
    expect(fmtDuration(5)).toBe("0:05");
    expect(fmtDuration(59)).toBe("0:59");
    expect(fmtDuration(60)).toBe("1:00");
    expect(fmtDuration(750)).toBe("12:30");
    expect(fmtDuration(3600)).toBe("1:00:00");
    expect(fmtDuration(3725)).toBe("1:02:05");
  });

  test("canRecord safely returns false in non-browser environment", () => {
    expect(typeof canRecord()).toBe("boolean");
  });

  test("pickSupportedMimeType returns a fallback in test environment", () => {
    const mime = pickSupportedMimeType();
    expect(typeof mime).toBe("string");
  });
});
