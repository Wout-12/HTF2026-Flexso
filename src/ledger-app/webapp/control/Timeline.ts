import Control from "sap/ui/core/Control";
import type RenderManager from "sap/ui/core/RenderManager";
import type { MetadataOptions } from "sap/ui/core/Element";

export interface Dot { readonly at: string; readonly kind: "sure" | "ask" | "other" | "inner"; readonly label: string; readonly finding: string }

const WIDTH = 1200;
const HEIGHT = 150;
const EDGE = 46;
const BASE = 112;
const RADIUS = { sure: 8, ask: 5.5, other: 3.5, inner: 6 } as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Everything the records show as written, drawn once: no animation, for an old laptop. Dots of the
 * same day are stacked. Dates before the year are drawn at the left edge.
 *
 * @namespace oakhaven.ledger.control
 */
export default class Timeline extends Control {
  static readonly metadata: MetadataOptions = {
    properties: { dots: { type: "object[]", defaultValue: [] }, label: { type: "string", defaultValue: "" }, selected: { type: "string", defaultValue: "" } },
    events: { select: { parameters: { finding: { type: "string" } } } },
  };

  // UI5 calls these for clicks and for Enter / Space.
  public onclick(event: Event): void {
    const finding = event.target instanceof Element ? event.target.closest("[data-finding]")?.getAttribute("data-finding") : null;
    if (finding) this.fireEvent("select", { finding });
  }

  public onsapselect(event: Event): void {
    this.onclick(event);
  }

  static renderer = {
    apiVersion: 2,
    render(rm: RenderManager, control: Timeline): void {
      const dots = [...(control.getProperty("dots") as Dot[])].sort((a, b) => a.at.localeCompare(b.at));
      const year = new Date([...dots].reverse().find((dot) => dot.kind !== "inner")?.at ?? "2026-01-01").getUTCFullYear();
      const [start, end] = [Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)];
      const toX = (at: string): number => {
        const share = (Date.parse(at) - start) / (end - start);
        return share < 0 ? EDGE / 2 : EDGE + Math.min(1, share) * (WIDTH - EDGE - 20);
      };
      rm.openStart("div", control).class("lgTimeline").openEnd();
      rm.openStart("svg").attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`).attr("role", "group").attr("aria-label", control.getProperty("label") as string).openEnd();
      const line = (x1: number, y1: number, x2: number, y2: number): void => {
        rm.openStart("line").attr("x1", x1).attr("y1", y1).attr("x2", x2).attr("y2", y2).class("lgAxis").openEnd().close("line");
      };
      const text = (x: number, content: string): void => {
        rm.openStart("text").attr("x", x).attr("y", HEIGHT - 12).class("lgMonth").openEnd().text(content).close("text");
      };
      line(EDGE, BASE + 10, WIDTH - 10, BASE + 10);
      MONTHS.forEach((name, index) => {
        const x = toX(new Date(Date.UTC(year, index, 1)).toISOString());
        line(x, BASE + 6, x, BASE + 14);
        text(x + 4, name);
      });
      if (dots.some((dot) => Date.parse(dot.at) < start)) text(2, "Before");
      const stacks = new Map<string, number>();
      for (const dot of dots) {
        const r = RADIUS[dot.kind];
        const x = toX(dot.at);
        const column = String(Math.round(x / 8));
        const height = stacks.get(column) ?? 0;
        stacks.set(column, height + r * 2 + 1);
        rm.openStart("circle").attr("cx", x).attr("cy", Math.max(r + 2, BASE - height - r)).attr("r", r).class("lgDot").class(`lgDot-${dot.kind}`);
        if (dot.finding) {
          rm.attr("data-finding", dot.finding).attr("tabindex", "0").attr("role", "button").attr("aria-label", dot.label);
          if (dot.finding === control.getProperty("selected")) rm.class("lgDotSelected");
        }
        rm.openEnd();
        rm.openStart("title").openEnd().text(dot.label).close("title");
        rm.close("circle");
      }
      rm.close("svg").close("div");
    },
  };
}
