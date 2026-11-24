/** Best voices first: downloaded high-quality ones, then Chrome's, then Apple's standard one. */
const PREFERRED_VOICES = [/premium/i, /enhanced/i, /natural/i, /^Google US English/i, /^Samantha/i];

const englishVoices = (): SpeechSynthesisVoice[] => window.speechSynthesis.getVoices().filter((voice) => /^en[-_]/i.test(voice.lang));

function preferredVoice(): SpeechSynthesisVoice | undefined {
  const voices = englishVoices();
  return PREFERRED_VOICES.map((pattern) => voices.find((item) => pattern.test(item.name))).find((item) => item !== undefined);
}

const VOICES_WAIT_MS = 1500;
let voicesWait: Promise<void> | undefined;

/** The browser loads its voices in the background; speaking earlier gives its worst voice. */
function voicesReady(): Promise<void> {
  voicesWait ??= new Promise((resolve) => {
    const giveUp = window.setTimeout(resolve, VOICES_WAIT_MS);
    const check = (): void => {
      if (!preferredVoice()) return;
      window.clearTimeout(giveUp);
      window.speechSynthesis.removeEventListener("voiceschanged", check);
      resolve();
    };
    window.speechSynthesis.addEventListener("voiceschanged", check);
    check();
  });
  return voicesWait;
}

if ("speechSynthesis" in window) void voicesReady(); // start loading with the page

let latest = 0;

/** Reads a text aloud, one utterance per sentence. Does nothing where the browser cannot speak. */
export async function speak(text: string): Promise<void> {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const turn = ++latest;
  await voicesReady();
  if (turn !== latest) return;
  const voice = preferredVoice() ?? englishVoices().find((item) => item.default);
  for (const sentence of text.trim().split(/(?<=[.!?])\s+/)) {
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.lang = voice?.lang ?? "en-US";
    utterance.voice = voice ?? null;
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }
}

export function stopSpeaking(): void {
  latest++;
  window.speechSynthesis?.cancel();
}
