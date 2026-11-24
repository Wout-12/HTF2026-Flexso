using { oakhaven.curse as db } from '../db/schema';

/**
 * Photos next to any record: "Oakhaven remembers what people actually saw."
 * Append-only: photos can be added and read, never changed or removed.
 */
service EvidenceService @(path: 'evidence', impl: 'srv/evidence-service') {
  @Capabilities.DeleteRestrictions.Deletable: false
  entity Evidence as projection on db.Evidence;
}
