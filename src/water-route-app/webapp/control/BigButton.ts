import Control from "sap/ui/core/Control";
import type RenderManager from "sap/ui/core/RenderManager";
import type { MetadataOptions } from "sap/ui/core/Element";

const SWIPE_PX = 70;

/**
 * A button for wet gloves: any size, a tap presses, a sideways drag swipes.
 *
 * @namespace oakhaven.waterroute.control
 */
export default class BigButton extends Control {
  static readonly metadata: MetadataOptions = {
    properties: {
      text: { type: "string", defaultValue: "" },
      variant: { type: "string", defaultValue: "" },
      enabled: { type: "boolean", defaultValue: true },
      confirm: { type: "boolean", defaultValue: false },
    },
    events: { press: {}, swipe: {} },
  };

  private startX = 0;
  private swiped = false;

  // Not attachBrowserEvent: UI5 copies those handlers when it clones a list template, so a tap
  // on a list item would fire on the template as well.
  public onAfterRendering(): void {
    const button = this.getDomRef() as HTMLElement | null;
    if (!button) return;
    button.onpointerdown = (event: PointerEvent): void => {
      this.startX = event.clientX;
      this.swiped = false;
    };
    button.onpointerup = (event: PointerEvent): void => {
      this.swiped = Math.abs(event.clientX - this.startX) > SWIPE_PX;
      if (this.swiped) this.fireEvent("swipe");
    };
    // `click` also covers the keyboard (Enter/Space), because this is a real <button>.
    button.onclick = (): void => {
      if (!this.swiped) this.fireEvent("press");
      this.swiped = false;
    };
  }

  static renderer = {
    apiVersion: 2,
    render(rm: RenderManager, control: BigButton): void {
      const variant = control.getProperty("variant") as string;
      rm.openStart("button", control).attr("type", "button").class("wrBig");
      if (variant) rm.class(`wrBig-${variant}`);
      if (control.getProperty("confirm") as boolean) rm.class("wrBig-confirm");
      if (!(control.getProperty("enabled") as boolean)) rm.attr("disabled", "disabled");
      rm.openEnd().text(control.getProperty("text") as string).close("button");
    },
  };
}
