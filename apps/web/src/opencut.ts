import { api } from "./api/http.ts";

/** OpenCut's hosted editor (github.com/opencut-app/opencut): always the latest version, nothing to maintain. */
export const OPENCUT_URL = "https://opencut.app/projects";

/**
 * "Edit fully in OpenCut": OpenCut has no import API yet, so we download the video for the owner
 * and open OpenCut in a new tab; they drag the file in, edit, export, and upload the result back
 * in the Video Studio ("Use my own edit").
 */
export function openInOpenCut(uploadId: string, name: string): void {
  const a = document.createElement("a");
  a.href = api.uploadUrl(uploadId, true);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.open(OPENCUT_URL, "_blank", "noopener");
}
