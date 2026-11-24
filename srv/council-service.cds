using { oakhaven.curse as db } from '../db/schema';

/**
 * The Monday Council Sheet. Reads water and food, never changes them.
 * Served at /odata/v4/council — try http://localhost:4004/odata/v4/council/currentSheet(scenario=false)
 */
service CouncilService @(path: 'council', impl: 'srv/council-service') {

  @readonly
  entity CouncilCosts     as projection on db.CouncilCosts;

  @readonly
  entity CouncilSheets    as projection on db.CouncilSheets excluding { inputJson, resultJson };

  @readonly
  entity CouncilDecisions as projection on db.CouncilDecisions;

  type DecisionLine { lineKey : String; decision : String; note : String; }

  /** The sheet as it is now, as JSON (see srv/lib/council-sheet.ts). Stores nothing. Scenario: a demo of next Monday. */
  function currentSheet(scenario : Boolean) returns LargeString;
  /** A saved copy, as JSON, exactly as it was. */
  function copySheet(sheet : UUID) returns LargeString;

  /** Freezes the sheet. Returns the ID of the copy. */
  action createCouncilCopy() returns String;
  /** Types in the ticks of the meeting, once per copy. `rule` is the choice about urgent repairs, if any. */
  action recordDecisions(sheet : UUID, lines : many DecisionLine, rule : String, decidedBy : String);
}
