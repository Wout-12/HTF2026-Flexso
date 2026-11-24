/**
 * Handlers of `EvidenceService`. A photo is uploaded in two steps: POST the description, then PUT
 * the picture. Each picture can be PUT once; after that the row cannot change any more.
 */
interface EvidenceRequest {
  readonly data: Readonly<Record<string, unknown>>;
  readonly subject: unknown;
  readonly headers: Readonly<Record<string, string | undefined>>;
  error(code: number, message: string, target?: string): void;
}

interface CdsService {
  init(): Promise<void>;
  before(event: string, entity: string, handler: (req: EvidenceRequest) => unknown): void;
}

interface CdsApi {
  readonly ApplicationService: new (...args: readonly never[]) => CdsService;
  readonly ql: {
    readonly SELECT: { from(entity: string): { columns(...columns: readonly string[]): { where(predicate: Readonly<Record<string, unknown>>): PromiseLike<unknown[]> } } };
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT } = cds.ql;

const MAX_BYTES = 2 * 1024 * 1024;
const RECORD_TYPES = ['WaterPipe', 'StockReceival', 'StockCount', 'Finding'];
const PICTURES = ['photo', 'thumb'] as const;

async function checkUpload(req: EvidenceRequest): Promise<void> {
  const picture = PICTURES.find((name) => name in req.data);
  const others = Object.keys(req.data).filter((name) => !['ID', 'photo', 'thumb', 'modifiedAt', 'modifiedBy'].includes(name));
  if (!picture || others.length > 0) return req.error(405, 'Evidence cannot be changed');
  if (!(req.headers['content-type'] ?? '').startsWith('image/jpeg')) return req.error(415, 'Only JPEG photos', picture);
  if (Number(req.headers['content-length'] ?? Infinity) > MAX_BYTES) return req.error(413, 'This photo is too big', picture);
  const rows = await SELECT.from('oakhaven.curse.Evidence').columns('ID').where({ ID: req.data.ID, [picture]: null });
  if (rows.length === 0) return req.error(409, 'This photo is already stored', picture);
}

export default class EvidenceService extends cds.ApplicationService {
  override async init(): Promise<void> {
    this.before('CREATE', 'Evidence', (req) => {
      if (!RECORD_TYPES.includes(String(req.data.recordType))) return req.error(400, 'Unknown kind of record', 'recordType');
      if (!req.data.recordId) return req.error(400, 'Which record is this a photo of?', 'recordId');
    });
    this.before('UPDATE', 'Evidence', checkUpload);
    this.before('DELETE', 'Evidence', (req) => req.error(405, 'Evidence cannot be removed'));
    return super.init();
  }
}
