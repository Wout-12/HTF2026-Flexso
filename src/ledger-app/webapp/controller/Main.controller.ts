import Log from "sap/base/Log";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import type Dialog from "sap/m/Dialog";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import type Event from "sap/ui/base/Event";
import type Control from "sap/ui/core/Control";
import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import type { Dot } from "../control/Timeline";
import { answers, card, clock, day, isAsking, listItem, moment, nameOf, writer, type Finding, type Ledger, type ListItem, type Text } from "../model/ledgerText";

interface Group { title: string; text: string; items: ListItem[] }

const REFRESH_MS = 20_000;
const DAY_MS = 86_400_000;
const MORNING_HOUR = 6;
const ASK_GROUPS = ["W1", "W2", "W3", "W4", "W5", "other", "confirm"];
/** Moves that need a reason in words: the question, and how the service calls it. */
const REASONS: Readonly<Record<string, { title: string; question: string; parameter: string }>> = {
  markNotTrusted: { title: "doNotTrusted", question: "askNotTrusted", parameter: "note" },
  clearFinding: { title: "rvCleared", question: "askClear", parameter: "reason" },
  reopen: { title: "ereopened", question: "askReopen", parameter: "reason" },
  recordAnswer: { title: "eanswered", question: "askAnswer", parameter: "text" },
};

/**
 * The Ledger: what may not be trusted and why, and what Ilse decided about it.
 *
 * @namespace oakhaven.ledger.controller
 */
export default class Main extends Controller {
  private viewModel!: JSONModel;
  private bundle!: ResourceBundle;
  private ledger?: Ledger;
  private known?: Set<string>;
  private timer?: number;
  private audio?: AudioContext;
  private action = "";
  private destroyed = false;
  private readonly t: Text = (key, ...values) => this.bundle.getText(key, values) ?? key;

  public onInit(): void {
    this.viewModel = new JSONModel({
      busy: true, opened: false, lost: false, counts: "", urgent: "", dots: [], legend: [], answer: "", answers: [], groups: [], selectedId: "", card: null, reason: { title: "", question: "", text: "" },
    });
    this.getView()?.setModel(this.viewModel, "view");
    void this.startUp();
  }

  public onExit(): void {
    this.destroyed = true;
    window.clearInterval(this.timer);
    void this.audio?.close();
  }

  private async startUp(): Promise<void> {
    this.bundle = await (this.getOwnerComponent()?.getModel("i18n") as ResourceModel).getResourceBundle();
    if (this.destroyed) return;
    this.viewModel.setProperty("/legend", [
      { kind: "sure", text: this.t("legendSure") }, { kind: "ask", text: this.t("legendAsk") }, { kind: "other", text: this.t("legendOther") }, { kind: "inner", text: this.t("legendInner") },
    ]);
    await this.run(() => this.load());
    if (!this.destroyed) this.timer = window.setInterval(() => void this.watch(), REFRESH_MS);
  }

  // ---- data ------------------------------------------------------------------------------

  private async call(name: string, parameters: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
    const operation = (this.getOwnerComponent()?.getModel() as ODataModel).bindContext(`/${name}(...)`);
    Object.entries(parameters).forEach(([key, value]) => operation.setParameter(key, value));
    await operation.invoke();
    return (operation.getBoundContext()?.getObject() as { value?: unknown } | undefined)?.value;
  }

  private async run(work: () => Promise<void>): Promise<boolean> {
    this.viewModel.setProperty("/busy", true);
    try {
      await work();
      return true;
    } catch (error) {
      Log.error("Ledger", String(error));
      if (!this.destroyed) MessageBox.error(this.t("failed", error instanceof Error ? error.message : String(error)));
      return false;
    } finally {
      if (!this.destroyed) this.viewModel.setProperty("/busy", false);
    }
  }

  private async load(): Promise<void> {
    const ledger = JSON.parse(String(await this.call("ledger"))) as Ledger;
    if (this.destroyed) return;
    this.ledger = ledger;
    this.known = new Set(this.urgent().map((finding) => finding.ID));
    this.show();
  }

  /** One small question every 20 seconds; the rest is only read when something changed. */
  private async watch(): Promise<void> {
    try {
      const ids = String((await this.call("urgentNew")) ?? "").split(",").filter(Boolean);
      if (this.destroyed) return;
      this.viewModel.setProperty("/lost", false);
      const isNew = ids.some((id) => !this.known?.has(id));
      if (isNew || ids.length !== this.known?.size) await this.load();
      if (isNew) this.chime();
    } catch (error) {
      Log.warning("Could not ask for urgent changes", String(error));
      if (!this.destroyed) this.viewModel.setProperty("/lost", true);
    }
  }

  private urgent(): Finding[] {
    return (this.ledger?.findings ?? []).filter((finding) => finding.level === "sure" && finding.reviewStatus === "New");
  }

  // ---- what is shown ---------------------------------------------------------------------

  private show(): void {
    const ledger = this.ledger;
    if (!ledger) return;
    const { findings } = ledger;
    const sure = findings.filter((finding) => finding.level === "sure");
    const asking = findings.filter(isAsking);
    this.viewModel.setProperty("/counts", this.t("counts", sure.length, asking.length, sure.filter(isAsking).length));
    const urgent = this.urgent();
    this.viewModel.setProperty("/urgent", urgent.length > 0 ? this.t("urgentBanner", urgent.length, nameOf(this.sorted(urgent)[0], this.t)) : "");
    this.viewModel.setProperty("/dots", this.dots());
    const [first, ...rest] = answers(ledger, this.t);
    this.viewModel.setProperty("/answer", first);
    this.viewModel.setProperty("/answers", rest.map((text) => ({ text })));
    this.viewModel.setProperty("/groups", this.groups());
    const selected = findings.find((finding) => finding.ID === this.viewModel.getProperty("/selectedId"));
    this.viewModel.setProperty("/card", selected ? card(selected, this.t) : null);
  }

  private sorted(findings: readonly Finding[]): Finding[] {
    const order = ["Sensor", "StockItem", "Repair", "WaterPipe", "Landmark"];
    return [...findings].sort((a, b) => order.indexOf(a.recordType) - order.indexOf(b.recordType) || a.evidence.name.localeCompare(b.evidence.name));
  }

  private groups(): Group[] {
    const findings = this.ledger?.findings ?? [];
    const items = (list: readonly Finding[]): ListItem[] => this.sorted(list).map((finding) => listItem(finding, this.t));
    const open = findings.filter((finding) => finding.reviewStatus !== "Cleared");
    const groups: Group[] = [];
    for (const key of [...new Set(open.map((finding) => finding.groupKey))].filter((name) => name.startsWith("case:")).sort()) {
      const list = open.filter((finding) => finding.groupKey === key);
      const { observedVersion, evidence } = list[0];
      groups.push({
        title: this.t("caseTitle", clock(observedVersion), day(observedVersion)), text: this.t("caseText", list.length, `${clock(observedVersion)}, ${day(observedVersion)},`, evidence.modifiedBy), items: items(list),
      });
    }
    const single = open.filter((finding) => finding.groupKey === "sure");
    if (single.length > 0) groups.push({ title: this.t("sureTitle"), text: "", items: items(single) });
    const since = new Date(Date.now() - DAY_MS);
    since.setHours(MORNING_HOUR, 0, 0, 0);
    const morning = findings.filter((finding) => finding.level === "ask" && Date.parse(finding.createdAt) >= since.getTime() && finding.reviewStatus === "New").length;
    groups.push({ title: this.t("askTitle", findings.filter(isAsking).length), text: `${this.t("askIntro")} ${this.t("morning", morning)}`, items: [] });
    for (const key of ASK_GROUPS) {
      const list = open.filter((finding) => finding.groupKey === key);
      if (list.length > 0) groups.push({ title: this.t("groupTitle", this.t(`g${key}`), list.length), text: "", items: items(list) });
    }
    const cleared = findings.filter((finding) => finding.reviewStatus === "Cleared");
    if (cleared.length > 0) groups.push({ title: this.t("clearedTitle"), text: "", items: items(cleared) });
    groups.push({ title: this.t("noHits"), text: this.t("noHitsText", this.ledger?.checked.records ?? 0), items: [] });
    return groups;
  }

  private dots(): Dot[] {
    if (!this.ledger) return [];
    const { findings, timeline } = this.ledger;
    const dots = timeline.moments.map((item): Dot => {
      const finding = findings.find((row) => row.recordId === item.recordId && (new Date(row.observedVersion).toISOString() === item.at
        || (row.evidence.createdAt === item.at && row.reasons.includes("outsideCreated"))));
      const kind = finding === undefined ? "other" : finding.level === "sure" && (item.night || item.stranger) ? "sure" : "ask";
      return { at: item.at, kind, finding: finding?.ID ?? "", label: this.t(item.event === "created" ? "momentCreated" : "momentChanged", moment(item.at), finding ? nameOf(finding, this.t) : item.name, writer(item.who)) };
    });
    const inner = timeline.inner.map((item): Dot => ({
      at: item.at, kind: "inner", finding: findings.find((row) => row.recordId === item.recordId)?.ID ?? "", label: `${this.t("legendInner")}: ${this.t("innerItem", day(item.at), day(item.writtenAt))}`,
    }));
    return [...dots, ...inner];
  }

  // ---- choosing --------------------------------------------------------------------------

  public onOpenLedger(): void {
    // A click unlocks sound in the browser.
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume();
    } catch (error) {
      Log.warning("No sound available", String(error));
    }
    this.viewModel.setProperty("/opened", true);
    MessageToast.show(this.t("opened"));
    void this.run(async () => {
      await this.call("scan");
      await this.load();
      if (this.urgent().length > 0) this.chime();
    });
  }

  public onUrgent(): void {
    const [first] = this.sorted(this.urgent());
    if (first) this.choose(first.ID);
  }

  public onRow(event: Event): void {
    this.choose((event.getSource() as Control).getBindingContext("view")?.getProperty("id") as string);
  }

  public onTimeline(event: Event): void {
    this.choose((event.getParameters() as { finding: string }).finding);
  }

  public onBack(): void {
    this.choose("");
  }

  private choose(id: string): void {
    this.viewModel.setProperty("/selectedId", id);
    this.show();
    if (id) window.setTimeout(() => (this.byId("card") as Control).getDomRef()?.scrollIntoView({ block: "nearest" }), 100);
  }

  // ---- Ilse's decisions --------------------------------------------------------------------

  public onAct(action: string): void {
    const reason = REASONS[action];
    if (!reason) {
      void this.act(action, {});
      return;
    }
    this.action = action;
    this.viewModel.setProperty("/reason", { title: this.t(reason.title), question: this.t(reason.question), text: "" });
    (this.byId("reasonDialog") as Dialog).open();
  }

  public onReasonSave(): void {
    const text = this.viewModel.getProperty("/reason/text") as string;
    this.onReasonCancel();
    void this.act(this.action, { [REASONS[this.action].parameter]: text });
  }

  public onReasonCancel(): void {
    (this.byId("reasonDialog") as Dialog).close();
  }

  private async act(action: string, parameters: Readonly<Record<string, string>>): Promise<void> {
    const done = await this.run(async () => {
      await this.call(action, { finding: this.viewModel.getProperty("/selectedId"), ...parameters });
      await this.load();
    });
    if (done && !this.destroyed) MessageToast.show(this.t("saved"));
  }

  /** One short chime, for something urgent. */
  private chime(): void {
    if (!this.audio) return;
    const start = this.audio.currentTime;
    const oscillator = this.audio.createOscillator();
    const gain = this.audio.createGain();
    oscillator.frequency.value = 784;
    gain.gain.setValueAtTime(0.25, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 1);
    oscillator.connect(gain).connect(this.audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 1);
  }
}
