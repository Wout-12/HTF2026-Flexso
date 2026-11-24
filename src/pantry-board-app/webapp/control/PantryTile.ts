import Control from "sap/ui/core/Control";
import type RenderManager from "sap/ui/core/RenderManager";
import type { MetadataOptions } from "sap/ui/core/Element";

/**
 * One product on the board: the whole tile is a button, for floury fingers.
 *
 * @namespace oakhaven.pantry.control
 */
export default class PantryTile extends Control {
  static readonly metadata: MetadataOptions = {
    properties: {
      icon: { type: "sap.ui.core.URI", defaultValue: "" },
      title: { type: "string", defaultValue: "" },
      risk: { type: "string", defaultValue: "ok" },
      riskText: { type: "string", defaultValue: "" },
      riskIcon: { type: "sap.ui.core.URI", defaultValue: "" },
      number: { type: "string", defaultValue: "" },
      unit: { type: "string", defaultValue: "" },
      action: { type: "string", defaultValue: "" },
      detail: { type: "string", defaultValue: "" },
      order: { type: "string", defaultValue: "" },
      market: { type: "string", defaultValue: "" },
      age: { type: "string", defaultValue: "" },
    },
    events: { press: {} },
  };

  // Not attachBrowserEvent: UI5 would copy that handler when it clones the list template.
  public onAfterRendering(): void {
    const button = this.getDomRef() as HTMLElement | null;
    if (button) button.onclick = (): void => { this.fireEvent("press"); };
  }

  static renderer = {
    apiVersion: 2,
    render(rm: RenderManager, tile: PantryTile): void {
      const get = (name: string): string => tile.getProperty(name) as string;
      const line = (text: string, css: string): void => {
        if (text) rm.openStart("span").class(css).openEnd().text(text).close("span");
      };
      rm.openStart("button", tile).attr("type", "button").class("pbTile").class(`pbTile-${get("risk")}`).openEnd();
      rm.openStart("span").class("pbTileHead").openEnd();
      rm.icon(get("icon"), ["pbTileIcon"], { id: `${tile.getId()}-icon`, title: null });
      line(get("title"), "pbTileTitle");
      if (get("market")) rm.icon("sap-icon://ti/building-store", ["pbTileMarket"], { id: `${tile.getId()}-market`, title: get("market") });
      rm.close("span");
      rm.openStart("span").class("pbTileRisk").openEnd();
      rm.icon(get("riskIcon"), [], { id: `${tile.getId()}-risk`, title: null });
      rm.openStart("span").openEnd().text(get("riskText")).close("span");
      rm.close("span");
      rm.openStart("span").class("pbTileNumber").openEnd();
      line(get("number"), "pbTileDays");
      line(get("unit"), "pbTileUnit");
      rm.close("span");
      line(get("action"), "pbTileAction");
      line(get("detail"), "pbTileDetail");
      line(get("order"), "pbTileOrder");
      line(get("age"), "pbTileAge");
      rm.close("button");
    },
  };
}
