import Log from "sap/base/Log";

export type Command =
  | { readonly name: "done" | "cantToday"; readonly detail: string }
  | { readonly name: "next" | "repeat" | "ok" };

/** The part of the (prefixed, untyped) speech recognition API this module uses. */
interface Recognition {
  continuous: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  abort(): void;
}

/** Turns what was heard into one of the few commands; anything else is ignored. */
export function parseCommand(heard: string): Command | undefined {
  const text = heard.toLowerCase().replace(/[’]/g, "'").trim();
  const done = /^done\b[\s,.]*(.*)$/.exec(text);
  if (done) return { name: "done", detail: done[1] };
  const cannot = /^(?:can't|cannot|cant) today\b[\s,.]*(.*)$/.exec(text);
  if (cannot) return { name: "cantToday", detail: cannot[1] };
  if (/^next\b/.test(text)) return { name: "next" };
  if (/^repeat\b/.test(text)) return { name: "repeat" };
  if (/^(ok|okay)\b/.test(text)) return { name: "ok" };
  return undefined;
}

/** Best voices first: downloaded high-quality ones, then Chrome's, then Apple's standard one. */
const PREFERRED_VOICES = [/premium/i, /enhanced/i, /natural/i, /^Google US English/i, /^Samantha/i];

function bestVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((voice) => /^en[-_]/i.test(voice.lang));
  for (const pattern of PREFERRED_VOICES) {
    const match = voices.find((voice) => pattern.test(voice.name));
    if (match) return match;
  }
  return voices.find((voice) => voice.default); // else the browser picks: macOS also lists joke voices
}

/**
 * Speaks, and listens for commands where the browser can. Never listens while it speaks,
 * so it cannot hear itself.
 *
 * @namespace oakhaven.waterroute.model
 */
export default class Speech {
  private recognition?: Recognition;
  private enabled = false;
  private speaking = 0;
  private retry?: number;

  constructor(private readonly onCommand: (command: Command) => void, private readonly onBlocked: () => void) {}

  public start(): void {
    this.enabled = true;
    window.speechSynthesis?.getVoices(); // the list loads in the background
    const scope = window as unknown as Record<string, (new () => Recognition) | undefined>;
    const Api = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
    if (!Api || this.recognition) return;
    const recognition = new Api();
    recognition.continuous = true;
    recognition.lang = "en-US";
    recognition.onresult = (event): void => {
      const command = parseCommand(event.results[event.resultIndex][0].transcript);
      if (command && this.enabled && this.speaking === 0) this.onCommand(command);
    };
    recognition.onerror = (event): void => {
      if (event.error !== "not-allowed" && event.error !== "service-not-allowed") return;
      this.recognition = undefined;
      this.onBlocked();
    };
    recognition.onend = (): void => {
      window.clearTimeout(this.retry);
      this.retry = window.setTimeout(() => this.listen(), 400);
    };
    this.recognition = recognition;
    this.listen();
  }

  public stop(): void {
    this.enabled = false;
    window.clearTimeout(this.retry);
    this.recognition?.abort();
    this.recognition = undefined;
    window.speechSynthesis?.cancel();
    this.speaking = 0;
  }

  /** Says `text`, replacing whatever was being said. */
  public say(text: string): void {
    if (!this.enabled || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    this.recognition?.abort();
    const turn = ++this.utterance;
    this.speaking = turn;
    const finished = (): void => {
      if (this.speaking !== turn) return;
      this.speaking = 0;
      this.listen();
    };
    // One utterance per sentence: gives natural pauses, and Chrome cuts off long ones.
    const sentences = text.trim().split(/(?<=[.!?])\s+/);
    const voice = bestVoice();
    sentences.forEach((sentence, index) => {
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.lang = voice?.lang ?? "en-US";
      utterance.voice = voice ?? null;
      utterance.rate = 0.95;
      if (index === sentences.length - 1) {
        utterance.onend = finished;
        utterance.onerror = finished;
      }
      window.speechSynthesis.speak(utterance);
    });
  }

  private utterance = 0;

  private listen(): void {
    if (!this.enabled || this.speaking !== 0 || !this.recognition) return;
    try {
      this.recognition.start();
    } catch (error) {
      Log.debug("Already listening", String(error));
    }
  }
}
