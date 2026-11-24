import IconPool from "sap/ui/core/IconPool";
import UIComponent from "sap/ui/core/UIComponent";

/**
 * Today's Route: Maren's app. Everything it needs (models, root view, i18n) is declared in manifest.json.
 *
 * @namespace oakhaven.waterroute
 */
export default class Component extends UIComponent {
  public static metadata = {
    manifest: "json",
    interfaces: ["sap.ui.core.IAsyncContentCreation"],
  };

  public init(): void {
    // Tabler Icons (npm `@tabler/icons-webfont`, served by srv/lib/icon-fonts.ts):
    // use them anywhere as `sap-icon://ti/<name>` — browse the names at https://tabler.io/icons
    IconPool.registerFont({
      fontFamily: "tabler-icons",
      fontURI: "/vendor/tabler-icons/",
      collectionName: "ti",
      lazy: true,
    });
    super.init();
  }
}
