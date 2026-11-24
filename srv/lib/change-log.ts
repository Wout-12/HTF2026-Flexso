/**
 * Audited writes: the old value, the new value, who and when, in the same transaction as the write.
 * If either fails, both are rolled back. Not tamper-proof: the database file itself is not protected.
 */
import { randomUUID } from 'node:crypto';

type Row = Record<string, unknown>;

/** The slice of the `cds` facade this file uses. */
interface CdsApi {
  readonly ql: {
    readonly SELECT: { from(entity: string): { columns(...columns: readonly string[]): { where(predicate: Row): PromiseLike<unknown> } } };
    readonly INSERT: { into(entity: string): { entries(rows: Row | readonly Row[]): PromiseLike<unknown> } };
    UPDATE(entity: string): { with(data: Row): { where(predicate: Row): PromiseLike<unknown> } };
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT, INSERT, UPDATE } = cds.ql;
const DB = 'oakhaven.curse';

export interface AuditedWrite {
  readonly entity: string;
  readonly recordType: string;
  readonly id: string;
  readonly changes: Row;
  /** Only these fields are logged. */
  readonly fields: readonly string[];
  /** Fixed per action on the server, never from the browser. */
  readonly who: string;
  readonly action: string;
}

export async function auditedUpdate({ entity, recordType, id, changes, fields, who, action }: AuditedWrite): Promise<void> {
  const read = async (): Promise<Row> => ((await SELECT.from(`${DB}.${entity}`).columns(...fields, 'modifiedAt', 'modifiedBy').where({ ID: id })) as Row[])[0];
  const before = await read();
  await UPDATE(`${DB}.${entity}`).with({ ...changes, modifiedBy: who }).where({ ID: id });
  const after = await read();
  const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(typeof value === 'number' ? value : Number.isNaN(Number(value)) ? value : Number(value)));
  await INSERT.into(`${DB}.ChangeLog`).entries(fields.map((field) => ({
    ID: randomUUID(), recordType, recordId: id, field, oldValue: text(before[field]), newValue: text(after[field]), oldVersion: before.modifiedAt, oldWriter: before.modifiedBy,
    newVersion: after.modifiedAt, changedAt: new Date().toISOString(), changedBy: who, action,
  })));
}
