using { oakhaven.curse as db } from '../db/schema';

/**
 * Water data of Oakhaven: pipes, their sensors and repairs, and the village landmarks.
 * Served at /odata/v4/water-supply — try http://localhost:4004/odata/v4/water-supply/WaterPipes
 */
// `impl` points CAP at the TypeScript handler file (written without the `.ts` extension).
service WaterSupplyService @(path: 'water-supply', impl: 'srv/water-supply-service') {

  @readonly
  entity WaterPipes as projection on db.WaterPipes {
    *,
    // 👋 EXAMPLE — a computed field. `virtual` = part of the API, but not a column in the database.
    //    CAP returns null for it until a handler fills it in: see addDaysSinceMaintenance in
    //    water-supply-service.ts. Shown as a column in src/oakhaven-app/webapp/view/Main.view.xml.
    virtual null as daysSinceMaintenance : Integer,

    // Today's Route (Maren) — computed in srv/lib/water-route.ts
    virtual null as tier              : String,  // alarm | unknown | thisWeek | ok
    virtual null as rank              : Integer, // 1 = go first; null = nothing to do
    virtual null as jobSlot           : Integer, // 1 or 2 = one of today's two jobs
    virtual null as flowPercent       : Integer, // % of the design flow, rounded
    virtual null as affects           : String,  // who depends on this pipe
    virtual null as upstreamOf        : String,  // equally bad pipes it feeds: go here first
    virtual null as reason            : String,  // which rule put it on the route, and for whom
    virtual null as isBackup          : Boolean, // nobody depends on it
    virtual null as readingsFresh     : Boolean,
    virtual null as readingAgeMinutes : Integer,
    virtual null as sendToIlse        : Boolean, // odd reading: for Ilse, not for the route
    virtual null as repairedToday     : Boolean,
    virtual null as deferredToday     : Boolean,
    virtual null as carriedSince      : DateTime, // first "can't today" on an earlier day
    virtual null as carriedReason     : String
  } actions {
    /** Logs a repair of this pipe, dated now. */
    action logRepair(issue : String, repairedBy : String);
    /** Takes this pipe off today's route, with the reason why. */
    action deferJob(reason : String);
  };

  @readonly
  entity Sensors    as projection on db.Sensors;

  @readonly
  entity Repairs    as projection on db.Repairs;

  @readonly
  entity Landmarks  as projection on db.Landmarks;

  @readonly
  entity JobDeferrals as projection on db.JobDeferrals;

  // Demo only: pretend a pipe's readings change. Kept in memory, never written to the database.
  action demoSet(pipeID : String, scenario : String enum { alarm; silent; recovered; });
  action demoReset();
}
