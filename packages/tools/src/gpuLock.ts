/**
 * Runner-wide FIFO GPU mutex (Task 041).
 * Shared by ComfyUI (image_generate), whisper (video_transcribe, meeting_transcribe),
 * and NVENC encodes (video_edit) so only one GPU-heavy task runs at a time on the PC.
 * Never nest calls to `withGpuLock`.
 */
let tail: Promise<void> = Promise.resolve();

export async function withGpuLock<T>(_label: string, fn: () => Promise<T>): Promise<T> {
  const prev = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}
