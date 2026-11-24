/**
 * "Capture evidence": opens the camera, shrinks the photo and stores it next to a record.
 * The photo is never read by the app; it only backs up what a person typed or tapped.
 * A plain file input also works over http, where the camera API does not.
 */
export interface Photo {
  readonly full: Blob;
  readonly thumb: Blob;
  readonly takenAt: Date;
}

export interface StoredPhoto {
  readonly url: string;
  readonly thumbUrl: string;
  readonly caption: string;
}

const SERVICE = "/odata/v4/evidence/Evidence";
const FULL_PX = 1280;
const THUMB_PX = 240;
const MAX_BYTES = 2 * 1024 * 1024;

async function shrink(image: HTMLImageElement, maxSide: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The photo could not be read"))), "image/jpeg", 0.75);
  });
}

export async function toPhoto(file: File): Promise<Photo> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = (): void => resolve();
      image.onerror = (): void => reject(new Error("This is not a photo"));
      image.src = url;
    });
    const full = await shrink(image, FULL_PX);
    if (full.size > MAX_BYTES) throw new Error("This photo is too big");
    return { full, thumb: await shrink(image, THUMB_PX), takenAt: new Date() };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Opens the camera (a file picker on a laptop). Call it directly from a press event. */
export function openCamera(onFile: (file: File) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.setAttribute("capture", "environment");
  input.onchange = (): void => {
    const file = input.files?.[0];
    if (file) onFile(file);
  };
  input.click();
}

async function check(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new Error(body?.error?.message ?? response.statusText);
}

export async function upload(recordType: string, recordId: string, note: string, capturedBy: string, photo: Photo): Promise<void> {
  const created = await check(await fetch(SERVICE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recordType, recordId, note: note.slice(0, 200), capturedBy, capturedAt: `${photo.takenAt.toISOString().slice(0, 19)}Z` }),
  }));
  const { ID } = (await created.json()) as { ID: string };
  for (const [name, body] of [["photo", photo.full], ["thumb", photo.thumb]] as const) {
    await check(await fetch(`${SERVICE}(${ID})/${name}`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body }));
  }
}

/** The photos of some records, newest first. */
export async function listFor(recordType: string, recordIds: readonly string[]): Promise<StoredPhoto[]> {
  if (recordIds.length === 0) return [];
  const filter = `recordType eq '${recordType}' and (${recordIds.map((id) => `recordId eq ${id}`).join(" or ")})`;
  const response = await check(await fetch(`${SERVICE}?$orderby=capturedAt desc&$filter=${encodeURIComponent(filter)}`));
  const { value } = (await response.json()) as { value: { ID: string; note: string | null; capturedBy: string | null; capturedAt: string }[] };
  return value.map((row) => ({
    url: `${SERVICE}(${row.ID})/photo`,
    thumbUrl: `${SERVICE}(${row.ID})/thumb`,
    caption: [row.note, row.capturedBy, new Date(row.capturedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })].filter(Boolean).join(" · "),
  }));
}
