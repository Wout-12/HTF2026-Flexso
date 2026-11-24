import type { Budget, Copy, Decision, Doubt, FoodLine, HelpLine, MoneyLine, PipeLine, Place, Sheet, Verdict } from "./types";

export type Text = (key: string, ...values: (string | number)[]) => string;

export interface VerdictText { readonly name: string; readonly verdict: string; readonly evidence: string; readonly lines: readonly string[] }
export interface RowText {
  readonly key: string; readonly number: string; readonly title: string; readonly name: string; readonly crowns: string; readonly why: string; readonly ifNo: string; readonly notes: string; readonly text: string; readonly ticked: Decision | null;
}
export interface TableText { readonly title: string; readonly head: readonly string[]; readonly rows: readonly (readonly string[])[] }

/** The screen: the same sheet, shorter, to prepare the meeting. */
export interface Overview {
  readonly meta: string;
  readonly verdicts: readonly { name: string; verdict: string; evidence: string; state: string; icon: string; lines: readonly { text: string }[] }[];
  readonly total: string; readonly rest: string; readonly restState: string; readonly restIcon: string; readonly oneCart: string;
  readonly weekly: number; readonly weeklyText: string; readonly parts: readonly { kind: string; label: string; crowns: number }[];
  readonly lines: readonly { number: string; title: string; crowns: string; why: string; ifNo: string; notes: string; tick: string; tickState: string; tickIcon: string }[];
  readonly notes: readonly { text: string }[]; readonly options: string; readonly doubts: readonly { text: string }[];
  readonly help: readonly { text: string }[]; readonly helpRows: readonly { title: string; detail: string; label: string; state: string }[]; readonly agenda: string;
}

/** Everything that is printed, as plain text. */
export interface SheetText {
  readonly head: readonly string[]; readonly flags: readonly string[]; readonly verdicts: readonly VerdictText[];
  readonly moneyTitle: string; readonly columns: readonly string[]; readonly rows: readonly RowText[]; readonly moneyNotes: readonly string[];
  readonly totals: readonly string[]; readonly saidLabel: string; readonly said: string; readonly ofBudget: string;
  readonly doubtsTitle: string; readonly doubts: readonly string[];
  readonly agendaTitle: string; readonly agenda: readonly string[]; readonly choices: readonly { text: string; checked: boolean }[];
  readonly helpTitle: string; readonly help: readonly string[]; readonly helpRows: readonly (readonly string[])[];
  readonly purse: string; readonly typedIn: string; readonly typed: boolean;
  readonly backTitle: string; readonly tables: readonly TableText[]; readonly reserveTitle: string; readonly backNotes: readonly string[]; readonly reserves: readonly string[];
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Brussels" });
/** Suspicious edits are quoted as the record has them, so everybody talks about the same 03:13. */
const recordFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
export const day = (date: string | null): string => (date ? dayFormat.format(new Date(`${date}T00:00:00Z`)) : "");
export const time = (at: string | null): string => (at ? timeFormat.format(new Date(at)).replace(/,/g, "") : "");
const record = (at: string | null): string => (at ? recordFormat.format(new Date(at)).replace(/,/g, "") : "?");
export const pipeName = (pipeID: string | null): string =>
  (pipeID ?? "").toLowerCase().replace(/(^|-)(\w)/g, (_match, dash: string, letter: string) => (dash ? " " : "") + letter.toUpperCase());
const UNITS: Readonly<Record<string, string>> = { KG: " kg", L: " L", Dozen: " dozen", Number: "" };
const amount = (value: number, unit: string): string => `${Math.round(value * 100) / 100}${UNITS[unit] ?? ` ${unit}`}`;

function joined(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const VERDICTS: Readonly<Record<Verdict, string>> = { allRight: "vAllRight", notAllRight: "vNotAllRight", notYet: "vNotYet", atRisk: "vAtRisk", cantTell: "vCantTell" };
const STATES: Readonly<Record<string, string>> = { badlyShort: "stBadlyShort", runningLow: "stRunningLow", cantTell: "stCantTell", fine: "stFine" };
const LABELS: Readonly<Record<string, string>> = {
  back: "hBack", improved: "hImproved", none: "hNone", worse: "hWorse", notCompleted: "hNotCompleted", cantTell: "hCantTell", released: "hReleased", held: "hHeld", bufferPending: "hBufferPending",
};

export function lineTitle(line: MoneyLine, t: Text): string {
  if (line.kind === "buffer") return t("lineBuffer");
  if (line.kind === "reserve") return t("lineCart", line.supplier ?? "");
  return t(line.kind === "approve" ? "lineRepair" : "lineRepairIf", pipeName(line.pipe?.pipeID ?? ""));
}

function waterText(sheet: Sheet, t: Text): VerdictText {
  const full = (place: Place): string => (place.note ? t("placeWith", place.name, place.note) : place.name);
  const lines: string[] = [];
  for (const area of sheet.water.areas.filter((item) => item.state !== "fine")) {
    const values = (pipe: PipeLine): [string, number, number] => [pipeName(pipe.pipeID), pipe.flowPercent ?? 0, pipe.pressure ?? 0];
    const parts: string[] = [];
    if (!area.worst) parts.push(t("aNoPath", full(area)));
    else if (area.state === "cantTell") parts.push(t("aCantTell", full(area), pipeName(area.worst.pipeID)));
    else parts.push(t(area.state === "badlyShort" ? "aBadlyShort" : "aRunningLow", full(area), ...values(area.worst)));
    for (const pipe of area.also) {
      parts.push(pipe.tier === "unknown" ? t("aAlsoStale", pipeName(pipe.pipeID)) : t("aAlso", pipeName(pipe.pipeID), `${pipe.flowPercent}%, ${pipe.pressure} PSI`));
    }
    lines.push(parts.join(" "));
  }
  const fine = sheet.water.areas.filter((area) => area.state === "fine").map((area) => area.name);
  if (fine.length > 0) lines.push(t("aFine", joined(fine)));
  const evidence = sheet.water.readingAt ? t("waterReadings", time(sheet.water.readingAt)) : t("waterNoReadings");
  return { name: t("water"), verdict: t(VERDICTS[sheet.water.verdict]), evidence, lines };
}

function foodText(sheet: Sheet, t: Text): VerdictText {
  const { lines, verdict, unreliable } = sheet.food;
  const texts: string[] = [];
  const named = (items: readonly FoodLine[]): string => joined(items.map((line) => line.name));
  for (const line of lines.filter((item) => item.state === "notAllRight")) texts.push(t("foodNotAllRight", line.name, day(line.runsOutOn)));
  const notYet = lines.filter((line) => line.state === "notYet");
  if (notYet.length > 0) texts.push(t(notYet.length === 1 ? "foodNotYetOne" : "foodNotYet", named(notYet)));
  for (const line of lines.filter((item) => item.state === "atRisk" || (item.state === "unreliable" && item.runsOutOn !== null && item.orderedFor !== null))) {
    texts.push(`${t("foodAtRisk", line.name, day(line.runsOutOn), day(line.orderedFor))}${line.timingUncertain ? ` ${t("foodTiming")}` : ""}`);
  }
  if (unreliable > 0) {
    const ages = lines.filter((line) => !line.reliable && line.state !== "doubtful" && line.ageDays !== null).map((line) => line.ageDays ?? 0);
    const range = ages.length === 0 ? "?" : Math.min(...ages) === Math.max(...ages) ? String(ages[0]) : `${Math.min(...ages)}-${Math.max(...ages)}`;
    texts.push(t("foodUnreliable", unreliable, lines.length, range));
    const scenario = lines.filter((line) => line.state === "unreliable" && line.runsOutOn !== null && line.orderedFor === null);
    if (scenario.length > 0) texts.push(t(scenario.length === 1 ? "foodScenarioOne" : "foodScenario", named(scenario)));
  }
  if (texts.length === 0) texts.push(t("foodFine"));
  const counted = lines.filter((line) => line.source === "counted").length;
  return { name: t("food"), verdict: t(verdict === "cantTell" ? "vCantTellFood" : VERDICTS[verdict]), evidence: t("foodEvidence", counted, lines.length), lines: texts };
}

function rowText(line: MoneyLine, index: number, t: Text, copy: Copy | null): RowText {
  const names = line.everyone ? t("everyone") : joined(line.places.map((place) => place.name));
  const who = line.everyone ? t("everyone") : joined(line.places.map((place) => place.note ?? place.name));
  const [percent, pressure] = [line.pipe?.flowPercent ?? 0, line.pipe?.pressure ?? 0];
  const texts: Readonly<Record<MoneyLine["kind"], [string, string]>> = {
    approve: [t("whyShort", who, percent, pressure), t("noShort", names)],
    approveIf: [t("whyLow", who, percent, pressure), t("noLow", names, percent)],
    buffer: [t("whyBuffer"), t("noBuffer")],
    reserve: [t("whyCart"), t("noCart")],
  };
  const notes: string[] = [];
  if (line.oneCart !== null) notes.push(t("whyOneCart", line.oneCart));
  if (line.checkAfter.length > 0) notes.push(t("checkAfter", joined(line.checkAfter.map(pipeName))));
  if (line.history) notes.push(t({ yes: "wasYes", no: "wasNo", later: "wasLater" }[line.history.decision], day(line.history.decidedOn)));
  const decision = copy?.decisions.find((item) => item.lineKey === line.key);
  return {
    key: line.key, number: String(index + 1), title: `${lineTitle(line, t)}${line.kind === "reserve" ? ` ${t("seeBack")}` : ""}, ${t("about", line.crowns)}`,
    name: lineTitle(line, t), crowns: t("about", line.crowns), why: texts[line.kind][0], ifNo: t("ifNo", texts[line.kind][1]),
    notes: [...notes, ...(decision?.note ? [`"${decision.note}"`] : [])].join(" "),
    text: [`${texts[line.kind][0]}.`, ...notes, t("ifNo", texts[line.kind][1]), ...(decision?.note ? [`"${decision.note}"`] : [])].join(" "),
    ticked: decision?.decision ?? null,
  };
}

function totalsText(sheet: Sheet, t: Text): string[] {
  const rest = (budget: Budget): string => (budget.short > 0 ? t("totalShort", budget.short) : t("totalLeft", budget.unallocated));
  const { budget, oneCartBudget } = sheet;
  const totals = [`${t("totalAll", t("totalEqual", budget.total, budget.weekly))} = ${rest(budget)}. ${oneCartBudget ? t("totalOneCart", oneCartBudget.total, rest(oneCartBudget)) : ""}`.trim()];
  totals.push(t("split", budget.pending, budget.approve, budget.approveIf, budget.buffer, budget.reserve));
  if (sheet.options.length > 0) {
    const options = sheet.options.map((option) => {
      switch (option.kind) {
        case "askFarm": return t("oAskFarm", option.total ?? 0);
        case "smallerBuffer": return t(option.enough ? "oSmallerBufferOk" : "oSmallerBuffer", option.crowns ?? 0);
        case "wait": return t("oWait", pipeName(option.pipeID ?? ""));
        case "smallerReserve": return t("oSmallerReserve", option.crowns ?? 0, option.full ?? 0);
        default: return t("oSayNo");
      }
    });
    totals.push(`${t("options")} ${options.join("; ")}.`);
  }
  return totals;
}

function doubtText(doubt: Doubt, t: Text): string {
  if (doubt.kind === "stock") return t((doubt.value ?? 0) < 0 ? "dStockNegative" : "dStock", doubt.name, amount(doubt.value ?? 0, doubt.unit));
  if (doubt.kind === "sensor") return t("dSensor", pipeName(doubt.name), `${doubt.value} ${doubt.unit}`, `${doubt.expected} ${doubt.unit}`);
  return t("dRepair", pipeName(doubt.name), `${day(doubt.date)} ${(doubt.date ?? "").slice(0, 4)}`);
}

/** The doubtful numbers; who changed them is said once for all that share it. */
function doubtLines(doubts: readonly Doubt[], t: Text): string[] {
  const changed = (doubt: Doubt): string => t("dChanged", `"${doubt.changedBy ?? "?"}"`, record(doubt.changedAt));
  const groups = new Map<string, Doubt[]>();
  for (const doubt of doubts) groups.set(changed(doubt), [...(groups.get(changed(doubt)) ?? []), doubt]);
  return [...groups].map(([who, group]) => `${group.map((doubt) => doubtText(doubt, t)).join(" ")} ${who}`);
}

function helpRow(line: HelpLine, t: Text): string[] {
  const title = line.kind === "buffer" ? t("helpBuffer", line.crowns)
    : line.kind === "reserve" ? t("helpCart", line.crowns, line.supplier ?? "") : t("helpRepair", pipeName(line.pipeID), line.crowns);
  let values = "";
  if (line.before && line.after) values = t("helpBeforeAfter", line.before.flowPercent ?? 0, line.before.pressure ?? 0, line.after.flowPercent ?? 0, line.after.pressure ?? 0);
  else if (line.before) values = t("helpBefore", line.before.flowPercent ?? 0, line.before.pressure ?? 0);
  const work = line.work && (line.kind === "reserve" ? t("helpDelivery", time(line.work.at), line.work.what ?? "") : t("helpWork", line.work.by ?? "", time(line.work.at), line.work.what ?? ""));
  return [title, [values, work].filter(Boolean).join("; "), t(LABELS[line.label] ?? line.label)];
}

function foodRow(line: FoodLine, t: Text): string[] {
  const recorded = line.source === "noDate" ? t("noDate") : line.source === "counted" ? t("countedOn", day(line.recordedOn), line.countedBy ?? "")
    : line.source === "delivery" ? t("deliveryOn", day(line.recordedOn)) : day(line.recordedOn);
  let then = t("notThisWeek");
  if (line.state === "doubtful") then = t("stCantTell");
  else if (line.state === "baked") then = t("bakedDaily");
  else if (line.runsOutOn) then = line.orderedFor ? t("runsOutOrdered", day(line.runsOutOn), day(line.orderedFor)) : t("runsOut", day(line.runsOutOn));
  return [
    `${line.name}, ${amount(line.stock, line.unit)}`, recorded, line.ageDays === null ? "" : t("days", line.ageDays), line.lastsDays === null || line.state === "doubtful" ? "" : t("days", line.lastsDays),
    t(line.state === "doubtful" ? "rDoubtful" : line.reliable ? "rYes" : "rNo"), then,
  ];
}

function reserveText(line: MoneyLine, sheet: Sheet, t: Text): string {
  const conditions = line.products.map((product) => (product.doubtful
    ? t("condCount", product.name.toLowerCase(), amount(product.shortUnder ?? 0, product.unit)) : t("condCart", product.name.toLowerCase(), day(product.cartDue))));
  const oneCart = line.oneCart === null ? "" : t("whyOneCart", line.oneCart);
  return t("reserveText", line.crowns, line.supplier ?? "", conditions.join(t("condOr")), day(sheet.expiresOn), oneCart).replace("  ", " ");
}

export function sheetText(sheet: Sheet, copy: Copy | null, isScenario: boolean, t: Text): SheetText {
  const said = copy?.decidedAt ? sheet.lines.filter((line) => copy.decisions.some((item) => item.lineKey === line.key && item.decision === "yes")).reduce((total, line) => total + line.crowns, 0) : null;
  const rules = { marenAtOnce: t("ruleMaren", 120), askHilde: t("ruleHilde") } as Readonly<Record<string, string>>;
  const { rule } = sheet.agenda;
  const verdictName = (verdict: Verdict): string => t(VERDICTS[verdict]).toLowerCase();
  const help: string[] = [];
  if (!sheet.help) help.push(t("helpFirst"));
  else {
    help.push(sheet.help.copyNo ? t("helpSince", sheet.help.copyNo, time(sheet.help.createdAt)) : t("helpScenario"));
    help.push(t("helpVerdicts", verdictName(sheet.help.water), verdictName(sheet.water.verdict), verdictName(sheet.help.food), verdictName(sheet.food.verdict)));
    if (sheet.help.lines.length === 0) help.push(t("helpNone"));
  }
  const reserves = sheet.lines.filter((line) => line.kind === "reserve").map((line) => reserveText(line, sheet, t));
  return {
    head: [t("sheetTitle"), t("sheetPlace"), `${isScenario ? t("sheetScenario") : copy ? t("sheetCopy", copy.copyNo) : t("sheetDraft")} ${t("sheetAsOf", time(sheet.asOf), day(sheet.until))}`],
    flags: sheet.isDemo ? [t("sheetDemo")] : [],
    verdicts: [waterText(sheet, t), foodText(sheet, t)],
    moneyTitle: t("s2", sheet.budget.weekly),
    columns: [t("colLine"), t("yes"), t("no"), t("later")],
    rows: sheet.lines.map((line, index) => rowText(line, index, t, copy)),
    moneyNotes: [
      ...sheet.pending.map((item) => `${t("pendingLine", item.by ?? "", time(item.at), pipeName(item.pipeID), item.issue ?? "", item.crowns)}${item.stillFailing ? ` ${t("pendingStill")}` : ""}`),
      ...sheet.toCheck.map((pipe) => t("toCheckLine", pipeName(pipe.pipeID))),
      ...sheet.deferred.map((item) => t("deferredLine", pipeName(item.pipe.pipeID), item.crowns)),
      ...sheet.refused.map((item) => t("refusedLine", item.pipeID ? pipeName(item.pipeID) : item.supplier ?? "")),
    ],
    totals: totalsText(sheet, t),
    saidLabel: t("totalSaid"), said: said === null ? "" : String(said), ofBudget: t("ofBudget", sheet.budget.weekly),
    doubtsTitle: t("s3"),
    doubts: [...doubtLines(sheet.doubts, t), ...(sheet.food.unreliable > 0 ? [t("dUnreliable", sheet.food.unreliable, sheet.food.lines.length)] : []),
      ...(sheet.doubts.length === 0 && sheet.food.unreliable === 0 ? [t("dNone")] : [])],
    agendaTitle: t("s4"),
    agenda: rule ? [t("ruleChosen", time(rule.decidedAt), rule.decidedBy, rules[rule.choice] ?? rule.choice)] : [t("agenda"), t("agendaFacts", sheet.agenda.repairsLastYear, sheet.agenda.urgentRepairs)],
    choices: rule ? [] : [rules.marenAtOnce, rules.askHilde, t("ruleNext")].map((text) => ({ text, checked: false })),
    helpTitle: t("s5"), help, helpRows: (sheet.help?.lines ?? []).map((line) => helpRow(line, t)),
    purse: t("purse"), typedIn: t("typedIn"), typed: !!copy?.decidedAt,
    backTitle: t("sheetBack"),
    tables: [
      {
        title: t("backWater"), head: [t("colPart"), t("colPath"), t("colWorst"), t("colVerdict")],
        rows: sheet.water.areas.map((area) => [
          area.note ? t("placeWith", area.name, area.note) : area.name, area.path.map(pipeName).join(", "),
          area.worst ? `${pipeName(area.worst.pipeID)} (${area.worst.tier === "unknown" ? t("stCantTell") : `${area.worst.flowPercent}%, ${area.worst.pressure} PSI`})` : "", t(STATES[area.state]),
        ]),
      },
      { title: t("backFood"), head: ["colProduct", "colRecorded", "colAge", "colLasts", "colReliable", "colIf"].map((key) => t(key)), rows: sheet.food.lines.map((line) => foodRow(line, t)) },
    ],
    reserveTitle: t("backReserve"), reserves: reserves.length > 0 ? reserves : [t("reserveNone")],
    backNotes: [...(sheet.water.offNetwork.length > 0 ? [t("offNetwork", joined(sheet.water.offNetwork))] : []), t("orderNote"), t("assumptions")],
  };
}

const VERDICT_LOOK: Readonly<Record<Verdict, [string, string]>> = {
  allRight: ["Success", "sap-icon://accept"], notAllRight: ["Error", "sap-icon://alert"], notYet: ["Error", "sap-icon://alert"],
  atRisk: ["Warning", "sap-icon://pending"], cantTell: ["Warning", "sap-icon://question-mark"],
};
const TICK_LOOK: Readonly<Record<Decision, [string, string]>> = {
  yes: ["Success", "sap-icon://accept"], no: ["Error", "sap-icon://decline"], later: ["Information", "sap-icon://pending"],
};
const HELP_STATE: Readonly<Record<string, string>> = { back: "Success", improved: "Information", worse: "Error", notCompleted: "Warning", cantTell: "Warning", bufferPending: "Warning" };

export function overview(sheet: Sheet, text: SheetText, t: Text): Overview {
  const { budget, oneCartBudget } = sheet;
  const look = [VERDICT_LOOK[sheet.water.verdict], VERDICT_LOOK[sheet.food.verdict]];
  const toLines = (items: readonly string[]): { text: string }[] => items.map((item) => ({ text: item }));
  return {
    meta: [text.head[2], ...text.flags].join(" "),
    verdicts: text.verdicts.map((verdict, index) => ({ ...verdict, state: look[index][0], icon: look[index][1], lines: toLines(verdict.lines) })),
    total: t("totalEqual", budget.total, budget.weekly),
    rest: budget.short > 0 ? t("totalShort", budget.short) : t("totalLeft", budget.unallocated),
    restState: budget.short > 0 ? "Error" : "Success",
    restIcon: budget.short > 0 ? "sap-icon://alert" : "sap-icon://accept",
    oneCart: oneCartBudget ? t("totalOneCart", oneCartBudget.total, oneCartBudget.short > 0 ? t("totalShort", oneCartBudget.short) : t("totalLeft", oneCartBudget.unallocated)) : "",
    weekly: budget.weekly,
    weeklyText: t("barLimit", budget.weekly),
    parts: [
      { kind: "pending", label: t("barPending"), crowns: budget.pending }, { kind: "approve", label: t("barApprove"), crowns: budget.approve },
      { kind: "approveIf", label: t("barApproveIf"), crowns: budget.approveIf }, { kind: "buffer", label: t("barBuffer"), crowns: budget.buffer },
      { kind: "reserve", label: t("barReserve"), crowns: budget.reserve },
    ],
    lines: text.rows.map((row) => ({
      number: row.number, title: `${row.number} · ${row.name}`, crowns: row.crowns, why: row.why, ifNo: row.ifNo, notes: row.notes,
      tick: row.ticked ? t(row.ticked) : "", tickState: row.ticked ? TICK_LOOK[row.ticked][0] : "None", tickIcon: row.ticked ? TICK_LOOK[row.ticked][1] : "",
    })),
    notes: toLines(text.moneyNotes),
    options: sheet.options.length > 0 ? text.totals[text.totals.length - 1] : "",
    doubts: toLines(text.doubts),
    help: toLines(text.help),
    helpRows: text.helpRows.map(([title, detail, label], index) => ({ title, detail, label, state: HELP_STATE[sheet.help?.lines[index].label ?? ""] ?? "None" })),
    agenda: text.agenda.join(" "),
  };
}
