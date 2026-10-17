/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: het actieve project uit de webapp eromheen. De webapp stuurt het met
 * `{ type: 'bimpeil:context', project }` (zie useBimpeilOpen.ts); het paneel BIMpeil bestanden leest het.
 */

import { create } from 'zustand';

export interface BimpeilProject {
  id: string;
  code: string;
  name: string;
}

export const useBimpeilContext = create<{ project: BimpeilProject | null; setProject: (project: BimpeilProject | null) => void }>((set) => ({
  project: null,
  setProject: (project) => set({ project }),
}));
