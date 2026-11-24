import Control from "sap/ui/core/Control";
import type RenderManager from "sap/ui/core/RenderManager";
import type { MetadataOptions } from "sap/ui/core/Element";
import { DRAWINGS } from "./drawings";

export interface MapPipe {
  readonly id: string;
  /** Read out loud by a screen reader, e.g. "North Branch 02, ALARM". */
  readonly label: string;
  readonly mapPath: string;
  readonly tier: string;
  readonly flow: number;
  readonly slot: number | null;
}

export interface MapPlace {
  readonly name: string;
  readonly gridCell: string;
  readonly kind: string;
  /** Somebody waits for water here: its name is always shown, the others only on a big screen. */
  readonly served: boolean;
  /** The pipe that brings water here, or empty; tapping the place selects it. */
  readonly pipeId: string;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const IMAGE = { width: 2048, height: 1536 };
const GRID = { x: 150, y: 120, width: 1750, height: 1280 };
const MAX_FLOW = 150; // L/min: the widest line
const TOUCH_WIDTH = 170; // image pixels around a pipe that react: wet gloves are not precise

/** Grid units (README, "The village map") to image pixels; y counts from the south. */
function toPixel(x: number, y: number): Point {
  return { x: GRID.x + (x * GRID.width) / 8, y: GRID.y + ((8 - y) * GRID.height) / 8 };
}

function toPoints(mapPath: string): Point[] {
  return mapPath.split(" ").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return toPixel(x, y);
  });
}

/** The point at `fraction` of a route's length. */
function pointAt(points: readonly Point[], fraction: number): Point {
  const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i].x, point.y - points[i].y));
  let rest = lengths.reduce((sum, length) => sum + length, 0) * fraction;
  for (let i = 0; i < lengths.length; i++) {
    if (rest <= lengths[i]) {
      const share = lengths[i] === 0 ? 0 : rest / lengths[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * share,
        y: points[i].y + (points[i + 1].y - points[i].y) * share,
      };
    }
    rest -= lengths[i];
  }
  return points[points.length - 1];
}

const toPath = (points: readonly Point[]): string => `M${points.map((p) => `${p.x},${p.y}`).join(" L")}`;

/**
 * The painted village map with the pipes on top: colour and line style = tier, width = flow,
 * dots run through healthy pipes and stand still in sick ones, numbered pins = today's jobs.
 * Tap a pipe, pin or place to select its pipe; tap next to them to select nothing.
 *
 * @namespace oakhaven.waterroute.control
 */
export default class VillageMap extends Control {
  static readonly metadata: MetadataOptions = {
    properties: {
      src: { type: "sap.ui.core.URI", defaultValue: "" },
      label: { type: "string", defaultValue: "" },
      pipes: { type: "object[]", defaultValue: [] },
      places: { type: "object[]", defaultValue: [] },
      selected: { type: "string", defaultValue: "" },
      /** IDs of the pipes the water takes to get there; the others fade. */
      highlighted: { type: "string[]", defaultValue: [] },
    },
    events: { select: { parameters: { id: { type: "string" } } } },
  };

  // UI5 calls these for clicks and for Enter / Space.
  public onclick(event: Event): void {
    this.choose(event);
  }

  public onsapselect(event: Event): void {
    event.preventDefault();
    this.choose(event);
  }

  private choose(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest("[data-pipe]") : null;
    const id = target?.getAttribute("data-pipe") ?? "";
    this.fireEvent("select", { id: id === this.getProperty("selected") ? "" : id });
  }

  static renderer = {
    apiVersion: 2,
    render(rm: RenderManager, control: VillageMap): void {
      const pipes = control.getProperty("pipes") as MapPipe[];
      const places = control.getProperty("places") as MapPlace[];
      const selected = control.getProperty("selected") as string;
      const highlighted = control.getProperty("highlighted") as string[];
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const circle = (point: Point, r: number, css: string): void => {
        rm.openStart("circle").attr("cx", point.x).attr("cy", point.y).attr("r", r).class(css).openEnd().close("circle");
      };
      const path = (d: string, css: readonly string[], width?: number): void => {
        rm.openStart("path").attr("d", d);
        css.forEach((name) => rm.class(name));
        if (width !== undefined) rm.attr("stroke-width", width);
        rm.openEnd().close("path");
      };
      const label = (point: Point, text: string, css: string): void => {
        rm.openStart("text").attr("x", point.x).attr("y", point.y).class(css).openEnd().text(text).close("text");
      };
      const animate = (tag: string, attributes: Readonly<Record<string, string>>): void => {
        rm.openStart(tag);
        Object.entries(attributes).forEach(([name, value]) => rm.attr(name, value));
        rm.openEnd().close(tag);
      };

      rm.openStart("div", control).class("wrMap").openEnd();
      rm.openStart("svg")
        .attr("viewBox", `0 0 ${IMAGE.width} ${IMAGE.height}`)
        .attr("role", "group")
        .attr("aria-label", control.getProperty("label") as string)
        .openEnd();
      rm.openStart("image")
        .attr("href", control.getProperty("src") as string)
        .attr("width", IMAGE.width)
        .attr("height", IMAGE.height)
        .openEnd()
        .close("image");

      for (const pipe of pipes) {
        const points = toPoints(pipe.mapPath);
        const d = toPath(points);
        const width = 16 + (Math.min(pipe.flow, MAX_FLOW) / MAX_FLOW) * 26;
        rm.openStart("g").class("wrPipeGroup").attr("data-pipe", pipe.id).attr("role", "button").attr("tabindex", "0")
          .attr("aria-label", pipe.label).attr("aria-pressed", String(pipe.id === selected));
        if (selected && !highlighted.includes(pipe.id)) rm.class("wrFaded");
        if (pipe.id === selected) rm.class("wrSelected");
        rm.openEnd();
        path(d, ["wrGlow"], width + 40);
        path(d, ["wrPipeCasing"], width + 14);
        path(d, ["wrPipe", `wrPipe-${pipe.tier}`], width);
        for (const fraction of [0.2, 0.5, 0.8]) {
          if (pipe.tier === "ok" && !still) {
            rm.openStart("circle").attr("r", 9).class("wrDot").openEnd();
            animate("animateMotion", { path: d, dur: "3s", begin: `-${fraction * 3}s`, repeatCount: "indefinite" });
            rm.close("circle");
          } else {
            circle(pointAt(points, fraction), 9, "wrDot");
          }
        }
        path(d, ["wrTouch"], TOUCH_WIDTH);
        rm.close("g");
      }

      const jobs = pipes.filter((pipe) => pipe.slot !== null).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
      const stops = jobs.map((pipe) => ({ slot: pipe.slot, id: pipe.id, at: pointAt(toPoints(pipe.mapPath), 0.5) }));
      if (stops.length > 1) path(toPath(stops.map((stop) => stop.at)), ["wrWalk"]);

      // Drawn around 0,0 inside a group, so the stylesheet can scale it per screen size.
      const marker = (at: Point, id: string, draw: () => void): void => {
        rm.openStart("g").class("wrTap").attr("data-pipe", id).attr("transform", `translate(${at.x} ${at.y})`).openEnd();
        rm.openStart("g").class("wrMarker").openEnd();
        draw();
        rm.close("g").close("g");
      };
      const centre: Point = { x: 0, y: 0 };
      const named = new Set<string>();
      const placeAt = (place: MapPlace): Point => toPixel(place.gridCell.charCodeAt(0) - 64.5, Number(place.gridCell[1]) - 0.5);
      for (const place of places) {
        const at = placeAt(place);
        rm.openStart("g").class("wrTap").class("wrArt").attr("data-pipe", place.pipeId).attr("transform", `translate(${at.x} ${at.y})`).openEnd();
        rm.openStart("title").openEnd().text(place.name).close("title");
        for (const { d, css } of DRAWINGS[place.kind] ?? []) path(d, [css]);
        rm.close("g");
      }
      for (const place of places) {
        if (named.has(place.name)) continue; // the forest spans several cells
        named.add(place.name);
        const at = placeAt(place);
        const x = Math.min(Math.max(at.x, 230), IMAGE.width - 230);
        marker({ x, y: at.y + 80 }, place.pipeId, () => label({ x: 0, y: 66 }, place.name, place.served ? "wrPlace" : "wrPlaceMinor"));
      }
      for (const pipe of pipes.filter((item) => item.slot === null && item.tier !== "ok")) {
        marker(pointAt(toPoints(pipe.mapPath), 0.5), pipe.id, () => {
          circle(centre, 46, "wrMark");
          label(centre, pipe.tier === "unknown" ? "?" : "!", "wrMarkText");
        });
      }
      for (const stop of stops) {
        marker(stop.at, stop.id, () => {
          if (!still) {
            rm.openStart("circle").attr("r", 74).class("wrPulse").openEnd();
            animate("animate", { attributeName: "r", values: "74;130", dur: "1.8s", repeatCount: "indefinite" });
            animate("animate", { attributeName: "opacity", values: "1;0", dur: "1.8s", repeatCount: "indefinite" });
            rm.close("circle");
          }
          circle(centre, 74, "wrPin");
          label(centre, String(stop.slot), "wrPinText");
        });
      }
      rm.close("svg").close("div");
    },
  };
}
