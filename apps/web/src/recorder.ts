/**
 * Browser meeting audio recording with MediaRecorder and Screen Wake Lock.
 * Designed for phone & desktop meeting recordings to be transcribed by Notulis.
 */

export interface ActiveRecording {
  stop(): Promise<File>;
  cancel(): void;
  elapsed(): number;
}

export const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

/** Check if the browser environment supports audio recording via getUserMedia and MediaRecorder. */
export function canRecord(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

/** Pick the first MIME type supported by MediaRecorder among the preferred candidates. */
export function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "audio/webm;codecs=opus";
  }
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

/**
 * Format a duration in seconds into M:SS or H:MM:SS.
 * Examples: 5 -> "0:05", 750 -> "12:30", 3725 -> "1:02:05".
 */
export function fmtDuration(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const sStr = String(s).padStart(2, "0");
  if (h > 0) {
    const mStr = String(m).padStart(2, "0");
    return `${h}:${mStr}:${sStr}`;
  }
  return `${m}:${sStr}`;
}

/**
 * Generate a filename for a meeting recording based on date and mime type:
 * rakaman-YYYYMMDD-HHmm.<ext> (weba for webm, m4a for mp4, ogg for ogg).
 */
export function recordingName(date: Date, mime: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  let ext = "weba";
  const lower = mime.toLowerCase();
  if (lower.includes("webm")) {
    ext = "weba";
  } else if (lower.includes("mp4") || lower.includes("m4a")) {
    ext = "m4a";
  } else if (lower.includes("ogg") || lower.includes("opus")) {
    ext = "ogg";
  }

  return `rakaman-${y}${m}${d}-${h}${min}.${ext}`;
}

/**
 * Start recording audio using MediaRecorder on getUserMedia.
 * Requests a screen wake lock while recording, releasing on stop/cancel.
 */
export async function startRecording(): Promise<ActiveRecording> {
  if (!canRecord()) {
    throw new Error("Pelayar ini tidak menyokong rakaman audio.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    },
  });

  const mimeType = pickSupportedMimeType();
  const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
  const recorder = new MediaRecorder(stream, options);
  const actualMime = recorder.mimeType || mimeType || "audio/webm";

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  let wakeLock: any = null;
  let isDone = false;

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && typeof (navigator as any).wakeLock?.request === "function") {
        wakeLock = await (navigator as any).wakeLock.request("screen");
      }
    } catch {
      wakeLock = null;
    }
  }

  async function releaseWakeLock() {
    try {
      if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {
      wakeLock = null;
    }
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible" && !isDone) {
      void requestWakeLock();
    }
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  void requestWakeLock();

  const startTime = Date.now();
  recorder.start(10_000);

  function cleanup() {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    void releaseWakeLock();
    stream.getTracks().forEach((track) => track.stop());
  }

  return {
    elapsed(): number {
      return Math.floor((Date.now() - startTime) / 1000);
    },
    cancel(): void {
      if (isDone) return;
      isDone = true;
      cleanup();
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      chunks.length = 0;
    },
    stop(): Promise<File> {
      if (isDone) throw new Error("Rakaman telah ditamatkan.");
      isDone = true;
      cleanup();

      return new Promise<File>((resolve, reject) => {
        recorder.onstop = () => {
          try {
            const blob = new Blob(chunks, { type: actualMime });
            const name = recordingName(new Date(startTime), actualMime);
            const file = new File([blob], name, { type: actualMime, lastModified: Date.now() });
            resolve(file);
          } catch (err) {
            reject(err);
          }
        };
        recorder.onerror = (e) => reject(e);

        if (recorder.state !== "inactive") {
          recorder.stop();
        } else {
          const blob = new Blob(chunks, { type: actualMime });
          const name = recordingName(new Date(startTime), actualMime);
          resolve(new File([blob], name, { type: actualMime, lastModified: Date.now() }));
        }
      });
    },
  };
}
