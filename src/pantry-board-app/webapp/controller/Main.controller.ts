import Log from "sap/base/Log";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import type Dialog from "sap/m/Dialog";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import type Event from "sap/ui/base/Event";
import type Control from "sap/ui/core/Control";
import type { ValueState } from "sap/ui/core/library";
import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import type Context from "sap/ui/model/Context";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import Sorter from "sap/ui/model/Sorter";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import { listFor, openCamera, toPhoto, upload, type Photo } from "../model/captureEvidence";
import { speak, stopSpeaking } from "../model/speak";

type Risk = "panic" | "dontTrust" | "belowComfort" | "orderDue" | "ok";
type Num = number | string | null;

/** A product as the food service returns it. */
interface Item {
  ID: string; itemID: string; name: string; unit: string; icon: string; currentQuantity: Num; minStockLevel: Num; consumptionRate: Num;
  marketDayFactor: Num; supplier_ID: string | null; stockAsOf: string | null; countedAt: string | null;
  rank: number; risk: Risk; orderState: "none" | "placed" | "late"; projected: Num; daysLeft: Num; runsOutOn: string | null;
  belowOn: string | null; panicOn: string | null; orderOn: string | null; orderQuantity: number | null; arrivesOn: string | null;
  arrivalStock: Num; arrivalGap: Num; useUntilArrival: Num; weekUse: Num; target: Num; marketDay: string | null;
  supplierName: string | null; leadDays: number | null; isEstimate: boolean; orderedQuantity: Num; dueOn: string | null;
  recordedOn: string; oldCount: boolean; boardDay: string;
}

interface Line { id: string; name: string; unit: string; value: number; valueText: string; hint: string; ordered: number | null; unknown: boolean; confirmed: boolean; okText: string }

const FIELDS = [
  "ID", "itemID", "name", "unit", "icon", "currentQuantity", "minStockLevel", "consumptionRate", "marketDayFactor", "supplier_ID", "stockAsOf", "countedAt",
  "rank", "risk", "orderState", "projected", "daysLeft", "runsOutOn", "belowOn", "panicOn", "orderOn", "orderQuantity", "arrivesOn", "arrivalStock",
  "arrivalGap", "useUntilArrival", "weekUse", "target", "marketDay", "supplierName", "leadDays", "isEstimate", "orderedQuantity", "dueOn",
  "recordedOn", "oldCount", "boardDay",
];
const REFRESH_MS = 30_000;
const LONG_PRESS_MS = 800;
const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];
const DIALOGS = ["detailDialog", "padDialog", "supplierDialog", "linesDialog", "messagesDialog", "demoDialog"];
const MAX_QUANTITY = 100_000;
const BAKER = "Tobin Reyes";

const RISKS: Readonly<Record<Risk, { text: string; state: keyof typeof ValueState; icon: string }>> = {
  panic: { text: "riskPanic", state: "Error", icon: "sap-icon://alert" },
  dontTrust: { text: "riskDontTrust", state: "None", icon: "sap-icon://question-mark" },
  belowComfort: { text: "riskBelowComfort", state: "Warning", icon: "sap-icon://trend-down" },
  orderDue: { text: "riskOrderDue", state: "Information", icon: "sap-icon://cart" },
  ok: { text: "riskOk", state: "Success", icon: "sap-icon://accept" },
};

const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const day = (date: string | null): string => (date ? dayFormat.format(new Date(`${date}T00:00:00Z`)) : "");
const amount = (value: Num, unit: string): string => {
  const number = Math.round(Number(value ?? 0) * 100) / 100;
  const units: Readonly<Record<string, string>> = { KG: "kg", L: "L", Dozen: "dozen" };
  return units[unit] ? `${number} ${units[unit]}` : String(number);
};

/**
 * The Pantry Board: what Tobin orders today and how much, and why.
 *
 * The rank compares all products and cannot be sorted on in the database, so the products are
 * read here, sorted, and shown through the "view" model.
 *
 * @namespace oakhaven.pantry.controller
 */
export default class Main extends Controller {
  private viewModel!: JSONModel;
  private bundle!: ResourceBundle;
  private items: Item[] = [];
  private current?: Item;
  private supplierId = "";
  private photo?: Photo;
  private onPad?: (value: number) => void;
  private refreshTimer?: number;
  private pressTimer?: number;
  private destroyed = false;

  public onInit(): void {
    this.viewModel = new JSONModel({
      now: new Date(), busy: true, lost: false, demoText: "", briefing: "", messageCount: "", tiles: [], messages: [], suppliers: [], photos: [],
      detail: { name: "", riskText: "", riskIcon: "", state: "None", why: [], wait: [], markText: "" },
      pad: { title: "", value: "", unit: "", keys: PAD_KEYS.map((text) => ({ text })), withPhoto: false, photoText: "" },
      lines: { title: "", dock: false, when: "now", items: [], hint: "", photoText: "", hasPhoto: false, note: "" },
    });
    this.getView()?.setModel(this.viewModel, "view");
    const title = this.byId("title") as Control;
    title.attachBrowserEvent("pointerdown", () => {
      this.pressTimer = window.setTimeout(() => this.dialog("demoDialog").open(), LONG_PRESS_MS);
    });
    title.attachBrowserEvent("pointerup pointerleave pointercancel", () => window.clearTimeout(this.pressTimer));
    void this.startUp();
  }

  public onExit(): void {
    this.destroyed = true;
    window.clearInterval(this.refreshTimer);
    window.clearTimeout(this.pressTimer);
    stopSpeaking();
  }

  // ---- data ------------------------------------------------------------------------------

  private async startUp(): Promise<void> {
    this.bundle = await (this.getOwnerComponent()?.getModel("i18n") as ResourceModel).getResourceBundle();
    await this.refresh();
    if (!this.destroyed) this.refreshTimer = window.setInterval(() => void this.refresh(), REFRESH_MS);
  }

  private model(): ODataModel {
    return this.getOwnerComponent()?.getModel() as ODataModel;
  }

  private async read<T>(path: string, select: string, filters: Filter[] = [], sorters: Sorter[] = []): Promise<T[]> {
    const contexts = await this.model().bindList(path, undefined, sorters, filters, { $select: select }).requestContexts(0, 200);
    return contexts.map((context) => context.getObject() as T);
  }

  private async call(name: string, parameters: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
    const action = this.model().bindContext(`/${name}(...)`);
    Object.entries(parameters).forEach(([key, value]) => action.setParameter(key, value));
    await action.invoke();
    return (action.getBoundContext()?.getObject() as { value?: unknown } | undefined)?.value;
  }

  private async refresh(): Promise<void> {
    try {
      await this.call("checkAlerts");
      const items = await this.read<Item>("/StockItems", FIELDS.join(","));
      const messages = await this.read<{ ID: string; message: string }>("/Notifications", "ID,message",
        [new Filter("acknowledged", FilterOperator.EQ, false)], [new Sorter("createdAt", true)]);
      if (this.destroyed) return;
      this.items = items.sort((a, b) => a.rank - b.rank);
      this.viewModel.setProperty("/messages", messages);
      this.viewModel.setProperty("/messageCount", messages.length > 0 ? String(messages.length) : "");
      this.viewModel.setProperty("/lost", false);
      this.show();
    } catch (error) {
      Log.error("Could not read the pantry", String(error));
      if (!this.destroyed) this.viewModel.setProperty("/lost", true);
    } finally {
      if (!this.destroyed) {
        this.viewModel.setProperty("/busy", false);
        this.viewModel.setProperty("/now", new Date());
      }
    }
  }

  /** Runs a change: busy while it runs, the server's message when it fails. */
  private async run(change: () => Promise<void>): Promise<void> {
    if (this.viewModel.getProperty("/busy")) return;
    this.viewModel.setProperty("/busy", true);
    try {
      await change();
      await this.refresh();
    } catch (error) {
      MessageBox.error(error instanceof Error ? error.message : String(error));
    } finally {
      this.viewModel.setProperty("/busy", false);
    }
  }

  // ---- board -----------------------------------------------------------------------------

  private show(): void {
    this.viewModel.setProperty("/tiles", this.items.map((item) => ({
      id: item.ID,
      icon: item.icon,
      name: item.name,
      risk: item.risk,
      riskText: this.text(RISKS[item.risk].text),
      riskIcon: RISKS[item.risk].icon,
      number: item.daysLeft === null ? "?" : String(Math.floor(Number(item.daysLeft))),
      unitText: item.daysLeft === null ? this.text("dontTrust") : this.text(Math.floor(Number(item.daysLeft)) === 1 ? "dayLeft" : "daysLeft"),
      action: this.actionText(item),
      detail: this.needsOrder(item) ? this.text("arrives", item.supplierName ?? "", this.arrival(item)) : "",
      order: item.orderState === "none" ? "" : this.text(item.orderState === "late" ? "orderLate" : "orderPlaced", day(item.dueOn)),
      market: Number(item.marketDayFactor) > 1 ? this.text("marketHint") : "",
      age: this.ageText(item),
    })));
    const boardDay = this.items[0]?.boardDay ?? "";
    const isDemo = boardDay !== "" && boardDay !== new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(new Date());
    this.viewModel.setProperty("/demoText", isDemo ? this.text("demoDay", day(boardDay)) : "");
    this.viewModel.setProperty("/briefing", this.briefing());
  }

  private ageText(item: Item): string {
    if (item.countedAt !== null) return this.text(item.oldCount ? "oldCount" : "counted", day(item.recordedOn));
    return this.text(item.stockAsOf === null ? "ageSeed" : "ageDelivery", day(item.recordedOn));
  }

  private arrival(item: Item): string {
    return item.isEstimate ? this.text("estimated", day(item.arrivesOn)) : day(item.arrivesOn);
  }

  private needsOrder(item: Item): boolean {
    return item.orderState === "none" && item.orderQuantity !== null && item.orderOn === item.boardDay;
  }

  /** Half the story for a number nobody trusts: the stock that is used up before the cart arrives. */
  private untrustedLimit(item: Item): string {
    return amount(item.useUntilArrival, item.unit);
  }

  private actionText(item: Item): string {
    if (item.supplier_ID === null) return this.text("neverOrdered");
    if (item.risk === "dontTrust") {
      return item.orderState === "none" ? this.text("orderIfUnder", amount(item.orderQuantity, item.unit), this.untrustedLimit(item)) : this.text("countIt");
    }
    if (item.orderState !== "none" || item.orderQuantity === null) return item.orderState === "none" ? this.text("noOrder") : "";
    const quantity = amount(item.orderQuantity, item.unit);
    return this.needsOrder(item) ? this.text("orderToday", quantity) : this.text("orderOn", quantity, day(item.orderOn));
  }

  // ---- briefing --------------------------------------------------------------------------

  private briefing(): string {
    const parts: string[] = [];
    const orders = this.items.filter((item) => this.needsOrder(item) && item.risk !== "dontTrust");
    for (const item of orders.slice(0, 2)) {
      parts.push(this.text(item.marketDay ? "briefOrderMarket" : "briefOrder", item.name.toLowerCase(), amount(item.orderQuantity, item.unit), item.supplierName ?? ""));
    }
    if (orders.length > 2) parts.push(this.text("briefMore", orders.length - 2));
    if (orders.length === 0) parts.push(this.text("briefNone"));
    const untrusted = this.items.filter((item) => item.risk === "dontTrust");
    untrusted.forEach((item) => parts.push(this.text("briefTrust", item.name)));
    this.items.filter((item) => item.orderState === "late").forEach((item) => parts.push(this.text("briefLate", item.name)));
    this.items.filter((item) => item.orderState === "placed" && item.dueOn === item.boardDay).forEach((item) => parts.push(this.text("briefDue", item.name)));
    const old = this.items
      .filter((item) => item.oldCount && item.risk !== "dontTrust")
      .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn))
      .slice(0, 2)
      .map((item) => item.name.toLowerCase());
    if (old.length > 0) parts.push(this.text("briefCount", old.length === 2 ? this.text("and", old[0], old[1]) : old[0]));
    if (this.items[0] && new Date(`${this.items[0].boardDay}T00:00:00Z`).getUTCDay() === 5) parts.push(this.text("briefMarket"));
    return parts.join(" ");
  }

  public onSpeak(): void {
    const spoken = this.briefing().replace(/\bkg\b/g, "kilos").replace(/(\d) L\b/g, "$1 litres");
    speak(`${this.text("briefMorning")} ${spoken}`);
  }

  // ---- detail: why, what if, order, count --------------------------------------------------

  public onTile(event: Event): void {
    const id = this.itemOf<{ id: string }>(event).id;
    this.current = this.items.find((item) => item.ID === id);
    if (!this.current) return;
    const item = this.current;
    const canOrder = this.needsOrder(item) && Number(item.orderQuantity) > 0;
    this.viewModel.setProperty("/detail", {
      name: item.name,
      riskText: this.text(RISKS[item.risk].text),
      riskIcon: RISKS[item.risk].icon,
      state: RISKS[item.risk].state,
      why: this.why(item).map((text) => ({ text })),
      wait: this.whatIf(item).map((text) => ({ text })),
      markText: canOrder ? this.text("markOrdered", amount(item.orderQuantity, item.unit)) : "",
    });
    this.viewModel.setProperty("/photos", []);
    this.dialog("detailDialog").open();
    void this.loadPhotos(item);
  }

  private async loadPhotos(item: Item): Promise<void> {
    try {
      const own = [new Filter("item_ID", FilterOperator.EQ, item.ID)];
      const receivals = await this.read<{ deliveryID: string | null }>("/StockReceivals", "deliveryID", own);
      const counts = await this.read<{ ID: string }>("/StockCounts", "ID", own);
      const deliveryIds = receivals.map((row) => row.deliveryID).filter((id): id is string => id !== null);
      const photos = [...(await listFor("StockReceival", deliveryIds)), ...(await listFor("StockCount", counts.map((row) => row.ID)))];
      if (this.current === item && !this.destroyed) this.viewModel.setProperty("/photos", photos);
    } catch (error) {
      Log.warning("Could not read the photos", String(error));
    }
  }

  private why(item: Item): string[] {
    const of = (value: Num): string => amount(value, item.unit);
    const lines: string[] = [];
    if (item.risk === "dontTrust") lines.push(this.text("whyDontTrust", of(item.currentQuantity)));
    else if (item.countedAt === null && item.stockAsOf === null) lines.push(this.text("whyStockOld", of(item.currentQuantity), day(item.recordedOn)));
    else if (item.countedAt === null) lines.push(this.text("whyStockDelivery", of(item.projected), day(item.recordedOn)));
    else if (Number(item.projected) === Number(item.currentQuantity)) lines.push(this.text("whyStock", of(item.projected), day(item.recordedOn)));
    else lines.push(this.text("whyStockForecast", of(item.projected), day(item.recordedOn)));
    lines.push(this.text(Number(item.marketDayFactor) > 1 ? "whyUseMarket" : "whyUse", of(item.consumptionRate)));
    if (item.supplier_ID === null) return [...lines, this.text("whyBread")];
    if (item.orderQuantity === null) return lines;
    if (item.risk === "dontTrust") {
      return [...lines, this.text("whyUntrustedOrder", this.untrustedLimit(item), of(item.orderQuantity), day(item.arrivesOn))];
    }
    const lead = item.isEstimate ? "whyLeadEstimate" : item.leadDays === 1 ? "whyLeadOne" : "whyLead";
    lines.push(this.text(lead, item.supplierName ?? "", item.leadDays ?? "", day(item.orderOn), day(item.arrivesOn)));
    lines.push(Number(item.arrivalGap) > 0
      ? this.text("whyArrivalGap", of(item.arrivalStock), of(item.arrivalGap))
      : this.text("whyArrival", of(item.arrivalStock), of(item.minStockLevel)));
    lines.push(item.marketDay ? this.text("whyMarket", day(item.marketDay), of(item.weekUse)) : this.text("whyWeek", of(item.weekUse)));
    lines.push(this.text("whySum", of(item.minStockLevel), of(item.weekUse), of(item.target), of(item.arrivalStock),
      of(Number(item.target) - Number(item.arrivalStock)), of(item.orderQuantity)));
    return lines;
  }

  private whatIf(item: Item): string[] {
    if (item.risk === "dontTrust" || item.supplier_ID === null || item.runsOutOn === null || item.orderState !== "none") return [];
    const out = day(item.runsOutOn);
    let wait = this.text("waitRunsOut", out);
    if (item.risk === "panic") wait = this.text("waitNow", out);
    else if (item.belowOn && item.belowOn !== item.runsOutOn) wait = this.text("waitBelow", day(item.belowOn), out);
    else if (item.risk === "belowComfort") wait = item.panicOn && item.panicOn < item.runsOutOn ? this.text("waitPanic", day(item.panicOn), out) : this.text("waitNowBelow", out);
    if (item.orderQuantity === null) return [wait];
    const after = Number(item.arrivalStock) + item.orderQuantity;
    return [wait, this.text("orderThen", amount(item.arrivalStock, item.unit), this.arrival(item), amount(after, item.unit))];
  }

  public onMarkOrdered(): void {
    const item = this.current;
    if (!item) return;
    this.onCloseDialog();
    void this.run(async () => {
      await this.call("markOrdered", { item: item.ID, quantity: String(item.orderQuantity) });
      MessageToast.show(this.text("savedOrder", `${item.name}, ${amount(item.orderQuantity, item.unit)}`));
    });
  }

  public onCount(): void {
    const item = this.current;
    if (!item) return;
    this.openPad(this.text("countTitle", item.name.toLowerCase()), item.unit, true, (value) => void this.run(async () => {
      const ids = (await this.call("countStock", { lines: [{ item: item.ID, counted: String(value) }] })) as string[] | undefined;
      MessageToast.show(this.text("savedCount"));
      await this.storePhoto("StockCount", ids?.[0], item.name);
    }));
  }

  // ---- number pad --------------------------------------------------------------------------

  private openPad(title: string, unit: string, withPhoto: boolean, onSave: (value: number) => void): void {
    this.onPad = onSave;
    if (withPhoto) this.photo = undefined;
    this.viewModel.setProperty("/pad/title", title);
    this.viewModel.setProperty("/pad/unit", unit === "Number" ? "" : unit === "L" ? "L" : unit.toLowerCase());
    this.viewModel.setProperty("/pad/value", "");
    this.viewModel.setProperty("/pad/withPhoto", withPhoto);
    this.viewModel.setProperty("/pad/photoText", this.text("photoButton"));
    this.dialog("padDialog").open();
  }

  public onPadKey(event: Event): void {
    const key = this.itemOf<{ text: string }>(event).text;
    const value = this.viewModel.getProperty("/pad/value") as string;
    let next = value + key;
    if (key === "⌫") next = value.slice(0, -1);
    else if (key === "." && (value.includes(".") || value === "")) next = value === "" ? "0." : value;
    if (Number(next) <= MAX_QUANTITY && !/\.\d{3}/.test(next)) this.viewModel.setProperty("/pad/value", next);
  }

  public onPadPhoto(): void {
    this.takePhoto("/pad/photoText");
  }

  public onPadSave(): void {
    const value = Number(this.viewModel.getProperty("/pad/value"));
    this.dialog("padDialog").close();
    this.dialog("detailDialog").close();
    this.onPad?.(value);
  }

  // ---- stocktake and delivery dock -----------------------------------------------------------

  public onStocktake(): void {
    this.openLines(this.text("stocktakeTitle"), false, this.items.map((item) => this.line(item, Math.max(0, Number(item.projected ?? 0)),
      item.risk === "dontTrust" ? this.text("dontTrust") : this.text("recorded", amount(item.projected, item.unit)), null, item.risk === "dontTrust")));
  }

  public onDock(): void {
    void this.run(async () => {
      const suppliers = await this.read<{ ID: string; name: string }>("/Suppliers", "ID,name", [], [new Sorter("leadDays")]);
      this.viewModel.setProperty("/suppliers", suppliers);
      this.dialog("supplierDialog").open();
    });
  }

  public onSupplier(event: Event): void {
    const supplier = this.itemOf<{ ID: string; name: string }>(event);
    this.supplierId = supplier.ID;
    this.photo = undefined;
    this.dialog("supplierDialog").close();
    const lines = this.items.filter((item) => item.supplier_ID === supplier.ID).map((item) => {
      const ordered = item.orderState === "none" ? null : Number(item.orderedQuantity);
      return this.line(item, ordered ?? 0, ordered === null ? this.text("notOrdered") : this.text("ordered", amount(ordered, item.unit)), ordered);
    });
    this.openLines(this.text("dockLines", supplier.name), true, lines);
  }

  private line(item: Item, value: number, hint: string, ordered: number | null, unknown = false): Line {
    return { id: item.ID, name: item.name, unit: item.unit, value, valueText: unknown ? "?" : amount(value, item.unit), hint, ordered, unknown, confirmed: false, okText: "✓" };
  }

  private openLines(title: string, dock: boolean, items: Line[]): void {
    this.viewModel.setProperty("/lines", { title, dock, when: "now", items, hint: "", photoText: this.text("photoDock"), hasPhoto: false, note: "" });
    this.updateLinesHint();
    this.dialog("linesDialog").open();
  }

  /** Nothing pre-filled is ever saved by accident: every line has to be confirmed first. */
  private updateLinesHint(): void {
    const open = (this.viewModel.getProperty("/lines/items") as Line[]).filter((line) => !line.confirmed).length;
    this.viewModel.setProperty("/lines/hint", open > 0 ? this.text("confirmAll", open) : "");
  }

  private changeLine(context: Context | null | undefined, change: (line: Line) => Partial<Line>): void {
    const path = context?.getPath();
    if (!path) return;
    const line = { ...(this.viewModel.getProperty(path) as Line) };
    Object.assign(line, change(line));
    line.value = Math.min(MAX_QUANTITY, Math.max(0, Math.round(line.value * 100) / 100));
    line.valueText = amount(line.value, line.unit);
    this.viewModel.setProperty(path, line);
    this.updateLinesHint();
  }

  public onLineMinus(event: Event): void {
    this.changeLine(this.contextOf(event), (line) => ({ value: line.value - 1, unknown: false, confirmed: true }));
  }

  public onLinePlus(event: Event): void {
    this.changeLine(this.contextOf(event), (line) => ({ value: line.value + 1, unknown: false, confirmed: true }));
  }

  public onLineOk(event: Event): void {
    // A number nobody trusts cannot be "still right": it has to be counted.
    if (this.itemOf<Line>(event).unknown) this.onLineValue(event);
    else this.changeLine(this.contextOf(event), () => ({ confirmed: true }));
  }

  public onLineValue(event: Event): void {
    const context = this.contextOf(event);
    const line = this.itemOf<Line>(event);
    this.openPad(line.name, line.unit, false, (value) => this.changeLine(context, () => ({ value, unknown: false, confirmed: true })));
  }

  public onLinesSave(): void {
    const lines = this.viewModel.getProperty("/lines/items") as Line[];
    if (!(this.viewModel.getProperty("/lines/dock") as boolean)) {
      this.dialog("linesDialog").close();
      void this.run(async () => {
        await this.call("countStock", { lines: lines.map((line) => ({ item: line.id, counted: String(line.value) })) });
        MessageToast.show(this.text("savedCount"));
      });
      return;
    }
    const odd = lines.find((line) => line.ordered !== null && line.value > 2 * line.ordered);
    if (!odd) {
      this.saveDelivery(lines);
      return;
    }
    MessageBox.confirm(this.text("areYouSure", `${odd.name} ${odd.valueText}`, amount(odd.ordered, odd.unit)), {
      onClose: (action: unknown) => { if (action === MessageBox.Action.OK) this.saveDelivery(lines); },
    });
  }

  private saveDelivery(lines: readonly Line[]): void {
    const note = this.viewModel.getProperty("/lines/note") as string;
    const receivedAt = this.receivedAt(this.viewModel.getProperty("/lines/when") as string);
    void this.run(async () => {
      const deliveryID = (await this.call("logDelivery", {
        supplier: this.supplierId,
        lines: lines.map((line) => ({ item: line.id, received: String(line.value) })),
        receivedAt: `${receivedAt.toISOString().slice(0, 19)}Z`,
      })) as string | undefined;
      this.dialog("linesDialog").close();
      const different = lines.filter((line) => line.ordered !== null && line.ordered !== line.value)
        .map((line) => this.text("deliveryDiff", line.name, line.value, amount(line.ordered, line.unit)));
      MessageToast.show([this.text("savedDelivery"), ...different].join(". "));
      await this.storePhoto("StockReceival", deliveryID, note);
    });
  }

  private receivedAt(when: string): Date {
    const date = new Date();
    if (when === "now") return date;
    if (when === "yesterday") date.setDate(date.getDate() - 1);
    const early = new Date(date);
    early.setHours(6, 0, 0, 0);
    return early > date ? date : early;
  }

  // ---- photos ------------------------------------------------------------------------------

  public onDockPhoto(): void {
    this.takePhoto("/lines/photoText", () => this.viewModel.setProperty("/lines/hasPhoto", true));
  }

  private takePhoto(textPath: string, done?: () => void): void {
    openCamera((file) => {
      toPhoto(file).then((photo) => {
        this.photo = photo;
        this.viewModel.setProperty(textPath, this.text("photoReady"));
        done?.();
      }).catch((error: unknown) => MessageBox.error(error instanceof Error ? error.message : String(error)));
    });
  }

  /** A photo never blocks: what it belongs to is already saved. */
  private async storePhoto(recordType: string, recordId: string | undefined, note: string): Promise<void> {
    const photo = this.photo;
    this.photo = undefined;
    if (!photo || !recordId) return;
    try {
      await upload(recordType, recordId, note, BAKER, photo);
    } catch (error) {
      MessageBox.warning(this.text("photoFailed", error instanceof Error ? error.message : String(error)));
    }
  }

  // ---- messages and demo ---------------------------------------------------------------------

  public onMessages(): void {
    this.dialog("messagesDialog").open();
  }

  public onSeen(event: Event): void {
    const { ID } = this.itemOf<{ ID: string }>(event);
    void this.run(async () => { await this.call("markSeen", { notification: ID }); });
  }

  public onDemo(step: string): void {
    this.dialog("demoDialog").close();
    void this.run(async () => {
      if (!step) {
        await this.call("demoReset");
        return;
      }
      const date = new Date(`${this.items[0].boardDay}T00:00:00Z`);
      do date.setUTCDate(date.getUTCDate() + 1); while (step === "saturday" && date.getUTCDay() !== 6);
      await this.call("demoSetDay", { day: date.toISOString().slice(0, 10) });
    });
  }

  // ---- helpers -------------------------------------------------------------------------------

  /** Closes the dialog on top. */
  public onCloseDialog(): void {
    const top = [...DIALOGS].sort((a, b) => Number(a === "padDialog") - Number(b === "padDialog")).reverse().map((id) => this.dialog(id)).find((dialog) => dialog.isOpen());
    top?.close();
  }

  private dialog(id: string): Dialog {
    return this.byId(id) as Dialog;
  }

  private contextOf(event: Event): Context | null | undefined {
    return (event.getSource() as Control).getBindingContext("view");
  }

  private itemOf<T>(event: Event): T {
    return this.contextOf(event)?.getObject() as T;
  }

  private text(key: string, ...values: (string | number)[]): string {
    // Without values the text is taken as is; with values, an apostrophe in it must be doubled.
    return this.bundle.getText(key, values.length > 0 ? values : undefined) ?? key;
  }
}
