import Log from "sap/base/Log";
import type ResourceBundle from "sap/base/i18n/ResourceBundle";
import type Dialog from "sap/m/Dialog";
import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import type Event from "sap/ui/base/Event";
import type Control from "sap/ui/core/Control";
import type { ValueState } from "sap/ui/core/library";
import DateFormat from "sap/ui/core/format/DateFormat";
import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import type Context from "sap/ui/model/odata/v4/Context";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import type { MapPlace } from "../control/VillageMap";
import Alarm from "../model/Alarm";
import { listFor, openCamera, toPhoto, upload } from "../model/captureEvidence";
import Speech, { type Command } from "../model/Speech";

type Tier = "alarm" | "unknown" | "thisWeek" | "ok";

/** A pipe as the water service returns it. */
interface Pipe {
  ID: string;
  pipeID: string;
  mapPath: string;
  startPoint: string;
  endPoint: string;
  currentFlowRate: string | number | null;
  currentPressure: string | number | null;
  tier: Tier;
  rank: number | null;
  jobSlot: number | null;
  flowPercent: number | null;
  affects: string;
  upstreamOf: string;
  isBackup: boolean;
  readingsFresh: boolean;
  readingAgeMinutes: number | null;
  sendToIlse: boolean;
  repairedToday: boolean;
  deferredToday: boolean;
  carriedSince: string | null;
  carriedReason: string | null;
}

const PIPE_FIELDS = [
  "ID", "pipeID", "mapPath", "startPoint", "endPoint", "currentFlowRate", "currentPressure", "tier", "rank", "jobSlot", "flowPercent", "affects", "upstreamOf",
  "isBackup", "readingsFresh", "readingAgeMinutes", "sendToIlse", "repairedToday", "deferredToday", "carriedSince", "carriedReason",
];
const REFRESH_MS = 20_000;
const ALARM_SPEECH_MS = 9_000;
const CONFIRM_MS = 5_000;
const LONG_PRESS_MS = 800;

const TIERS: Readonly<Record<Tier, { text: string; state: keyof typeof ValueState; icon: string }>> = {
  alarm: { text: "tierAlarm", state: "Error", icon: "sap-icon://alert" },
  unknown: { text: "tierUnknown", state: "None", icon: "sap-icon://question-mark" },
  thisWeek: { text: "tierThisWeek", state: "Warning", icon: "sap-icon://calendar" },
  ok: { text: "tierOk", state: "Success", icon: "sap-icon://accept" },
};

/** "NORTH-BRANCH-02" → "North Branch 02" */
function displayName(pipeID: string): string {
  return pipeID.toLowerCase().replace(/(^|-)(\w)/g, (_match, dash: string, letter: string) => (dash ? " " : "") + letter.toUpperCase());
}

/**
 * Today's Route: where the crew goes first, next, and why.
 *
 * The rank is computed by the service for all pipes together and cannot be sorted on in the
 * database, so the pipes are read here, sorted, and shown through the "view" model.
 *
 * @namespace oakhaven.waterroute.controller
 */
export default class Main extends Controller {
  private viewModel!: JSONModel;
  private bundle!: ResourceBundle;
  private pipes: Pipe[] = [];
  private readonly alarm = new Alarm();
  private readonly speech = new Speech((command) => this.onCommand(command), () => MessageToast.show(this.text("micBlocked")));
  private readonly timers: number[] = [];
  private knownAlarms?: Set<string>;
  private readonly alarmQueue: Pipe[] = [];
  private alarmSpeech?: number;
  private confirmTimer?: number;
  private pressTimer?: number;
  private wakeLock?: WakeLockSentinel;
  private spokenIndex = 0;
  private logMode: "done" | "defer" = "done";
  private logPipe?: Pipe;
  private photoPipe?: Pipe;
  private destroyed = false;
  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible" && this.viewModel.getProperty("/started")) void this.keepScreenOn();
  };

  public onInit(): void {
    this.viewModel = new JSONModel({
      mapUrl: sap.ui.require.toUrl("oakhaven/waterroute/img/oakhaven-map.jpg"),
      now: new Date(),
      busy: true,
      lost: false,
      started: false,
      glove: false,
      confirm: false,
      gloveText: "",
      alarmText: "",
      emptyText: "",
      emptySubText: "",
      workingText: "",
      cards: [],
      current: null,
      jobs: [],
      notes: [],
      mapPipes: [],
      selectedId: "",
      highlighted: [],
      info: null,
      mapPlaces: [],
      dialog: { title: "", text: "", save: "", options: [] },
      photo: { title: "", busy: false, items: [] },
      demoPipe: "",
      demoPipes: [],
    });
    this.getView()?.setModel(this.viewModel, "view");

    // Hidden demo panel: hold the title for a moment.
    const title = this.byId("title") as Control;
    title.attachBrowserEvent("pointerdown", () => {
      this.pressTimer = window.setTimeout(() => (this.byId("demoDialog") as Dialog).open(), LONG_PRESS_MS);
    });
    title.attachBrowserEvent("pointerup pointerleave pointercancel", () => window.clearTimeout(this.pressTimer));

    document.addEventListener("visibilitychange", this.onVisibility);
    void this.startUp();
  }

  public onExit(): void {
    this.destroyed = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.timers.forEach((timer) => window.clearInterval(timer));
    [this.alarmSpeech, this.confirmTimer, this.pressTimer].forEach((timer) => window.clearTimeout(timer));
    this.speech.stop();
    this.alarm.destroy();
    void this.wakeLock?.release();
  }

  // ---- data ------------------------------------------------------------------------------

  private async startUp(): Promise<void> {
    this.bundle = await (this.getOwnerComponent()?.getModel("i18n") as ResourceModel).getResourceBundle();
    await this.refresh();
    if (this.destroyed) return;
    this.timers.push(window.setInterval(() => void this.refresh(), REFRESH_MS));
  }

  private model(): ODataModel {
    return this.getOwnerComponent()?.getModel() as ODataModel;
  }

  private async readPipes(): Promise<Pipe[]> {
    const contexts = await this.model()
      .bindList("/WaterPipes", undefined, [], [], { $select: PIPE_FIELDS.join(",") })
      .requestContexts(0, 100);
    return contexts.map((context) => context.getObject() as Pipe);
  }

  private async refresh(): Promise<void> {
    try {
      const pipes = await this.readPipes();
      if (this.destroyed) return;
      this.pipes = pipes.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.pipeID.localeCompare(b.pipeID));
      if ((this.viewModel.getProperty("/mapPlaces") as MapPlace[]).length === 0) await this.readPlaces();
      if (this.destroyed) return;
      this.viewModel.setProperty("/lost", false);
      this.show();
      this.detectAlarms();
    } catch (error) {
      Log.error("Could not read the pipes", String(error));
      if (this.destroyed) return;
      // Old readings are not fine readings: say so instead of pretending.
      if (!this.viewModel.getProperty("/lost")) this.speech.say(this.text("sayConnection"));
      this.viewModel.setProperty("/lost", true);
    } finally {
      this.viewModel.setProperty("/busy", false);
      this.viewModel.setProperty("/now", new Date());
    }
  }

  private async readPlaces(): Promise<void> {
    const contexts = await this.model()
      .bindList("/Landmarks", undefined, [], [], { $select: "name,kind,gridCell,suppliedBy,servicePriority" })
      .requestContexts(0, 100);
    this.viewModel.setProperty("/mapPlaces", contexts.map((context): MapPlace => {
      const place = context.getObject() as { name: string; kind: string; gridCell: string; suppliedBy: string | null; servicePriority: number | null };
      const lines = this.pipes.filter((pipe) => !pipe.isBackup);
      const pipe = this.pipes.find((item) => item.pipeID === place.suppliedBy)
        ?? lines.find((item) => item.endPoint === place.name) ?? lines.find((item) => item.startPoint === place.name);
      return { name: place.name, kind: place.kind, gridCell: place.gridCell, served: place.servicePriority !== null, pipeId: pipe?.ID ?? "" };
    }));
  }

  // ---- what is shown ---------------------------------------------------------------------

  private show(): void {
    const jobs = this.jobs();
    const current = jobs[0];
    this.viewModel.setProperty("/current", current ? current.ID : null);
    this.viewModel.setProperty("/jobs", jobs.map((pipe) => ({
      id: pipe.ID,
      slot: pipe.jobSlot,
      name: displayName(pipe.pipeID),
      tier: pipe.tier,
      tierText: this.text(TIERS[pipe.tier].text),
      state: TIERS[pipe.tier].state,
      icon: TIERS[pipe.tier].icon,
      readings: this.readingsText(pipe),
      affects: pipe.isBackup ? this.text("backup") : pipe.affects,
      action: this.actionText(pipe),
      upstream: this.upstreamText(pipe),
      waiting: this.waitingText(pipe),
    })));
    const anyFlagged = this.pipes.some((pipe) => pipe.tier !== "ok");
    this.viewModel.setProperty("/emptyText", current ? "" : this.text(anyFlagged ? "allDone" : "nothingToDo"));
    const working = this.pipes.filter((pipe) => pipe.repairedToday && pipe.tier === "ok").map((pipe) => displayName(pipe.pipeID));
    this.viewModel.setProperty("/workingText", working.length > 0 ? this.text("workingAgain", working.join(", ")) : "");
    const jobsDone = this.pipes.filter((pipe) => pipe.repairedToday).length;
    this.viewModel.setProperty("/emptySubText", jobsDone > 0 ? this.text("jobsLogged", jobsDone) : "");
    this.viewModel.setProperty("/cards", this.cards());
    this.viewModel.setProperty("/notes", this.notes());
    this.viewModel.setProperty("/mapPipes", this.pipes.map((pipe) => ({
      id: pipe.ID, label: this.text("mapPipe", displayName(pipe.pipeID), this.text(TIERS[pipe.tier].text)), mapPath: pipe.mapPath, tier: pipe.tier, flow: Number(pipe.currentFlowRate ?? 0), slot: pipe.jobSlot,
    })));
    this.showSelected();
    const demoPipes = this.pipes.map((pipe) => ({ pipeID: pipe.pipeID, name: displayName(pipe.pipeID) }));
    demoPipes.sort((a, b) => a.name.localeCompare(b.name));
    this.viewModel.setProperty("/demoPipes", demoPipes);
    if (!this.viewModel.getProperty("/demoPipe")) this.viewModel.setProperty("/demoPipe", "BAKERY-BRANCH");
    if (!current) this.viewModel.setProperty("/glove", false);
    this.showGloveText();
  }

  // ---- map -------------------------------------------------------------------------------

  public onMapSelect(event: Event): void {
    this.select((event.getParameters() as { pipe: string }).pipe);
  }

  public onShowOnMap(event: Event): void {
    this.select((event.getSource() as Control).getBindingContext("view")?.getProperty("id") as string);
    (this.byId("map") as Control).getDomRef()?.scrollIntoView({ block: "nearest" });
  }

  public onMapClose(): void {
    this.select("");
  }

  private select(id: string): void {
    this.viewModel.setProperty("/selectedId", id);
    this.showSelected();
    const pipe = this.pipes.find((item) => item.ID === id);
    // During the shift the answer is also spoken, so nobody has to read it.
    if (pipe && this.viewModel.getProperty("/started")) {
      this.speech.say(this.text("sayPipe", displayName(pipe.pipeID), this.text(TIERS[pipe.tier].text).toLowerCase(), this.spokenReadings(pipe)));
    }
  }

  /** Fills the panel on the map; also after a refresh, so it never shows old readings. */
  private showSelected(): void {
    const pipe = this.pipes.find((item) => item.ID === this.viewModel.getProperty("/selectedId"));
    this.viewModel.setProperty("/highlighted", pipe ? this.waterWay(pipe).map((item) => item.ID) : []);
    if (!pipe) {
      this.viewModel.setProperty("/info", null);
      return;
    }
    const { text, state, icon } = TIERS[pipe.tier];
    // The panel goes where the pipe is not. Grid rows count from the south, 8 in total.
    const rows = pipe.mapPath.split(" ").map((pair) => Number(pair.split(",")[1]));
    const inNorth = rows.reduce((sum, row) => sum + row, 0) / rows.length > 4;
    const repaired = pipe.tier === "ok" ? "repairedOk" : pipe.tier === "unknown" ? "repairedUnknown" : "repairedStill";
    this.viewModel.setProperty("/info", {
      name: displayName(pipe.pipeID),
      tier: pipe.tier,
      tierText: this.text(text),
      state,
      icon,
      place: inNorth ? "bottom" : "top",
      readings: this.readingsText(pipe),
      affects: pipe.isBackup ? this.text("backup") : this.text("mapFeeds", pipe.affects),
      extra: [pipe.repairedToday ? this.text(repaired) : "", pipe.sendToIlse ? this.text("ilseText") : ""].filter(Boolean).join(" · "),
    });
  }

  /** The pipe and every pipe the water passes on its way there from the spring. */
  private waterWay(pipe: Pipe): Pipe[] {
    const way = [pipe];
    if (pipe.isBackup) return way;
    for (const current of way) {
      for (const before of this.pipes) {
        if (before.endPoint === current.startPoint && !before.isBackup && !way.includes(before)) way.push(before);
      }
    }
    return way;
  }

  private jobs(): Pipe[] {
    return this.pipes.filter((pipe) => pipe.jobSlot !== null);
  }

  /** What is left to know once there are no more jobs, in the same style as the jobs. */
  private cards(): { id: string; tier: string; name: string; badge: string; state: string; icon: string; text: string }[] {
    const cards = this.pipes
      .filter((pipe) => pipe.tier !== "ok") // repaired and fine again: one line in the banner
      .map((pipe) => {
        const { state, icon, text: badge } = TIERS[pipe.tier];
        let text = this.text(pipe.isBackup ? "actionBackup" : "laterDay");
        if (pipe.repairedToday) {
          text = this.text(pipe.tier === "unknown" ? "repairedUnknown" : "repairedStill");
        } else if (pipe.deferredToday) {
          text = this.text("deferred");
        }
        return { id: pipe.ID, tier: pipe.tier as string, name: displayName(pipe.pipeID), badge: this.text(badge), state: state as string, icon, text };
      });
    for (const pipe of this.pipes.filter((item) => item.sendToIlse)) {
      cards.push({
        id: pipe.ID, tier: "ilse", name: displayName(pipe.pipeID), badge: this.text("ilseBadge"), state: "Information",
        icon: "sap-icon://forward", text: this.text("ilseText"),
      });
    }
    return cards;
  }

  private notes(): { text: string; icon: string; state: string }[] {
    const notes = this.pipes
      .filter((pipe) => pipe.jobSlot === null && (pipe.tier !== "ok" || pipe.repairedToday))
      .map((pipe) => {
        const name = displayName(pipe.pipeID);
        const { state, icon } = TIERS[pipe.tier];
        const tier = this.text(TIERS[pipe.tier].text).toLowerCase();
        let text: string;
        if (pipe.repairedToday) {
          const key = pipe.tier === "ok" ? "repairedOk" : pipe.tier === "unknown" ? "repairedUnknown" : "repairedStill";
          text = this.text("noteItem", name, this.text(key));
        } else if (pipe.deferredToday) {
          text = this.text("noteItem", name, this.text("deferred"));
        } else {
          text = pipe.isBackup ? this.text("laterBackup", name, tier) : this.text("laterItem", name, tier);
        }
        return { text, icon, state: state as string };
      });
    for (const pipe of this.pipes.filter((item) => item.sendToIlse)) {
      notes.push({ text: this.text("sentToIlse", displayName(pipe.pipeID)), icon: "sap-icon://forward", state: "None" });
    }
    return notes;
  }

  private readingsText(pipe: Pipe): string {
    if (pipe.tier === "unknown") {
      return pipe.readingsFresh || pipe.readingAgeMinutes === null
        ? this.text("readingsUnknown") : this.text("readingsOld", pipe.readingAgeMinutes);
    }
    return this.text("readings", pipe.flowPercent ?? "", Number(pipe.currentPressure));
  }

  /** What to do, from Maren's own rules. Only the first job can be "drop everything". */
  private actionText(pipe: Pipe): string {
    if (pipe.isBackup) return this.text("actionBackup");
    if (pipe.tier === "alarm") {
      const first = this.jobs()[0];
      return first && first !== pipe ? this.text("actionAlarmNext", displayName(first.pipeID)) : this.text("actionAlarm");
    }
    return this.text(pipe.tier === "unknown" ? "actionUnknown" : "actionThisWeek");
  }

  private upstreamText(pipe: Pipe): string {
    if (!pipe.upstreamOf) return "";
    return this.text("upstream", pipe.upstreamOf.split(",").map(displayName).join(", "));
  }

  private waitingText(pipe: Pipe): string {
    if (!pipe.carriedSince) return "";
    const day = DateFormat.getDateInstance({ pattern: "EEEE" }).format(new Date(pipe.carriedSince));
    return pipe.carriedReason ? this.text("waitingBecause", day, pipe.carriedReason) : this.text("waitingSince", day);
  }

  private showGloveText(): void {
    const job = this.jobs()[0];
    if (!job) return;
    const confirm = this.viewModel.getProperty("/confirm") as boolean;
    this.viewModel.setProperty("/gloveText", [
      this.text("current", job.jobSlot ?? "", displayName(job.pipeID)),
      this.text(TIERS[job.tier].text),
      this.readingsText(job),
      this.actionText(job),
      "",
      this.text(confirm ? "gloveConfirm" : "gloveHint"),
    ].join("\n"));
  }

  // ---- shift, speech and alarm -----------------------------------------------------------

  public onStartShift(): void {
    this.viewModel.setProperty("/started", true);
    this.alarm.unlock();
    void this.keepScreenOn();
    this.speech.start();
    this.spokenIndex = 0;
    this.sayRoute();
  }

  public onEndShift(): void {
    this.viewModel.setProperty("/started", false);
    this.alarmQueue.length = 0;
    this.closeAlarm();
    this.speech.stop();
    void this.wakeLock?.release();
    this.wakeLock = undefined;
  }

  private async keepScreenOn(): Promise<void> {
    try {
      this.wakeLock = await navigator.wakeLock?.request("screen");
    } catch (error) {
      Log.info("Screen can go to sleep", String(error));
    }
  }

  private sayRoute(): void {
    const parts = this.jobs().map((pipe, index) => this.spoken(pipe, index === 0 ? "sayFirst" : "sayNext"));
    this.speech.say(this.viewModel.getProperty("/lost") ? this.text("sayConnection") : parts.join(" ") || this.text("sayNothing"));
  }

  private spoken(pipe: Pipe, key: string): string {
    const places = pipe.affects.replace(/ \(([^)]*)\)/g, ", $1");
    const textKey = pipe.isBackup ? key.replace("say", "sayBackup") : key;
    return this.text(textKey, displayName(pipe.pipeID), this.spokenReadings(pipe), places, this.actionText(pipe), pipe.upstreamOf ? `${this.upstreamText(pipe)}.` : "");
  }

  private spokenReadings(pipe: Pipe): string {
    if (pipe.tier !== "unknown") return this.text("sayReadings", pipe.flowPercent ?? "", Number(pipe.currentPressure));
    return pipe.readingsFresh || pipe.readingAgeMinutes === null
      ? this.text("sayUnknown") : this.text("sayUnknownMinutes", pipe.readingAgeMinutes);
  }

  private onCommand(command: Command): void {
    if (this.viewModel.getProperty("/alarmText")) {
      if (command.name === "ok") this.onAlarmOk();
      return;
    }
    const jobs = this.jobs();
    switch (command.name) {
      case "done":
        if (command.detail && jobs[0]) void this.log("done", jobs[0], command.detail);
        else this.onDone();
        break;
      case "cantToday":
        if (command.detail && jobs[0]) void this.log("defer", jobs[0], command.detail);
        else this.onDefer();
        break;
      case "next":
        this.spokenIndex = Math.min(this.spokenIndex + 1, Math.max(0, jobs.length - 1));
        this.speech.say(jobs.length ? this.spoken(jobs[this.spokenIndex], this.spokenIndex ? "sayNext" : "sayFirst") : this.text("sayNothing"));
        break;
      case "repeat":
        this.spokenIndex = 0;
        this.sayRoute();
        break;
      default:
        break;
    }
  }

  /** Interrupts for every pipe people depend on that was not in alarm the last time we looked. */
  private detectAlarms(): void {
    const alarms = this.pipes.filter((pipe) => pipe.tier === "alarm" && !pipe.isBackup);
    const fresh = alarms.filter((pipe) => this.knownAlarms && !this.knownAlarms.has(pipe.pipeID));
    this.knownAlarms = new Set(alarms.map((pipe) => pipe.pipeID));
    if (!this.viewModel.getProperty("/started") || fresh.length === 0) return;
    this.alarmQueue.push(...fresh);
    if (!this.viewModel.getProperty("/alarmText")) this.nextAlarm();
  }

  private nextAlarm(): void {
    const pipe = this.alarmQueue.shift();
    if (!pipe) return;
    const name = displayName(pipe.pipeID);
    ["logDialog", "demoDialog", "photoDialog"].forEach((id) => (this.byId(id) as Dialog).close());
    this.viewModel.setProperty("/alarmText", [
      this.text("alarmTitle"), name, this.readingsText(pipe), pipe.affects, this.actionText(pipe), "", this.text("alarmOk"),
    ].join("\n"));
    const say = (): void => this.speech.say(this.text("sayAlarm", name, this.spokenReadings(pipe), this.actionText(pipe)));
    this.alarm.start();
    say();
    this.alarmSpeech = window.setInterval(say, ALARM_SPEECH_MS);
  }

  private closeAlarm(): void {
    window.clearInterval(this.alarmSpeech);
    this.alarm.stop();
    this.viewModel.setProperty("/alarmText", "");
  }

  public onAlarmOk(): void {
    this.closeAlarm();
    if (this.alarmQueue.length > 0) this.nextAlarm();
    else this.sayRoute();
  }

  // ---- done / can't today ----------------------------------------------------------------

  public onGloveOn(): void {
    this.viewModel.setProperty("/glove", true);
  }

  public onGloveOff(): void {
    this.setConfirm(false);
    this.viewModel.setProperty("/glove", false);
  }

  /** The first tap asks, the second one counts: a glove easily taps by accident. */
  public onGlovePress(): void {
    if (!this.viewModel.getProperty("/confirm")) {
      this.setConfirm(true);
      return;
    }
    this.setConfirm(false);
    this.onDone();
  }

  private setConfirm(confirm: boolean): void {
    window.clearTimeout(this.confirmTimer);
    this.viewModel.setProperty("/confirm", confirm);
    this.showGloveText();
    if (confirm) this.confirmTimer = window.setTimeout(() => this.setConfirm(false), CONFIRM_MS);
  }

  public onDone(): void {
    const pipe = this.jobs()[0];
    if (pipe) this.openLog("done", pipe, ["issueJoint", "issueSilt", "issueSeal", "issueOther"].map((key) => this.text(key)));
  }

  public onDefer(): void {
    const pipe = this.jobs()[0];
    if (pipe) this.openLog("defer", pipe, ["reasonParts", "reasonReach", "reasonTime"].map((key) => this.text(key)));
  }

  private openLog(mode: "done" | "defer", pipe: Pipe, options: readonly string[]): void {
    this.logMode = mode;
    this.logPipe = pipe;
    this.viewModel.setProperty("/dialog", {
      title: this.text(mode === "done" ? "doneTitle" : "deferTitle", displayName(pipe.pipeID)),
      text: "",
      save: this.text(mode === "done" ? "saveRepair" : "saveDefer"),
      options: options.map((text) => ({ text })),
    });
    (this.byId("logDialog") as Dialog).open();
  }

  /**
   * Only selects: the save button logs it, so one accidental tap never uses up a job.
   * In glove mode one tap logs: the tap before was already confirmed, and there is nothing to type.
   */
  public onLogOption(event: Event): void {
    const text = (event.getSource() as Control).getBindingContext("view")?.getProperty("text") as string;
    if (this.viewModel.getProperty("/glove")) void this.saveLog(text);
    else this.viewModel.setProperty("/dialog/text", text);
  }

  public onLogSave(): void {
    void this.saveLog((this.viewModel.getProperty("/dialog/text") as string).trim());
  }

  public onLogCancel(): void {
    (this.byId("logDialog") as Dialog).close();
  }

  private async saveLog(text: string): Promise<void> {
    if (!text || !this.logPipe) return;
    (this.byId("logDialog") as Dialog).close();
    await this.log(this.logMode, this.logPipe, text);
  }

  private async log(mode: "done" | "defer", pipe: Pipe, text: string): Promise<void> {
    if (this.viewModel.getProperty("/busy")) return;
    this.viewModel.setProperty("/busy", true);
    try {
      const context = this.model().bindContext(`/WaterPipes(${pipe.ID})`).getBoundContext() as Context;
      const name = mode === "done" ? "logRepair" : "deferJob";
      const action = this.model().bindContext(`WaterSupplyService.${name}(...)`, context);
      action.setParameter(mode === "done" ? "issue" : "reason", text);
      await action.invoke();
      const message = this.text(mode === "done" ? "repairLogged" : "deferLogged", text);
      MessageToast.show(message);
      await this.refresh();
      const next = this.jobs()[0];
      this.spokenIndex = 0;
      this.speech.say(`${message}. ${next ? this.spoken(next, "sayNext") : this.text("sayNothing")}`);
    } catch (error) {
      this.showError(error);
    } finally {
      this.viewModel.setProperty("/busy", false);
    }
  }

  // ---- photos ----------------------------------------------------------------------------

  public onPhotos(event: Event): void {
    // A card knows its pipe; the panel on the map shows the selected one.
    const card = (event.getSource() as Control).getBindingContext("view");
    const id = (card ? card.getProperty("id") : this.viewModel.getProperty("/selectedId")) as string;
    this.photoPipe = this.pipes.find((pipe) => pipe.ID === id);
    if (!this.photoPipe) return;
    this.viewModel.setProperty("/photo", { title: this.text("photosOf", displayName(this.photoPipe.pipeID)), busy: false, items: [] });
    (this.byId("photoDialog") as Dialog).open();
    void this.loadPhotos();
  }

  public onPhotoBefore(): void {
    this.takePhoto(this.text("photoBefore"));
  }

  public onPhotoAfter(): void {
    this.takePhoto(this.text("photoAfter"));
  }

  public onPhotoClose(): void {
    (this.byId("photoDialog") as Dialog).close();
  }

  private takePhoto(note: string): void {
    const pipe = this.photoPipe;
    if (pipe) openCamera((file) => void this.storePhoto(pipe, note, file));
  }

  private async storePhoto(pipe: Pipe, note: string, file: File): Promise<void> {
    this.viewModel.setProperty("/photo/busy", true);
    try {
      await upload("WaterPipe", pipe.ID, note, "Maren Holt", await toPhoto(file));
      await this.loadPhotos();
    } catch (error) {
      this.showError(error);
    } finally {
      this.viewModel.setProperty("/photo/busy", false);
    }
  }

  private async loadPhotos(): Promise<void> {
    const pipe = this.photoPipe;
    if (!pipe) return;
    try {
      const items = await listFor("WaterPipe", [pipe.ID]);
      if (this.photoPipe === pipe && !this.destroyed) this.viewModel.setProperty("/photo/items", items);
    } catch (error) {
      Log.warning("Could not read the photos", String(error));
    }
  }

  // ---- demo ------------------------------------------------------------------------------

  public async onDemo(scenario: string): Promise<void> {
    (this.byId("demoDialog") as Dialog).close();
    try {
      const action = this.model().bindContext(scenario ? "/demoSet(...)" : "/demoReset(...)");
      if (scenario) {
        action.setParameter("pipeID", this.viewModel.getProperty("/demoPipe"));
        action.setParameter("scenario", scenario);
      }
      await action.invoke();
      await this.refresh();
    } catch (error) {
      this.showError(error);
    }
  }

  public onDemoClose(): void {
    (this.byId("demoDialog") as Dialog).close();
  }

  // ---- helpers ---------------------------------------------------------------------------

  private showError(error: unknown): void {
    MessageBox.error(error instanceof Error ? error.message : String(error));
  }

  private text(key: string, ...values: (string | number)[]): string {
    // Without values the text is taken as is; with values, an apostrophe in it must be doubled.
    return this.bundle.getText(key, values.length > 0 ? values : undefined) ?? key;
  }
}
