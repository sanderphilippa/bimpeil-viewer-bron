/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: twee versies van een bestand vergelijken met de vergelijking van IfcLite zelf (V5d).
 * De webapp stuurt `{ type: 'bimpeil:compare', base, head }`, elk `{ url, name, ref }`; useBimpeilOpen.ts
 * laadt wat nog niet open staat en roept daarna `selectComparison()` aan: oudere versie als A,
 * nieuwere als B, en het paneel Compare open. De vergelijking zelf start de gebruiker (data, geometrie
 * of beide), zoals altijd in IfcLite.
 */

import { useViewerStore, type FederatedModel } from '@/store';
import { bimpeilRefOf } from './origin';

/** Open model met precies deze versie uit BIMpeil, of null */
export function modelForVersion(versionId: string): FederatedModel | null {
  const models = Array.from(useViewerStore.getState().models.values()) as FederatedModel[];
  return models.find((m) => bimpeilRefOf(m)?.versionId === versionId) ?? null;
}

/**
 * A en B kiezen en het paneel Compare openen. Het paneel kiest bij openen zelf een standaard (de
 * eerste twee modellen) als B gelijk is aan het eerste model; daarom zetten we onze keuze na het
 * openen nog een keer, zonder de code van IfcLite aan te passen.
 */
export function selectComparison(baseId: string, headId: string): void {
  const apply = () => {
    const state = useViewerStore.getState();
    state.setCompareBaseModelId(baseId);
    state.setCompareHeadModelId(headId);
  };
  // Een eerdere uitkomst hoort bij een ander paar; weg ermee, zodat de kleuren in 3D kloppen
  useViewerStore.getState().clearCompare();
  apply();
  useViewerStore.getState().openWorkspacePanel('compare', 'programmatic');
  setTimeout(apply, 0);
}
