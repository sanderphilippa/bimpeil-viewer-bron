/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: een model ophalen met een bovengrens (audit 2026-11 SEC-026). Een versie die de browser ingepakt uploadt
 * (gzip), geeft zelf de oorspronkelijke grootte op; de browser pakt hem bij het ophalen uit. Een kleine gzip die naar
 * vele GB uitpakt, liet zo het tabblad vastlopen. Daarom stoppen bij de opgegeven grootte (uit BIMpeil) plus de marge
 * van de server, of zonder grootte bij een vaste grens. Dezelfde regel als de tekstweergave van BIMpeil; een eigen
 * kopie, want de fork importeert niets uit BIMpeil.
 */
export class TooLarge extends Error {}

/** Vaste grens als BIMpeil geen grootte meegeeft */
export const HARD_LIMIT = 4 * 1024 ** 3;

/** Hooguit zoveel bytes: de opgegeven grootte plus 1 procent en 64 KB, of de vaste grens */
export function readLimit(expected: number | undefined): number {
  return expected !== undefined && expected > 0 ? expected + Math.ceil(expected / 100) + 65_536 : HARD_LIMIT;
}

/** Alles uit een stream, met TooLarge boven `max`; `onProgress` krijgt het aantal gelezen bytes */
export async function readBounded(
  reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> },
  max: number,
  onProgress?: (length: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    if (length + value.byteLength > max) throw new TooLarge('Het model is groter dan bij het uploaden opgegeven; niet geopend.');
    chunks.push(value);
    length += value.byteLength;
    onProgress?.(length);
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Ophalen en begrensd lezen; `size` is de oorspronkelijke grootte uit BIMpeil, als die er is */
export async function fetchBounded(url: string, size: number | undefined, init?: RequestInit, onProgress?: (length: number) => void): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
  const res = await fetch(url, init);
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
  const bytes = await readBounded(res.body.getReader(), readLimit(size), onProgress);
  return { bytes, type: res.headers.get('content-type') ?? '' };
}

/** Een grootte uit een bericht of antwoord: alleen een positief geheel getal */
export const parseSize = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined);
