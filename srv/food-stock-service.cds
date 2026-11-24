using { oakhaven.curse as db } from '../db/schema';

/**
 * Food data of Oakhaven: the village pantry.
 * Served at /odata/v4/food-stock — try http://localhost:4004/odata/v4/food-stock/StockItems
 */
// `impl` points CAP at the TypeScript handler file (written without the `.ts` extension).
service FoodStockService @(path: 'food-stock', impl: 'srv/food-stock-service') {

  @readonly
  entity StockItems     as projection on db.StockItems {
    *,
    // Pantry Board (Tobin) — computed in srv/lib/pantry-forecast.ts
    virtual null as rank            : Integer, // 1 = worst
    virtual null as risk            : String,  // panic | dontTrust | belowComfort | orderDue | ok
    virtual null as orderState      : String,  // none | placed | late
    virtual null as projected       : Decimal(9, 2), // expected stock today; null = don't trust
    virtual null as daysLeft        : Decimal(9, 1),
    virtual null as runsOutOn       : Date,
    virtual null as belowOn         : Date,
    virtual null as panicOn         : Date,
    virtual null as orderOn         : Date,
    virtual null as orderQuantity   : Integer,
    virtual null as arrivesOn       : Date,
    virtual null as arrivalStock    : Decimal(9, 2),
    virtual null as arrivalGap      : Decimal(9, 2),
    virtual null as useUntilArrival : Decimal(9, 2),
    virtual null as weekUse         : Decimal(9, 2),
    virtual null as target          : Decimal(9, 2),
    virtual null as marketDay       : Date,
    virtual null as supplierName    : String,
    virtual null as leadDays        : Integer,
    virtual null as isEstimate      : Boolean,
    virtual null as orderedQuantity : Decimal(9, 2), // of the open order
    virtual null as dueOn           : Date,
    virtual null as recordedOn      : Date,    // day of the count, or of the old record
    virtual null as oldCount        : Boolean, // never counted, or more than 7 days ago
    virtual null as boardDay        : Date     // the day all of this is about
  };

  @readonly
  entity StockReceivals as projection on db.StockReceivals;

  @readonly
  entity Notifications  as projection on db.Notifications;

  @readonly
  entity Suppliers      as projection on db.Suppliers;

  @readonly
  entity PurchaseOrders as projection on db.PurchaseOrders;

  @readonly
  entity StockCounts    as projection on db.StockCounts;

  type CountLine    { item : UUID; counted : Decimal(9, 2); }
  type DeliveryLine { item : UUID; received : Decimal(9, 2); }

  /** Counts products: one, or all of them. Returns the ID of each count, in the same order. */
  action countStock(lines : many CountLine) returns many String;
  /** Notes that Tobin ordered a product himself. */
  action markOrdered(item : UUID, quantity : Decimal(9, 2));
  /** Notes what one cart brought. Returns the ID of the delivery. */
  action logDelivery(supplier : UUID, lines : many DeliveryLine, receivedAt : DateTime) returns String;
  action markSeen(notification : UUID);
  /** Writes a message for every product that got worse or better since the last time. */
  action checkAlerts();

  // Demo only: pretend it is another day. Kept in memory.
  action demoSetDay(day : Date);
  action demoReset();
}
