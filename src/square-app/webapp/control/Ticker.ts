import Control from "sap/ui/core/Control";
import type RenderManager from "sap/ui/core/RenderManager";
import type { MetadataOptions } from "sap/ui/core/Element";

const SECONDS_PER_LETTER = 0.14;

/**
 * All the news in one moving line, written twice so it never runs empty.
 *
 * @namespace oakhaven.square.control
 */
export default class Ticker extends Control {
  static readonly metadata: MetadataOptions = { properties: { text: { type: "string", defaultValue: "" }, label: { type: "string", defaultValue: "" } } };

  static renderer = {
    apiVersion: 2,
    render(rm: RenderManager, ticker: Ticker): void {
      const text = ticker.getProperty("text") as string;
      rm.openStart("div", ticker).class("sqTicker").attr("role", "marquee").attr("aria-label", ticker.getProperty("label") as string).openEnd();
      rm.openStart("div").class("sqTickerLine").style("animation-duration", `${Math.max(20, Math.round(text.length * SECONDS_PER_LETTER))}s`).openEnd();
      rm.openStart("span").openEnd().text(text).close("span");
      rm.openStart("span").attr("aria-hidden", "true").openEnd().text(text).close("span");
      rm.close("div").close("div");
    },
  };
}
