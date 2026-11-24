import Log from "sap/base/Log";

/**
 * Loud repeating tone and vibration. Browsers only allow sound after a tap, so call
 * `unlock` from the "Start my shift" press.
 *
 * @namespace oakhaven.waterroute.model
 */
export default class Alarm {
  private audio?: AudioContext;
  private timer?: number;

  public unlock(): void {
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume();
    } catch (error) {
      Log.warning("No sound available", String(error));
    }
  }

  public start(): void {
    this.stop();
    this.beep();
    this.timer = window.setInterval(() => this.beep(), 1500);
  }

  public stop(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    navigator.vibrate?.(0);
  }

  public destroy(): void {
    this.stop();
    void this.audio?.close();
    this.audio = undefined;
  }

  private beep(): void {
    navigator.vibrate?.([400, 150, 400]);
    if (!this.audio) return;
    const now = this.audio.currentTime;
    [880, 660].forEach((frequency, i) => {
      const oscillator = this.audio!.createOscillator();
      const gain = this.audio!.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.25;
      oscillator.connect(gain).connect(this.audio!.destination);
      oscillator.start(now + i * 0.3);
      oscillator.stop(now + i * 0.3 + 0.25);
    });
  }
}
