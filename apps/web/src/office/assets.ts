import { ref, type Ref } from "vue";

/** Office art is served by the hub from MAPS_DIR, so it can be swapped without rebuilding the web app. */
export const OFFICE_ASSETS = "/api/office/assets/";

export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CharacterManifest {
  frames: Record<string, { frame: AtlasRect }>;
  meta: { image: string; size: { w: number; h: number }; outfits: string[]; frameWidth: number; frameHeight: number };
}

const characters = ref<CharacterManifest | null>(null);
let loading: Promise<void> | null = null;

/** The character atlas description, loaded once and shared (null until loaded or when the art is missing). */
export function useCharacterArt(): Ref<CharacterManifest | null> {
  if (!loading) {
    loading = fetch(`${OFFICE_ASSETS}characters.json`, { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<CharacterManifest>) : Promise.reject(new Error(String(r.status)))))
      .then((m) => {
        characters.value = m;
      })
      .catch(() => {
        loading = null; // try again on the next mount (e.g. after logging in)
      });
  }
  return characters;
}
