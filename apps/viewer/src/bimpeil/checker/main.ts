/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: controle met een IDS zonder viewer (11 oktober 2026, besluiten punt 29). Deze pagina
 * (`/viewer/bimpeil-checker.html`) laadt de pagina Controles van BIMpeil onzichtbaar in een iframe. Ze ontvangt per
 * versie `bimpeil:check` met de ondertekende URL's van het IFC en de IDS (alleen dezelfde origin), leest de IDS in
 * (DOMParser, dus hier), en laat de worker het model inlezen en controleren. Terug gaan voortgang en uitkomst.
 * Alleen de parser en de IDS controle van IfcLite; geen viewer, geen WebGPU.
 *
 * Berichten van BIMpeil: { type: 'bimpeil:check', id, ifcUrl, idsUrl } en { type: 'bimpeil:check-cancel', id }.
 * Berichten naar BIMpeil: bimpeil:checker-ready, bimpeil:check-progress { id, phase, percentage, detail },
 * bimpeil:check-done { id, report, schemaVersion, entityCount } en bimpeil:check-failed { id, message }.
 */
import { parseIDS } from '@ifc-lite/ids';
import type { CheckWorkerRequest, CheckWorkerResponse } from './check.worker';
import { parseSize, readBounded, readLimit } from '../boundedFetch';

type Phase = 'downloaden' | 'inlezen' | 'controleren';

const parentOrigin = location.origin;
const toParent = (message: Record<string, unknown>) => window.parent.postMessage(message, parentOrigin);
const progress = (id: string, phase: Phase, percentage: number, detail?: string) =>
  toParent({ type: 'bimpeil:check-progress', id, phase, percentage: Math.round(percentage), detail });

let worker: Worker | null = null;
let current: string | null = null;
/** De download van de lopende controle; afbreken stopt hem (audit VIEW-004) */
let downloading: AbortController | null = null;

/**
 * De worker stopte zonder antwoord (audit VIEW-004): een fout of te weinig geheugen. Zonder dit bleef BIMpeil eindeloos
 * op "controleren" staan. De volgende controle krijgt een nieuwe worker.
 */
function workerLost(message: string) {
  worker?.terminate();
  worker = null;
  if (current === null) return;
  const id = current;
  current = null;
  toParent({ type: 'bimpeil:check-failed', id, message });
}

function newWorker(): Worker {
  const w = new Worker(new URL('./check.worker.ts', import.meta.url), { type: 'module' });
  w.onerror = (event) => {
    event.preventDefault();
    workerLost('De controle stopte onverwacht, mogelijk door te weinig geheugen voor dit model.');
  };
  w.onmessageerror = () => workerLost('De controle kon haar uitkomst niet doorgeven.');
  w.onmessage = (event: MessageEvent<CheckWorkerResponse>) => {
    const msg = event.data;
    if (msg.id !== current) return;
    if (msg.type === 'parsing') progress(msg.id, 'inlezen', 0);
    else if (msg.type === 'progress') {
      const p = msg.progress;
      progress(msg.id, 'controleren', p.percentage, p.totalSpecifications ? `specificatie ${Math.min(p.specificationIndex + 1, p.totalSpecifications)} van ${p.totalSpecifications}` : undefined);
    } else if (msg.type === 'complete') {
      current = null;
      toParent({ type: 'bimpeil:check-done', id: msg.id, report: msg.report, schemaVersion: msg.schemaVersion, entityCount: msg.entityCount });
    } else {
      current = null;
      toParent({ type: 'bimpeil:check-failed', id: msg.id, message: msg.message });
    }
  };
  return w;
}

function sameOrigin(url: string): boolean {
  return new URL(url, location.href).origin === location.origin;
}

/**
 * Een bestand ophalen met voortgang in procenten; stopt bij de opgegeven grootte plus een marge (audit 2026-11
 * SEC-026). Met de grootte uit BIMpeil is de voortgang op de uitgepakte grootte; anders op de lengte van de download
 */
async function download(id: string, url: string, size: number | undefined, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Het model kon niet opgehaald worden (${res.status})`);
  const total = size ?? Number(res.headers.get('content-length') ?? 0);
  const bytes = await readBounded(res.body.getReader(), readLimit(size), (received) => {
    // Een gecomprimeerde download meldt de gecomprimeerde lengte: hooguit 100
    if (total > 0) progress(id, 'downloaden', Math.min(100, (received / total) * 100));
  });
  return bytes.buffer;
}

async function check(id: string, ifcUrl: string, idsUrl: string, ifcSize: number | undefined) {
  try {
    if (!sameOrigin(ifcUrl) || !sameOrigin(idsUrl)) throw new Error('Onverwacht adres voor het model of de IDS');
    const idsRes = await fetch(idsUrl);
    if (!idsRes.ok) throw new Error(`De IDS kon niet opgehaald worden (${idsRes.status})`);
    const document = parseIDS(await idsRes.text());
    progress(id, 'downloaden', 0);
    downloading = new AbortController();
    const buffer = await download(id, ifcUrl, ifcSize, downloading.signal);
    downloading = null;
    if (current !== id) return;
    worker ??= newWorker();
    const request: CheckWorkerRequest = { type: 'check', id, buffer, document };
    worker.postMessage(request, [buffer]);
  } catch (err) {
    if (current === id) {
      current = null;
      toParent({ type: 'bimpeil:check-failed', id, message: err instanceof Error ? err.message : String(err) });
    }
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.origin !== parentOrigin || event.source !== window.parent) return;
  const data = event.data as { type?: string; id?: string; ifcUrl?: string; idsUrl?: string; ifcSize?: unknown };
  if (data?.type === 'bimpeil:check' && data.id && data.ifcUrl && data.idsUrl) {
    current = data.id;
    void check(data.id, data.ifcUrl, data.idsUrl, parseSize(data.ifcSize));
  } else if (data?.type === 'bimpeil:check-cancel' && data.id === current) {
    // Afbreken: de download en de worker stoppen; de volgende controle krijgt een nieuwe
    current = null;
    downloading?.abort();
    downloading = null;
    worker?.terminate();
    worker = null;
  }
});

toParent({ type: 'bimpeil:checker-ready' });
