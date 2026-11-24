import Control from "sap/ui/core/Control";
import type RenderManager from "sap/ui/core/RenderManager";
import type { MetadataOptions } from "sap/ui/core/Element";

export interface BudgetPart { readonly kind: string; readonly label: string; readonly crowns: number }

/**
 * Where the week's crowns would go, next to what there is. Every part is also named in text.
 *
 * @namespace oakhaven.council.control
 */
export default class BudgetBar extends Control {
  static readonly metadata: MetadataOptions = {
    properties: { parts: { type: "object[]", defaultValue: [] }, weekly: { type: "int", defaultValue: 0 }, weeklyText: { type: "string", defaultValue: "" } },
  };

  static renderer = {
    apiVersion: 2,
    render(rm: RenderManager, bar: BudgetBar): void {
      const parts = (bar.getProperty("parts") as BudgetPart[]).filter((part) => part.crowns > 0);
      const weekly = bar.getProperty("weekly") as number;
      const full = Math.max(weekly, parts.reduce((sum, part) => sum + part.crowns, 0), 1);
      const percent = (crowns: number): string => `${(crowns / full) * 100}%`;
      rm.openStart("div", bar).class("csBudget").openEnd();
      rm.openStart("div").class("csBar").attr("aria-hidden", "true").openEnd();
      for (const part of parts) {
        rm.openStart("span").class("csPart").class(`csPart-${part.kind}`).style("width", percent(part.crowns)).openEnd().text(String(part.crowns)).close("span");
      }
      rm.openStart("span").class("csLimit").style("left", percent(weekly)).openEnd().close("span");
      rm.close("div");
      rm.openStart("div").class("csLegend").openEnd();
      for (const part of parts) {
        rm.openStart("span").openEnd();
        rm.openStart("span").class("csDot").class(`csPart-${part.kind}`).openEnd().close("span");
        rm.text(`${part.label} ${part.crowns}`).close("span");
      }
      rm.openStart("span").class("csLegendLimit").openEnd().text(bar.getProperty("weeklyText") as string).close("span");
      rm.close("div").close("div");
    },
  };
}
