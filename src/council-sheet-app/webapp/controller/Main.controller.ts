import Log from "sap/base/Log";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import type Dialog from "sap/m/Dialog";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import type Control from "sap/ui/core/Control";
import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import Sorter from "sap/ui/model/Sorter";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import { lineTitle, overview, sheetText } from "../model/sheetText";
import type { Copy, Sheet } from "../model/types";

interface TickLine { key: string; title: string; crowns: string; amount: number; decision: string; note: string }
interface CopyHead { ID: string; copyNo: string; decidedAt: string | null }

const LONG_PRESS_MS = 800;
const PRINT_WAIT_MS = 300;

/**
 * The Monday Council Sheet: shows the sheet as it is now or a frozen copy, prints a copy, and
 * takes in the ticks of the meeting.
 *
 * @namespace oakhaven.council.controller
 */
export default class Main extends Controller {
  private viewModel!: JSONModel;
  private bundle!: ResourceBundle;
  private pressTimer?: number;
  private frame?: HTMLIFrameElement;
  private destroyed = false;

  public onInit(): void {
    this.viewModel = new JSONModel({
      busy: true, version: "now", versions: [], copy: null, changed: false, text: null, o: null, headings: [],
      ticks: { title: "", lines: [], rules: [], rule: "", askRule: true, by: "", total: "", any: false },
    });
    this.getView()?.setModel(this.viewModel, "view");
    // Hidden demo panel: hold the title for a moment.
    const title = this.byId("title") as Control;
    title.attachBrowserEvent("pointerdown", () => {
      this.pressTimer = window.setTimeout(() => this.dialog("demoDialog").open(), LONG_PRESS_MS);
    });
    title.attachBrowserEvent("pointerup pointerleave pointercancel", () => window.clearTimeout(this.pressTimer));
    void this.startUp();
  }

  public onExit(): void {
    this.destroyed = true;
    window.clearTimeout(this.pressTimer);
    this.frame?.remove();
  }

  private async startUp(): Promise<void> {
    this.bundle = await (this.getOwnerComponent()?.getModel("i18n") as ResourceModel).getResourceBundle();
    if (this.destroyed) return;
    this.viewModel.setProperty("/headings", [this.text("s1")]);
    await this.load();
  }

  // ---- data ------------------------------------------------------------------------------

  private model(): ODataModel {
    return this.getOwnerComponent()?.getModel() as ODataModel;
  }

  private async call(name: string, parameters: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
    const operation = this.model().bindContext(`/${name}(...)`);
    Object.entries(parameters).forEach(([key, value]) => operation.setParameter(key, value));
    await operation.invoke();
    return (operation.getBoundContext()?.getObject() as { value?: unknown } | undefined)?.value;
  }

  private async readSheet(scenario: boolean): Promise<Sheet> {
    return JSON.parse(String(await this.call("currentSheet", { scenario }))) as Sheet;
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.viewModel.setProperty("/busy", true);
    try {
      await work();
    } catch (error) {
      Log.error("Council sheet", String(error));
      if (!this.destroyed) MessageBox.error(this.text("failed", error instanceof Error ? error.message : String(error)));
    } finally {
      if (!this.destroyed) this.viewModel.setProperty("/busy", false);
    }
  }

  /** Reads the list of copies and the sheet that is chosen. */
  private async load(): Promise<void> {
    await this.run(async () => {
      const contexts = await this.model().bindList("/CouncilSheets", undefined, [new Sorter("createdAt", true)], [], { $select: "ID,copyNo,decidedAt" }).requestContexts(0, 100);
      const copies = contexts.map((context) => context.getObject() as CopyHead);
      const version = this.viewModel.getProperty("/version") as string;
      const isScenario = version === "scenario";
      const isCopy = copies.some((copy) => copy.ID === version);
      const copy = isCopy ? (JSON.parse(String(await this.call("copySheet", { sheet: version }))) as Copy) : null;
      const current = await this.readSheet(isScenario);
      if (this.destroyed) return;
      this.viewModel.setProperty("/versions", [
        { key: "now", text: this.text("versionNow") },
        ...(isScenario ? [{ key: "scenario", text: this.text("versionScenario") }] : []),
        ...copies.map((item) => ({ key: item.ID, text: this.text(item.decidedAt ? "versionTicked" : "versionCopy", item.copyNo) })),
      ]);
      this.viewModel.setProperty("/version", isCopy || isScenario ? version : "now");
      this.viewModel.setProperty("/copy", copy);
      this.viewModel.setProperty("/changed", copy !== null && copy.result.signature !== current.signature);
      const sheet = copy?.result ?? current;
      const t = (key: string, ...values: (string | number)[]): string => this.text(key, ...values);
      const text = sheetText(sheet, copy, isScenario, t);
      this.viewModel.setProperty("/text", text);
      this.viewModel.setProperty("/o", { ...overview(sheet, text, t), moneyTitle: this.text("ifCrowns", sheet.budget.weekly) });
    });
  }

  // ---- choosing, copying, printing ---------------------------------------------------------

  public onRefresh(): void {
    void this.load();
  }

  public onVersion(): void {
    void this.load();
  }

  public onScenario(): void {
    this.onCloseDialog();
    this.viewModel.setProperty("/version", "scenario");
    void this.load();
  }

  public onNow(): void {
    this.onCloseDialog();
    this.viewModel.setProperty("/version", "now");
    void this.load();
  }

  public async onCreateCopy(): Promise<void> {
    let created = "";
    await this.run(async () => {
      created = String(await this.call("createCouncilCopy"));
    });
    if (!created || this.destroyed) return;
    this.viewModel.setProperty("/version", created);
    await this.load();
    MessageToast.show(this.text("copyCreated", String(this.viewModel.getProperty("/copy/copyNo"))));
  }

  /** Prints only the paper, from a page of its own: the dark app around it stays out. */
  public onPrint(): void {
    const paper = (this.byId("paper") as Control).getDomRef();
    const copy = this.viewModel.getProperty("/copy") as Copy | null;
    if (!paper || !copy) return;
    this.frame?.remove();
    const frame = document.createElement("iframe");
    this.frame = frame;
    frame.className = "csPrintFrame";
    frame.setAttribute("aria-hidden", "true");
    frame.width = "0";
    frame.height = "0";
    frame.onload = (): void => {
      const page = frame.contentDocument;
      if (!page) return;
      page.title = `${this.text("appTitle")} ${copy.copyNo}`;
      const styles = page.createElement("link");
      styles.rel = "stylesheet";
      styles.href = new URL(sap.ui.require.toUrl("oakhaven/council/css/sheet.css"), document.baseURI).href;
      styles.onload = (): void => { window.setTimeout(() => frame.contentWindow?.print(), PRINT_WAIT_MS); };
      page.head.appendChild(styles);
      page.body.appendChild(page.importNode(paper, true));
      frame.onload = null;
    };
    frame.srcdoc = "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"></head><body></body></html>";
    document.body.appendChild(frame);
  }

  // ---- the ticks of the meeting --------------------------------------------------------------

  public onEnterTicks(): void {
    const copy = this.viewModel.getProperty("/copy") as Copy;
    this.viewModel.setProperty("/ticks", {
      title: this.text("ticksTitle", copy.copyNo),
      lines: copy.result.lines.map((line): TickLine => ({
        key: line.key, title: lineTitle(line, (key, ...values) => this.text(key, ...values)), crowns: this.text("about", line.crowns), amount: line.crowns, decision: "none", note: "",
      })),
      askRule: copy.result.agenda.rule === null,
      rules: [
        { key: "", text: this.text("ticksRuleNone") }, { key: "marenAtOnce", text: this.text("ruleMaren", 120) }, { key: "askHilde", text: this.text("ruleHilde") }, { key: "next", text: this.text("ruleNext") },
      ],
      rule: "", by: this.text("ticksDefault"), total: "", any: false,
    });
    this.onTick();
    this.dialog("ticksDialog").open();
  }

  public onTick(): void {
    const copy = this.viewModel.getProperty("/copy") as Copy;
    const lines = this.viewModel.getProperty("/ticks/lines") as TickLine[];
    const total = lines.filter((line) => line.decision === "yes").reduce((sum, line) => sum + line.amount, 0);
    this.viewModel.setProperty("/ticks/total", this.text("ticksTotal", total, copy.result.budget.weekly));
    this.viewModel.setProperty("/ticks/any", lines.some((line) => line.decision !== "none"));
  }

  public async onSaveTicks(): Promise<void> {
    const copy = this.viewModel.getProperty("/copy") as Copy;
    const lines = (this.viewModel.getProperty("/ticks/lines") as TickLine[]).filter((line) => line.decision !== "none");
    const rule = this.viewModel.getProperty("/ticks/rule") as string;
    let saved = false;
    await this.run(async () => {
      await this.call("recordDecisions", {
        sheet: copy.ID, lines: lines.map((line) => ({ lineKey: line.key, decision: line.decision, note: line.note })),
        rule: rule === "next" ? "" : rule, decidedBy: this.viewModel.getProperty("/ticks/by"),
      });
      saved = true;
    });
    if (!saved || this.destroyed) return;
    this.onCloseDialog();
    MessageToast.show(this.text("ticksSaved"));
    await this.load();
  }

  // ---- helpers ---------------------------------------------------------------------------

  public onCloseDialog(): void {
    ["ticksDialog", "demoDialog"].forEach((id) => this.dialog(id).close());
  }

  private dialog(id: string): Dialog {
    return this.byId(id) as Dialog;
  }

  private text(key: string, ...values: (string | number)[]): string {
    return this.bundle.getText(key, values) ?? key;
  }
}
