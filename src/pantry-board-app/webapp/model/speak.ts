/** Best voices first: downloaded high-quality ones, then Chrome's, then Apple's standard one. */
const PREFERRED_VOICES = [/premium/i, /enhanced/i, /natural/i, /^Google US English/i, /^Samantha/i];

/** Reads a text aloud, one utterance per sentence. Does nothing where the browser cannot speak. */
export function speak(text: string): void {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const voices = window.speechSynthesis.getVoices().filter((voice) => /^en[-_]/i.test(voice.lang));
  const voice = PREFERRED_VOICES.map((pattern) => voices.find((item) => pattern.test(item.name))).find((item) => item !== undefined)
    ?? voices.find((item) => item.default);
  for (const sentence of text.trim().split(/(?<=[.!?])\s+/)) {
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.lang = voice?.lang ?? "en-US";
    utterance.voice = voice ?? null;
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel();
}
