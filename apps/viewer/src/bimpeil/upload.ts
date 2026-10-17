/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: een bestand naar BIMpeil uploaden vanuit de viewer (V2). De viewer stuurt het `File` met
 * postMessage naar de webapp eromheen (zelfde origin, zonder kopie van de inhoud); die uploadt het met
 * dezelfde route als het scherm Bestanden (apps/web/src/viewer-upload.ts) en meldt voortgang en
 * resultaat terug. Het resultaat is de herkomst in BIMpeil (origin.ts).
 */

import { parseModelRef, type BimpeilModelRef } from './origin';

export type UploadPhase = 'hash' | 'upload';

export interface ViewerUpload {
  done: Promise<{ ref: BimpeilModelRef; newVersion: boolean }>;
  cancel: () => void;
}

const isObject = (data: unknown): data is Record<string, unknown> => !!data && typeof data === 'object';

export function uploadToBimpeil(projectId: string, file: File, onProgress: (phase: UploadPhase, fraction: number) => void): ViewerUpload {
  const id = crypto.randomUUID();
  const send = (message: Record<string, unknown>) => window.parent.postMessage(message, window.location.origin);
  let cleanup = () => {};

  const done = new Promise<{ ref: BimpeilModelRef; newVersion: boolean }>((resolve, reject) => {
    if (window.parent === window) {
      reject(new Error('Uploaden kan alleen in BIMpeil.'));
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent || !isObject(event.data) || event.data.id !== id) return;
      const data = event.data;
      if (data.type === 'bimpeil:upload-progress' && (data.phase === 'hash' || data.phase === 'upload') && typeof data.fraction === 'number') {
        onProgress(data.phase, data.fraction);
      } else if (data.type === 'bimpeil:upload-done') {
        cleanup();
        const ref = parseModelRef(data.ref);
        if (ref) resolve({ ref, newVersion: data.newVersion === true });
        else reject(new Error('Onverwacht antwoord van BIMpeil.'));
      } else if (data.type === 'bimpeil:upload-failed') {
        cleanup();
        reject(new Error(typeof data.error === 'string' ? data.error : 'De upload is mislukt.'));
      }
    };
    window.addEventListener('message', onMessage);
    cleanup = () => window.removeEventListener('message', onMessage);
    send({ type: 'bimpeil:upload', id, projectId, file });
  });

  return { done, cancel: () => send({ type: 'bimpeil:upload-cancel', id }) };
}
