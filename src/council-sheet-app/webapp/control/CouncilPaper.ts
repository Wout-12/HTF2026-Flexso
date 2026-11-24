import Control from "sap/ui/core/Control";
import type RenderManager from "sap/ui/core/RenderManager";
import type { MetadataOptions } from "sap/ui/core/Element";
import type { SheetText } from "../model/sheetText";

/**
 * The printed page, as plain HTML: front and back of one A4 sheet. On the screen it looks like the
 * paper the council gets, and the print copies exactly this.
 *
 * @namespace oakhaven.council.control
 */
export default class CouncilPaper extends Control {
  static readonly metadata: MetadataOptions = {
    properties: { text: { type: "object", defaultValue: null }, headings: { type: "string[]", defaultValue: [] } },
  };

  static renderer = {
    apiVersion: 2,
    render(rm: RenderManager, control: CouncilPaper): void {
      const text = control.getProperty("text") as SheetText | null;
      const [verdictsTitle] = control.getProperty("headings") as string[];
      const element = (tag: string, css: string, content: string | (() => void)): void => {
        rm.openStart(tag);
        if (css) css.split(" ").forEach((name) => rm.class(name));
        rm.openEnd();
        if (typeof content === "string") rm.text(content);
        else content();
        rm.close(tag);
      };
      const lines = (items: readonly string[], css = ""): void => items.forEach((item) => element("p", css, item));
      const box = (checked: boolean): void => element("span", "csBox", checked ? "✕" : "");
      const table = (head: readonly string[], rows: readonly (readonly string[])[], css: string): void => {
        element("table", css, () => {
          if (head.length > 0) element("thead", "", () => element("tr", "", () => head.forEach((cell) => element("th", "", cell))));
          element("tbody", "", () => rows.forEach((row) => element("tr", "", () => row.forEach((cell) => element("td", "", cell)))));
        });
      };

      rm.openStart("div", control).class("csPaper").openEnd();
      if (text) {
        element("section", "csPage", () => {
          element("header", "csHead", () => {
            element("h1", "", text.head[0]);
            element("p", "", text.head[1]);
          });
          lines([text.head[2], ...text.flags], "csMeta");

          element("h2", "", verdictsTitle);
          for (const verdict of text.verdicts) {
            element("div", "csVerdict", () => {
              element("h3", "", () => {
                element("span", "csVerdictName", verdict.name);
                element("span", "csVerdictText", verdict.verdict);
                element("small", "", verdict.evidence);
              });
              lines(verdict.lines);
            });
          }

          element("h2", "", text.moneyTitle);
          element("table", "csMoney", () => {
            element("thead", "", () => element("tr", "", () => ["", ...text.columns].forEach((cell) => element("th", "", cell))));
            element("tbody", "", () => text.rows.forEach((row) => element("tr", "", () => {
              element("td", "csNumber", row.number);
              element("td", "", () => {
                element("strong", "", row.title);
                element("p", "", row.text);
              });
              for (const decision of ["yes", "no", "later"]) {
                rm.openStart("td").class("csTick").attr("data-label", text.columns[["yes", "no", "later"].indexOf(decision) + 1]).openEnd();
                box(row.ticked === decision);
                rm.close("td");
              }
            })));
          });
          lines(text.moneyNotes);
          element("div", "csTotals", () => {
            element("p", "csTotal", text.totals[0]);
            lines(text.totals.slice(1));
            element("p", "csTotal", () => {
              rm.text(`${text.saidLabel} `);
              element("span", "csBlank", text.said);
              rm.text(` ${text.ofBudget}`);
            });
          });

          element("h2", "", text.doubtsTitle);
          lines(text.doubts, "csDoubt");
          element("h2", "", text.agendaTitle);
          lines(text.agenda);
          if (text.choices.length > 0) {
            element("p", "csChoices", () => text.choices.forEach((choice) => element("span", "", () => {
              box(choice.checked);
              rm.text(choice.text);
            })));
          }
          element("h2", "", text.helpTitle);
          lines(text.help);
          if (text.helpRows.length > 0) table([], text.helpRows, "csHelp");
          element("footer", "csFoot", () => {
            element("span", "", () => {
              rm.text(`${text.purse} `);
              element("span", "csBlank csWide", "");
            });
            element("span", "", () => {
              rm.text(`${text.typedIn} `);
              box(text.typed);
            });
          });
        });
        element("section", "csPage csBack", () => {
          element("h1", "", text.backTitle);
          for (const item of text.tables) {
            element("h2", "", item.title);
            element("div", "csScroll", () => table(item.head, item.rows, "csTable"));
          }
          element("h2", "", text.reserveTitle);
          lines(text.reserves);
          lines(text.backNotes, "csMeta");
        });
      }
      rm.close("div");
    },
  };
}
