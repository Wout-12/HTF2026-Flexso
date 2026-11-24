/**
 * The Oakhaven Square: public, so it only returns finished sentences and exposes no entities.
 * Served at /odata/v4/square — try http://localhost:4004/odata/v4/square/square()
 */
service SquareService @(path: 'square', impl: 'srv/square-service') {
  /** The village weather and news, as JSON (see srv/lib/square.ts). Stores nothing. */
  function square() returns LargeString;
}
