/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: geen browsercache voor een model dat uit BIMpeil komt (audit VIEW-001, branch browser-wissen-2, 18 oktober
 * 2026, besluiten punt 140). IfcLite bewaart een geladen model in IndexedDB (`ifc-lite-cache`), met geometrie, het
 * volledige bestand en de naam, en een sleutel zonder versie, gebruiker of organisatie. Voor een model uit BIMpeil gaf
 * dat nooit een treffer (het `File` heeft bij elk openen een nieuwe wijzigingsdatum), maar het model bleef wel staan,
 * ook WIP van een ander taakteam, voor de volgende gebruiker van de computer. Een lokaal geopend bestand houdt de cache.
 * De webapp wist de cache bovendien bij uitloggen (`apps/web/src/browser-data.ts`).
 */

import type { CachePlan } from '../hooks/cacheTier.js';

/** Het plan van IfcLite, maar zonder cache als het model uit BIMpeil komt: niet lezen en niet schrijven */
export function withoutBimpeilCache(plan: CachePlan, fromBimpeil: boolean): CachePlan {
  return fromBimpeil ? { ...plan, tier: 'none', shouldCache: false, persistSource: false } : plan;
}
