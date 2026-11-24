import Log from "sap/base/Log";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import { speak, stopSpeaking } from "../model/speak";

interface Square { mood: string; sentence: string; news: { kind: string; text: string; good: boolean }[]; isDemo: boolean }

const REFRESH_MS = 20_000;
const CRIER_ITEMS = 3;
const BELL_MS = 1_600;
const ICONS: Readonly<Record<string, string>> = {
  water: "sap-icon://ti/droplet", bakery: "sap-icon://ti/bread", council: "sap-icon://ti/building-bank", library: "sap-icon://ti/search", mystery: "sap-icon://ti/key",
};
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The Oakhaven Square: the public screen. It shows what the service says and nothing else.
 *
 * @namespace oakhaven.square.controller
 */
export default class Main extends Controller {
  private viewModel!: JSONModel;
  private bundle!: ResourceBundle;
  private square?: Square;
  private shown = "";
  private timer?: number;
  private crierTimer?: number;
  private audio?: AudioContext;
  private destroyed = false;

  public onInit(): void {
    this.viewModel = new JSONModel({ now: new Date(), lost: false, mood: "", moodText: "", sentence: "", news: [], ticker: "", isDemo: false });
    this.getView()?.setModel(this.viewModel, "view");
    void this.startUp();
  }

  public onExit(): void {
    this.destroyed = true;
    window.clearInterval(this.timer);
    window.clearTimeout(this.crierTimer);
    stopSpeaking();
    void this.audio?.close();
  }

  private async startUp(): Promise<void> {
    this.bundle = await (this.getOwnerComponent()?.getModel("i18n") as ResourceModel).getResourceBundle();
    await this.refresh();
    if (!this.destroyed) this.timer = window.setInterval(() => void this.refresh(), REFRESH_MS);
  }

  private text(key: string): string {
    return this.bundle.getText(key, undefined) ?? key;
  }

  private async refresh(): Promise<void> {
    try {
      const operation = (this.getOwnerComponent()?.getModel() as ODataModel).bindContext("/square(...)");
      await operation.invoke();
      const answer = String((operation.getBoundContext()?.getObject() as { value?: unknown } | undefined)?.value);
      if (this.destroyed) return;
      this.viewModel.setProperty("/lost", false);
      if (answer !== this.shown) this.show(JSON.parse(answer) as Square);
      this.shown = answer;
    } catch (error) {
      Log.error("Could not read the square", String(error));
      if (!this.destroyed) this.viewModel.setProperty("/lost", true);
    } finally {
      if (!this.destroyed) this.viewModel.setProperty("/now", new Date());
    }
  }

  private show(square: Square): void {
    this.square = square;
    this.viewModel.setProperty("/mood", square.mood);
    this.viewModel.setProperty("/moodText", this.text(`mood${capital(square.mood)}`));
    this.viewModel.setProperty("/sentence", square.sentence);
    this.viewModel.setProperty("/isDemo", square.isDemo);
    this.viewModel.setProperty("/news", square.news.map((item) => ({
      text: item.text, kind: item.kind, kindText: this.text(`kind${capital(item.kind)}`), icon: ICONS[item.kind], ribbon: item.good ? this.text("good") : "",
    })));
    this.viewModel.setProperty("/ticker", square.news.map((item) => `${item.text}   ✦   `).join(""));
  }

  /** The town crier: a bell, then the weather and the first news out loud. */
  public onBell(): void {
    if (!this.square) return;
    stopSpeaking();
    this.ring();
    const news = this.square.news.slice(0, CRIER_ITEMS).map((item) => item.text).join(" ");
    const text = this.bundle.getText("crier", [this.square.sentence, news]) ?? "";
    window.clearTimeout(this.crierTimer);
    this.crierTimer = window.setTimeout(() => void speak(text), BELL_MS);
  }

  /** A bell from a few fading tones, no sound file. */
  private ring(): void {
    try {
      this.audio ??= new AudioContext();
      const audio = this.audio;
      void audio.resume();
      for (const strike of [0, 0.7]) {
        [523, 1046, 1410, 2093].forEach((frequency, index) => {
          const start = audio.currentTime + strike;
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0.2 / (index + 1), start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 1.6 - index * 0.25);
          oscillator.connect(gain).connect(audio.destination);
          oscillator.start(start);
          oscillator.stop(start + 1.7);
        });
      }
    } catch (error) {
      Log.warning("No sound available", String(error));
    }
  }
}
