export interface Evidence {
  name: string; pipeID: string | null; unit: string; createdAt: string; createdBy: string; modifiedAt: string; modifiedBy: string;
  sensorFlow: number | null; pipeFlow: number | null; reference: number | null; tolerance: number | null; sensorPressure: number | null; pipePressure: number | null;
  sensorReportedAt: string | null; pipeWrittenAt: string | null; changedAlone: number | null; issue: string | null; repairDate: string | null; repairedBy: string | null;
}
export interface Finding {
  ID: string; createdAt: string; recordType: string; recordId: string; observedValue: string; observedVersion: string; reasons: string; level: string; groupKey: string; evidence: Evidence;
  reviewStatus: string; reviewNote: string | null; reviewedAt: string | null; councilStatus: string; councilAnswer: string | null; recordStatus: string;
  changes: { oldValue: string | null; newValue: string | null; changedAt: string; changedBy: string; action: string; oldWriter: string | null; oldVersion: string | null }[];
  events: { action: string; note: string | null; at: string }[];
}
export interface Moment { at: string; recordType: string; recordId: string; name: string; who: string; event: string; night: boolean; stranger: boolean }
export interface Ledger {
  findings: Finding[];
  timeline: { moments: Moment[]; inner: { at: string; recordId: string; name: string; writtenAt: string }[]; odd: { count: number; first: string | null; last: string | null; minutes: number; writtenAfter: number } };
  checked: { records: number };
}
export type Text = (key: string, ...values: (string | number)[]) => string;

// Times are shown as they are stored: Oakhaven time, so everybody talks about the same 03:13.
const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
export const day = (at: string | null): string => (at ? dayFormat.format(new Date(at)) : "");
export const clock = (at: string | null): string => (at ? timeFormat.format(new Date(at)) : "");
export const moment = (at: string | null): string => (at ? `${day(at)} ${clock(at)}` : "");
const PEOPLE: Readonly<Record<string, string>> = { "maren.holt": "Maren Holt", "tobin.reyes": "Tobin Reyes", council: "the council account" };
export const writer = (name: string): string => PEOPLE[name] ?? name;
export const pipeName = (id: string | null): string => (id ?? "").toLowerCase().replace(/(^|-)(\w)/g, (_match, dash: string, letter: string) => (dash ? " " : "") + letter.toUpperCase());
const UNITS: Readonly<Record<string, string>> = { KG: "kg", L: "L", Dozen: "dozen", Number: "" };
const unit = (code: string): string => UNITS[code] ?? code;
const capital = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);

export const reasonsOf = (finding: Finding): string[] => finding.reasons.split(",");
export const isAsking = (finding: Finding): boolean => reasonsOf(finding).some((reason) => reason.startsWith("outside"));

export function nameOf(finding: Finding, t: Text): string {
  const { evidence } = finding;
  if (finding.recordType === "Sensor") return t("nSensor", evidence.name, pipeName(evidence.pipeID));
  if (finding.recordType === "Repair") return t("nRepair", pipeName(evidence.pipeID));
  return finding.recordType === "WaterPipe" ? t("nPipe", pipeName(evidence.pipeID)) : t("nStock", evidence.name);
}

export function valueOf(finding: Finding, t: Text): string {
  return finding.recordType === "Repair" ? t("valueRepair", day(finding.evidence.repairDate)) : `${finding.observedValue} ${unit(finding.evidence.unit)}`.trim();
}

function sentence(reason: string, finding: Finding, t: Text): string {
  const e = finding.evidence;
  const usual = finding.recordType === "StockItem" ? "Tobin" : "Maren";
  switch (reason) {
    case "impossibleFlow": return t("rImpossibleFlow", e.sensorFlow ?? "", e.reference ?? "");
    case "negativeStock": return t("rNegativeStock", finding.observedValue, unit(e.unit), e.name.toLowerCase());
    case "contradiction": return t("rContradiction", e.sensorFlow ?? "", e.pipeFlow ?? "", e.reference ?? "");
    case "nightCreated": return t("rNightCreated", clock(e.createdAt));
    case "nightChanged": return t("rNightChanged", clock(e.modifiedAt));
    case "notPerson": return t("rNotPerson", e.modifiedBy);
    case "futureRepair": return t("rFutureRepair", day(e.repairDate));
    case "attribution": return t("rAttribution", e.repairedBy ?? "", e.createdBy);
    case "outsideCreated": return t("rOutsideCreated", writer(e.createdBy), usual);
    default: return e.modifiedBy === "council" ? t("rCouncilChanged", day(e.modifiedAt)) : t("rOutsideChanged", writer(e.modifiedBy), day(e.modifiedAt), usual);
  }
}

const REVIEW: Readonly<Record<string, [string, string]>> = {
  New: ["Warning", "sap-icon://ti/mail"], Read: ["Information", "sap-icon://ti/eye"], NotTrusted: ["Error", "sap-icon://ti/rubber-stamp"], Cleared: ["Success", "sap-icon://accept"],
};
const SURE = ["impossibleFlow", "negativeStock", "contradiction", "nightCreated", "nightChanged", "notPerson"];

export interface ListItem { id: string; name: string; value: string; status: string; state: string; icon: string; level: string }
export function listItem(finding: Finding, t: Text): ListItem {
  const [state, icon] = REVIEW[finding.reviewStatus];
  return { id: finding.ID, name: nameOf(finding, t), value: valueOf(finding, t), status: t(`rv${finding.reviewStatus}`), state, icon, level: finding.level };
}

export interface Card {
  id: string; name: string; value: string; level: string; status: string; state: string; icon: string; council: string; record: string; recordState: string;
  why: { text: string }[]; sides: { label: string; value: string }[]; sideNotes: { text: string }[]; reasons: { text: string; state: string }[]; wrote: string; might: string;
  history: { before: string; beforeBy: string; now: string; nowBy: string; why: string }[]; steps: { text: string }[]; note: string; answer: string; seen: string; review: string; councilStatus: string;
}

export function card(finding: Finding, t: Text): Card {
  const e = finding.evidence;
  const reasons = reasonsOf(finding);
  const [state, icon] = REVIEW[finding.reviewStatus];
  const sides: Card["sides"] = [];
  const sideNotes: string[] = [];
  if (finding.recordType === "Sensor") {
    sides.push({ label: t("sideSensor"), value: `${e.sensorFlow} L/min` }, { label: t("sidePipe"), value: `${e.pipeFlow} L/min` }, { label: t("sideReference"), value: `${e.reference} L/min` });
    sideNotes.push(`${t("reported", moment(e.sensorReportedAt))}, ${t("pipeWritten", moment(e.pipeWrittenAt))}`, t("pressures", e.sensorPressure ?? "?", e.pipePressure ?? "?"));
    if (reasons.includes("contradiction")) sideNotes.push(t("tolerance"));
  } else if (finding.recordType === "Repair" && reasons.includes("attribution")) {
    sides.push({ label: t("sideRepairer"), value: e.repairedBy ?? "" }, { label: t("sideWriter"), value: e.createdBy });
  } else sides.push({ label: t("sideRecord"), value: valueOf(finding, t) });
  const why = reasons.map((reason) => sentence(reason, finding, t));
  if (finding.level === "sure" && e.changedAlone !== null) why.push(t("rAlone", e.changedAlone));
  let might = "";
  if (finding.level === "sure") {
    if (finding.recordType === "Sensor") might = t("mSensor");
    else if (finding.recordType === "StockItem") might = t("mStock");
    else if (e.pipeFlow !== null && e.reference) might = t("mRepair", Math.round((e.pipeFlow / e.reference) * 100));
  }
  let seen = finding.reviewStatus === "NotTrusted" ? "seenNot" : finding.level === "sure" && finding.reviewStatus !== "Cleared" ? "seenReview" : "seenNothing";
  if (finding.recordStatus !== "current" && seen !== "seenNothing") seen = "seenOld";
  const value = (text: string | null): string => `${text ?? "?"} ${unit(e.unit)}`.trim();
  return {
    id: finding.ID, name: nameOf(finding, t), value: valueOf(finding, t), level: finding.level, status: t(`rv${finding.reviewStatus}`), state, icon, council: t(`co${finding.councilStatus}`),
    record: t(`rec${capital(finding.recordStatus)}`), recordState: finding.recordStatus === "current" ? "None" : "Information",
    why: why.map((text) => ({ text })), sides, sideNotes: sideNotes.map((text) => ({ text })),
    reasons: reasons.map((reason) => ({ text: t(`s${capital(reason)}`), state: SURE.includes(reason) ? "Error" : "Warning" })).filter((item, index, all) => all.findIndex((other) => other.text === item.text) === index),
    wrote: e.createdAt === e.modifiedAt ? t("wroteOnce", moment(e.createdAt), writer(e.createdBy)) : t("wrote", moment(e.createdAt), writer(e.createdBy), moment(e.modifiedAt), writer(e.modifiedBy)),
    might,
    history: finding.changes.map((change) => ({
      before: value(change.oldValue), beforeBy: t("historyLine", writer(change.oldWriter ?? ""), moment(change.oldVersion)),
      now: value(change.newValue), nowBy: t("historyLine", writer(change.changedBy), moment(change.changedAt)),
      why: change.action,
    })),
    steps: finding.events.map((event) => ({ text: event.note ? t("stepLineNote", t(`e${event.action}`), moment(event.at), event.note) : t("stepLine", t(`e${event.action}`), moment(event.at)) })),
    note: finding.reviewNote && finding.reviewStatus !== "Read" ? t("myNote", finding.reviewNote) : "", answer: finding.councilAnswer ? t("answerIs", finding.councilAnswer) : "",
    seen: t("seen", t(seen)), review: finding.reviewStatus, councilStatus: finding.councilStatus,
  };
}

/** Ilse's last question, in plain words. */
export function answers(ledger: Ledger, t: Text): string[] {
  const { odd, inner, moments } = ledger.timeline;
  const lines: string[] = [];
  if (odd.count === 0) lines.push(t("answerNone"));
  else {
    lines.push(odd.minutes <= 1 ? t("answerOnce", odd.count, moment(odd.first)) : t("answerSpan", odd.count, moment(odd.first), moment(odd.last)));
    lines.push(odd.writtenAfter === 0 ? t("answerLast") : t("answerAfter", odd.writtenAfter));
  }
  const asked = ledger.findings.filter(isAsking).filter((finding) => finding.reasons.includes("outsideChanged") || finding.recordType === "Repair").map((finding) => finding.observedVersion);
  const quiet = asked.filter((at) => !moments.some((item) => item.at === new Date(at).toISOString() && (item.night || item.stranger))).sort();
  if (quiet.length > 0) lines.push(t("answerBit", day(quiet[0]), day(quiet[quiet.length - 1])));
  if (inner.length > 0) lines.push(t("answerInner", inner.map((item) => t("innerItem", day(item.at), day(item.writtenAt))).join(", ")));
  lines.push(t("answerLimit"));
  return lines;
}
