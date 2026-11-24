import Control from "sap/ui/core/Control";
import type RenderManager from "sap/ui/core/RenderManager";
import type { MetadataOptions } from "sap/ui/core/Element";

/**
 * One index card in the list; the whole row is a button.
 *
 * @namespace oakhaven.ledger.control
 */
export default class CardRow extends Control {
  static readonly metadata: MetadataOptions = {
    properties: {
      name: { type: "string", defaultValue: "" }, value: { type: "string", defaultValue: "" }, status: { type: "string", defaultValue: "" },
      state: { type: "string", defaultValue: "None" }, icon: { type: "sap.ui.core.URI", defaultValue: "" }, level: { type: "string", defaultValue: "" }, selected: { type: "boolean", defaultValue: false },
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
    render(rm: RenderManager, row: CardRow): void {
      const get = (name: string): string => row.getProperty(name) as string;
      const span = (css: string, text: string): void => { rm.openStart("span").class(css).openEnd().text(text).close("span"); };
      rm.openStart("button", row).attr("type", "button").class("lgRow").class(`lgLevel-${get("level")}`);
      if (row.getProperty("selected") as boolean) rm.class("lgRowSelected").attr("aria-current", "true");
      rm.openEnd();
      span("lgRowName", get("name"));
      span("lgRowValue", get("value"));
      rm.openStart("span").class("lgRowStatus").class(`lgState-${get("state")}`).openEnd();
      rm.icon(get("icon"), [], { id: `${row.getId()}-icon`, title: null });
      rm.openStart("span").openEnd().text(get("status")).close("span");
      rm.close("span").close("button");
    },
  };
}
