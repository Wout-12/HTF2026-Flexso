import Control from "sap/ui/core/Control";
import type RenderManager from "sap/ui/core/RenderManager";

const STARS = 60;
const LANTERNS = 22;

/**
 * The evening behind the fair: stars, and a string of lanterns. Decoration only.
 *
 * @namespace oakhaven.square.control
 */
export default class Sky extends Control {
  static renderer = {
    apiVersion: 2,
    render(rm: RenderManager, control: Sky): void {
      rm.openStart("div", control).class("sqSky").attr("aria-hidden", "true").openEnd();
      // Spread out evenly but not in a grid, and the same every time.
      for (let i = 0; i < STARS; i++) {
        rm.openStart("i").class("sqStar").style("left", `${(i * 61.8) % 100}%`).style("top", `${(i * 37.3) % 70}%`).style("animation-delay", `${(i * 0.7) % 5}s`).openEnd().close("i");
      }
      rm.openStart("div").class("sqString").openEnd();
      for (let i = 0; i < LANTERNS; i++) {
        rm.openStart("i").class("sqLantern").style("animation-delay", `${(i * 0.83) % 3}s`).style("margin-top", `${Math.round(Math.sin((i / (LANTERNS - 1)) * Math.PI * 3) ** 2 * 14)}px`).openEnd().close("i");
      }
      rm.close("div").close("div");
    },
  };
}
