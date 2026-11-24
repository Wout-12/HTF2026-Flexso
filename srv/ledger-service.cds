using { oakhaven.curse as db } from '../db/schema';

/**
 * The Ledger (Ilse): records that may not be trusted, and what she decided. Never changes the villagers' records.
 * Served at /odata/v4/ledger — try http://localhost:4004/odata/v4/ledger/Findings
 */
service LedgerService @(path: 'ledger', impl: 'srv/ledger-service') {

  @readonly
  entity Findings      as projection on db.Findings;

  @readonly
  entity FindingEvents as projection on db.FindingEvents;

  @readonly
  entity ChangeLog     as projection on db.ChangeLog;

  /** Everything the screen shows, as JSON. Stores nothing. */
  function ledger()    returns LargeString;
  /** IDs of urgent findings nobody read yet, comma separated: one small answer for the old laptop. */
  function urgentNew() returns String;

  /** Looks through the records. Returns how many findings are new; running it again changes nothing. */
  action scan() returns Integer;
  action markRead(finding : UUID);
  action markNotTrusted(finding : UUID, note : String);
  action clearFinding(finding : UUID, reason : String);
  action reopen(finding : UUID, reason : String);
  action bringToCouncil(finding : UUID);
  action recordAnswer(finding : UUID, text : String);
}
