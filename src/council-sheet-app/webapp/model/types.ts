/** The sheet as the council service returns it (see srv/lib/council-sheet.ts). */
export type Verdict = "allRight" | "notAllRight" | "notYet" | "atRisk" | "cantTell";
export type Decision = "yes" | "no" | "later";
export type LineKind = "approve" | "approveIf" | "buffer" | "reserve";

export interface PipeLine { pipeID: string; tier: string; flowPercent: number | null; pressure: number | null; readingAt: string | null }
export interface Place { name: string; note: string | null }
export interface Area extends Place { state: "badlyShort" | "cantTell" | "runningLow" | "fine"; path: string[]; worst: PipeLine | null; also: PipeLine[] }

export interface FoodLine {
  name: string; unit: string; stock: number; reliable: boolean; recordedOn: string | null; countedBy: string | null; ageDays: number | null;
  state: "doubtful" | "unreliable" | "notAllRight" | "notYet" | "atRisk" | "fine" | "baked"; source: "counted" | "record" | "delivery" | "noDate";
  lastsDays: number | null; runsOutOn: string | null; orderedFor: string | null; timingUncertain: boolean;
}

export interface MoneyLine {
  key: string; kind: LineKind; crowns: number; pipe: PipeLine | null; places: Place[]; everyone: boolean; checkAfter: string[]; supplier: string | null;
  products: { name: string; unit: string; doubtful: boolean; cartDue: string | null; shortUnder: number | null }[];
  oneCart: number | null; history: { decision: Decision; decidedOn: string } | null;
}

export interface Budget { weekly: number; pending: number; approve: number; approveIf: number; buffer: number; reserve: number; total: number; short: number; unallocated: number }
export interface Doubt { kind: "stock" | "sensor" | "repair"; name: string; value: number | null; unit: string; expected: number | null; date: string | null; changedBy: string | null; changedAt: string | null }

export interface HelpLine {
  kind: LineKind; crowns: number; pipeID: string | null; supplier: string | null; before: PipeLine | null; after: PipeLine | null;
  work: { at: string; by: string | null; what: string | null } | null; label: string;
}

export interface Sheet {
  asOf: string; from: string; until: string; expiresOn: string; isDemo: boolean; signature: string;
  water: { verdict: Verdict; readingAt: string | null; areas: Area[]; offNetwork: string[] };
  food: { verdict: Verdict; lines: FoodLine[]; unreliable: number };
  lines: MoneyLine[];
  pending: { pipeID: string; at: string; by: string | null; issue: string | null; crowns: number; stillFailing: boolean }[];
  toCheck: PipeLine[];
  deferred: { pipe: PipeLine; crowns: number }[];
  refused: { pipeID: string | null; supplier: string | null }[];
  budget: Budget;
  oneCartBudget: Budget | null;
  options: { kind: string; total?: number; crowns?: number; enough?: boolean; pipeID?: string; full?: number }[];
  doubts: Doubt[];
  agenda: { rule: { choice: string; decidedBy: string; decidedAt: string } | null; repairsLastYear: number; urgentRepairs: number };
  help: { copyNo: string; createdAt: string; water: Verdict; food: Verdict; lines: HelpLine[] } | null;
}

export interface Copy {
  ID: string; copyNo: string; createdAt: string; decidedAt: string | null; decidedBy: string | null; result: Sheet;
  decisions: { lineKey: string; decision: Decision; note: string | null }[];
}
