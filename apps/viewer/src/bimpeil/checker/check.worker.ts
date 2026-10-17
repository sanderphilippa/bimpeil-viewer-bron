/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: de worker van de controle (besluiten punt 29). Krijgt de bytes van het IFC en een IDS die de hoofdthread al
 * inlas (een worker heeft geen DOMParser), leest het model in met de parser van IfcLite (zonder WASM en zonder
 * WebGPU) en controleert met validateIDS, zoals idsValidation.worker.ts van de viewer maar zonder de bewerkingen.
 */
import { IfcParser } from '@ifc-lite/parser';
import { createTranslationService, validateIDS, type IDSDocument, type ValidationProgress } from '@ifc-lite/ids';
import { createDataAccessor } from '@ifc-lite/ids/bridge';
import { compactReport, type CheckReport } from './report';

export interface CheckWorkerRequest {
  type: 'check';
  id: string;
  buffer: ArrayBuffer;
  document: IDSDocument;
}

export type CheckWorkerResponse =
  | { type: 'parsing'; id: string }
  | { type: 'progress'; id: string; progress: ValidationProgress }
  | { type: 'complete'; id: string; report: CheckReport; schemaVersion: string; entityCount: number }
  | { type: 'error'; id: string; message: string };

const post = (msg: CheckWorkerResponse) => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (event: MessageEvent<CheckWorkerRequest>) => {
  const req = event.data;
  if (!req || req.type !== 'check') return;
  try {
    post({ type: 'parsing', id: req.id });
    const store = await new IfcParser().parseColumnar(req.buffer);
    const accessor = createDataAccessor(store);
    const entityCount = store.entityCount ?? accessor.getAllEntityIds().length;
    const report = await validateIDS(
      req.document,
      accessor,
      { modelId: req.id, schemaVersion: store.schemaVersion, entityCount },
      {
        translator: createTranslationService('en'),
        includePassingEntities: false,
        yieldEveryMs: 30,
        onProgress: (progress) => post({ type: 'progress', id: req.id, progress }),
      },
    );
    post({ type: 'complete', id: req.id, report: compactReport(report), schemaVersion: String(store.schemaVersion), entityCount });
  } catch (err) {
    post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
};
