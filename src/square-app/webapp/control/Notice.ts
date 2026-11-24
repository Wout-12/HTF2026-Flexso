import Control from "sap/ui/core/Control";
import type RenderManager from "sap/ui/core/RenderManager";
import type { MetadataOptions } from "sap/ui/core/Element";

/**
 * A paper notice pinned to the board.
 *
 * @namespace oakhaven.square.control
 */
export default class Notice extends Control {
  static readonly metadata: MetadataOptions = {
    properties: {
      text: { type: "string", defaultValue: "" }, kind: { type: "string", defaultValue: "" }, kindText: { type: "string", defaultValue: "" },
      icon: { type: "sap.ui.core.URI", defaultValue: "" }, ribbon: { type: "string", defaultValue: "" },
    },
  };

  static renderer = {
    apiVersion: 2,
    render(rm: RenderManager, notice: Notice): void {
      const get = (name: string): string => notice.getProperty(name) as string;
      rm.openStart("article", notice).class("sqNotice").class(`sqKind-${get("kind")}`);
      if (get("ribbon")) rm.class("sqGood");
      rm.openEnd();
      rm.openStart("span").class("sqNoticeHead").openEnd();
      rm.icon(get("icon"), [], { id: `${notice.getId()}-icon`, title: null });
      rm.openStart("span").openEnd().text(get("kindText")).close("span");
      if (get("ribbon")) rm.openStart("span").class("sqRibbon").openEnd().text(get("ribbon")).close("span");
      rm.close("span");
      rm.openStart("p").openEnd().text(get("text")).close("p");
      rm.close("article");
    },
  };
}
