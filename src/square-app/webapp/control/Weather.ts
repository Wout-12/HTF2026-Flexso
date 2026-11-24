import Control from "sap/ui/core/Control";
import type RenderManager from "sap/ui/core/RenderManager";
import type { MetadataOptions } from "sap/ui/core/Element";

const CLOUD = "M60,190 a46,46 0 0 1 8,-91 a70,70 0 0 1 132,-22 a56,56 0 0 1 84,50 a36,36 0 0 1 -6,63 Z";

/**
 * The sky of one day as a drawing. It is also written next to it.
 *
 * @namespace oakhaven.square.control
 */
export default class Weather extends Control {
  static readonly metadata: MetadataOptions = { properties: { sky: { type: "string", defaultValue: "" }, label: { type: "string", defaultValue: "" } } };

  static renderer = {
    apiVersion: 2,
    render(rm: RenderManager, control: Weather): void {
      const sky = control.getProperty("sky") as string;
      const path = (d: string, css: string): void => { rm.openStart("path").attr("d", d).class(css).openEnd().close("path"); };
      const sun = (x: number, y: number, r: number): void => {
        rm.openStart("g").attr("transform", `translate(${x} ${y})`).openEnd();
        rm.openStart("g").class("sqRays").openEnd();
        for (let i = 0; i < 12; i++) {
          const at = (length: number, turn: number): string => `${Math.cos((i / 12) * Math.PI * 2 + turn) * length},${Math.sin((i / 12) * Math.PI * 2 + turn) * length}`;
          path(`M${at(r * 1.15, -0.12)} L${at(r * 1.6, 0)} L${at(r * 1.15, 0.12)} Z`, "sqRay");
        }
        rm.close("g");
        rm.openStart("circle").attr("r", r).class("sqSun").openEnd().close("circle");
        rm.close("g");
      };
      rm.openStart("div", control).class("sqWeather").class(`sqMood-${sky}`).openEnd();
      rm.openStart("svg").attr("viewBox", "0 0 340 300").attr("role", "img").attr("aria-label", control.getProperty("label") as string).openEnd();
      if (sky === "sunny") sun(170, 150, 78);
      if (sky === "cloudy") sun(230, 92, 46);
      if (sky === "storm") path("M180,178 L132,248 L166,248 L146,298 L212,226 L176,226 L204,178 Z", "sqBolt");
      if (sky === "rain" || sky === "storm") {
        for (let i = 0; i < 9; i++) {
          rm.openStart("line").attr("x1", 70 + i * 25).attr("x2", 60 + i * 25).attr("y1", 204).attr("y2", 234).class("sqDrop").style("animation-delay", `${(i * 0.37) % 1.1}s`).openEnd().close("line");
        }
      }
      if (sky !== "sunny" && sky !== "") {
        rm.openStart("g").class("sqDrift").openEnd();
        path(CLOUD, "sqCloud");
        rm.close("g");
      }
      rm.close("svg").close("div");
    },
  };
}
