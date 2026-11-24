namespace oakhaven.curse;

using { cuid, managed } from '@sap/cds/common';

// Every entity below uses two standard CAP aspects:
//   cuid    → a UUID key field `ID`
//   managed → createdAt, createdBy, modifiedAt, modifiedBy (filled in by CAP on every write)

// ---------------------------------------------------------------------------
// Water — the pipe network that brings water from Silverbrook Spring to the village
// ---------------------------------------------------------------------------

/** Role of a pipe in the network. */
type PipelineType : String enum {
  mainLine;
  branch;
  secondary;
}

/** A water pipe in the Oakhaven supply network. */
entity WaterPipes : cuid, managed {
  /** Human-readable pipe name, e.g. "PRIMARY-MAIN". */
  pipeID          : String;
  /** Route label, e.g. "Silverbrook Spring → Central Market Square". */
  location        : String;
  /** Landmark names (`Landmarks.name`) the pipe runs between, in flow direction. */
  startPoint      : String;
  endPoint        : String;
  pipelineType    : PipelineType;
  diameter        : Decimal(9, 2); // mm
  length          : Decimal(9, 2); // m
  nominalFlowRate : Decimal(9, 2); // L/min — what the pipe carries at full capacity
  currentFlowRate : Decimal(9, 2); // L/min — what it carries right now
  currentPressure : Decimal(9, 2); // PSI   — water pressure right now
  lastMaintenance : DateTime;
  /** Route on the village map in grid units: "x,y x,y …", x/y in [0,8] from the
   *  south-west corner of cell A1 (centre of E6 = "4.5,5.5"), in flow direction. */
  mapPath         : String;
  sensors         : Composition of many Sensors on sensors.pipe = $self;
  repairs         : Composition of many Repairs on repairs.pipe = $self;
}

/** Flow/pressure sensor mounted on a water pipe. */
entity Sensors : cuid, managed {
  pipe        : Association to WaterPipes;
  sensorID    : String;
  flowRate    : Decimal(15, 2); // L/min measured by the sensor
  pressure    : Decimal(15, 2); // PSI measured by the sensor
  lastReading : DateTime;       // when the sensor last reported
}

/** Repair performed on a water pipe. */
entity Repairs : cuid, managed {
  pipe       : Association to WaterPipes;
  repairID   : UUID;
  issue      : String;
  repairDate : DateTime;
  repairedBy : String;
  /** Tier of the pipe when the repair was logged: a pipe that gets worse afterwards comes back. */
  tierAtRepair : String;
}

/** A job the water crew could not do that day ("can't today"), with the reason. */
entity JobDeferrals : cuid, managed {
  pipe           : Association to WaterPipes;
  reason         : String;
  deferredAt     : DateTime;
  /** Tier of the pipe when it was deferred: a pipe that gets worse afterwards comes back. */
  tierAtDeferral : String;
}

/** Kind of a village landmark. */
type LandmarkKind : String enum {
  spring;
  mill;
  market;
  inn;
  residential;
  bakery;
  farm;
  forest;
}

/** A landmark on the Oakhaven village map (chess-board cell A1…H8). */
entity Landmarks : cuid, managed {
  name       : String;
  kind       : LandmarkKind;
  /** Cell on the village map: column A–H (west → east) + row 1–8 (south → north). */
  gridCell   : String(2);
  /** pipeID of the branch that feeds this area (residential / bakery / farm only). */
  suppliedBy : String;
  /** Order in which Maren helps the places: 1 = first. Empty: nobody waits for water there. */
  servicePriority : Integer;
  /** Who or what depends on the water here, in Maren's words. */
  serviceNote     : String;
}

// ---------------------------------------------------------------------------
// Food — the village pantry
// ---------------------------------------------------------------------------

/** A food product of the village stock. */
entity StockItems : cuid, managed {
  itemID          : String;          // GRAIN, MILK, …
  name            : String;
  unit            : String;          // KG, L, Dozen, Number
  icon            : String;          // sap-icon://… (Tabler icons: sap-icon://ti/<name>)
  currentQuantity : Decimal(9, 2);   // in `unit`
  minStockLevel   : Decimal(9, 2);   // in `unit` — the level the village wants to stay above
  consumptionRate : Decimal(9, 2);   // `unit` per day the village uses up
  supplier        : Association to Suppliers; // empty = never ordered (bread is baked)
  /** How many times the normal use on market Saturdays. */
  marketDayFactor : Decimal(4, 2) default 1;
  /** When `currentQuantity` was last true by a count or a delivery. Empty: only the old record. */
  stockAsOf       : DateTime;
  /** When somebody last counted it. Empty: nobody since the Desync. */
  countedAt       : DateTime;
  receivals       : Composition of many StockReceivals on receivals.item = $self;
}

/** A delivery of a stock item. (No rows yet.) */
entity StockReceivals : cuid, managed {
  item             : Association to StockItems;
  quantityReceived : Decimal(9, 2); // in the item's `unit`
  supplier         : String;
  receivedAt       : DateTime;
  /** The rows of one cart share this ID. */
  deliveryID       : UUID;
}

/** Who delivers to the pantry, and how long that takes. */
entity Suppliers : cuid, managed {
  name       : String;
  leadDays   : Integer;
  isEstimate : Boolean default false; // no fixed days known: dates are an estimate
}

/** An order Tobin placed himself; the app never contacts a supplier. */
entity PurchaseOrders : cuid, managed {
  item             : Association to StockItems;
  orderedQuantity  : Decimal(9, 2);
  receivedQuantity : Decimal(9, 2);
  orderedAt        : DateTime;
  dueOn            : Date;
  open             : Boolean default true;
}

/** A count. Keeps the number it replaced and who last changed that: evidence, never overwritten. */
entity StockCounts : cuid, managed {
  item          : Association to StockItems;
  oldQuantity   : Decimal(9, 2);
  counted       : Decimal(9, 2);
  countedAt     : DateTime;
  countedBy     : String;
  oldModifiedAt : Timestamp;
  oldModifiedBy : String;
}

/** The last state a message was based on, so only a change leads to a new one. */
entity StockStates {
  key itemID     : UUID;
      risk       : String;
      orderState : String;
}

/** A message about a stock item; at most one per item, state and day. */
@assert.unique.once: [ item, state, day ]
entity Notifications : cuid, managed {
  item         : Association to StockItems;
  message      : String;
  acknowledged : Boolean default false;
  state        : String;
  day          : Date;
}

// ---------------------------------------------------------------------------
// Evidence — photos of what people actually saw
// ---------------------------------------------------------------------------

/** A photo next to any record. Append-only: a retake is a new row. */
entity Evidence : cuid, managed {
  recordType : String(40); // WaterPipe, StockReceival, StockCount, …
  recordId   : UUID;
  note       : String(200);
  capturedBy : String(80);
  capturedAt : DateTime;
  photo      : LargeBinary @Core.MediaType: 'image/jpeg';
  thumb      : LargeBinary @Core.MediaType: 'image/jpeg';
}

// ---------------------------------------------------------------------------
// Council — the Monday sheet of Rowan, Hilde and Bram
// ---------------------------------------------------------------------------

/** The only amounts the council is sure of, in crowns. */
entity CouncilCosts {
  key code   : String(20); // repair, emergencyFood, weeklyBudget
      label  : String;
      crowns : Integer;
}

/** A frozen copy of the sheet: what the council had on the table. Never changed afterwards. */
@assert.unique.copyNo: [ copyNo ]
entity CouncilSheets : cuid, managed {
  copyNo        : String(20); // 2026-W48, 2026-W48-2, …
  ruleVersion   : Integer;
  dataAsOf      : Timestamp;
  inputJson     : LargeString;
  resultJson    : LargeString;
  previousSheet : Association to CouncilSheets;
  decidedAt     : DateTime;    // when the ticks were typed in
  decidedBy     : String(80);
  decisions     : Composition of many CouncilDecisions on decisions.sheet = $self;
}

/** One tick of the meeting. A line without a row was not decided and is not funded. */
@assert.unique.line: [ sheet, lineKey ]
entity CouncilDecisions : cuid, managed {
  sheet    : Association to CouncilSheets;
  lineKey  : String(60);
  decision : String(5) enum { yes; no; later; };
  amount   : Integer;
  note     : String(200);
}

/** What the council chose about urgent repairs; the newest row counts. */
entity CouncilRules : cuid, managed {
  choice    : String(20) enum { marenAtOnce; askHilde; };
  decidedBy : String(80);
  decidedAt : DateTime;
}

// ---------------------------------------------------------------------------
// The Ledger — Ilse's list of records that may not be trusted
// ---------------------------------------------------------------------------

/** One finding per record version: a later correction is a new version. The evidence is frozen. */
@assert.unique.version: [ recordType, recordId, field, observedVersion ]
entity Findings : cuid, managed {
  recordType      : String(20); // WaterPipe, Sensor, Repair, StockItem, Landmark
  recordId        : UUID;
  field           : String(40);
  observedValue   : String(60);
  observedVersion : Timestamp;  // `modifiedAt` of the record when it was found
  reasons         : String(200); // comma separated codes, see srv/lib/ledger-scan.ts
  level           : String(4) enum { sure; ask; };
  groupKey        : String(60);
  evidenceJson    : LargeString;
  reviewStatus    : String(10) enum { New; Read; NotTrusted; Cleared; } default 'New';
  reviewNote      : String(300);
  reviewedAt      : DateTime;
  councilStatus   : String(10) enum { NotBrought; Brought; Answered; } default 'NotBrought';
  councilAnswer   : String(300);
  events          : Composition of many FindingEvents on events.finding = $self;
}

/** Every move of a finding, so nothing quietly disappears. */
entity FindingEvents : cuid, managed {
  finding : Association to Findings;
  action  : String(20);
  note    : String(300);
  who     : String(80);
  at      : DateTime;
}

/** Old and new value of every audited write. The app has no way to change or remove a line. */
entity ChangeLog : cuid {
  recordType : String(20);
  recordId   : UUID;
  field      : String(40);
  oldValue   : String(60);
  newValue   : String(60);
  oldVersion : Timestamp;
  oldWriter  : String(80);
  newVersion : Timestamp;
  changedAt  : Timestamp;
  changedBy  : String(80);
  action     : String(40);
}
