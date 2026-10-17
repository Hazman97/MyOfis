/**
 * Browser speech: dictation (speech-to-text) and read-aloud (text-to-speech).
 * Dictation uses the browser's own service: Chrome and Edge send the audio to
 * their speech servers, Firefox has none. Read-aloud uses the voices installed
 * on the device.
 */
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

const ctor = (): RecognitionCtor | null => {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const canDictate = () => ctor() !== null;
export const canSpeak = () => typeof speechSynthesis !== "undefined";

export interface Dictation {
  stop(): void;
}

/** Listen until stopped. `onText(final, interim)` gets the finished words and the words still being heard. */
export function dictate(lang: string, onText: (finalText: string, interim: string) => void, onEnd: (error?: string) => void): Dictation | null {
  const Ctor = ctor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let stopped = false;
  rec.onresult = (e) => {
    let finalText = "";
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onText(finalText, interim);
  };
  rec.onerror = (e) => {
    stopped = true;
    onEnd(e.error === "not-allowed" ? "Microphone blocked: allow it in the browser's site settings." : e.error === "no-speech" ? undefined : `Dictation stopped (${e.error}).`);
  };
  rec.onend = () => {
    if (!stopped) onEnd();
  };
  rec.start();
  return {
    stop() {
      stopped = true;
      rec.stop();
      onEnd();
    },
  };
}

/** Read text aloud. Returns false when the browser cannot. */
export function speak(text: string, lang: string, onEnd?: () => void): boolean {
  if (!canSpeak()) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>]/g, "").slice(0, 3000));
  u.lang = lang;
  const voice = speechSynthesis.getVoices().find((v) => v.lang === lang) ?? speechSynthesis.getVoices().find((v) => v.lang.startsWith(lang.slice(0, 2)));
  if (voice) u.voice = voice;
  u.rate = 0.95;
  u.onend = () => onEnd?.();
  speechSynthesis.speak(u);
  return true;
}

export const stopSpeaking = () => canSpeak() && speechSynthesis.cancel();
