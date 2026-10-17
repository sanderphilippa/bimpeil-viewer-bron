/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: een opgeslagen change set omzetten naar een geopend model (V4b).
 *
 * Mutaties van IfcLite verwijzen naar express ID's, die per versie verschillen. Bij opslaan leggen
 * wij per mutatie ook de GlobalId vast (`withGlobalIds`). Op dezelfde versie gaat alles mee zoals
 * het is. Op een andere versie:
 * - elk element wordt opgezocht via de GlobalId; bestaat het niet meer, dan overslaan;
 * - eigenschappen, hoeveelheden en attributen: is de huidige waarde in het nieuwe IFC anders dan de
 *   oude waarde bij de wijziging, dan overslaan (conflict, besluit 3 oktober 2026: nieuwer werk in
 *   het IFC gaat voor);
 * - positie, type, nieuwe en verwijderde elementen: niet over te zetten, overslaan;
 * - hele eigenschap- en hoeveelheidssets: zonder controle, want IfcLite bewaart daar geen oude waarde
 *   per regel.
 */

import type { Mutation } from '@ifc-lite/mutations';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { FederatedModel } from '@/store';
import { resolveBaseAttributeValue } from '@/utils/configureMutationView';

/** Opgeslagen mutatie: zonder sessie modelId, met de GlobalId van het element */
export type StoredMutation = Omit<Mutation, 'modelId'> & { globalId?: string };

export interface TransferResult {
  /** Toe te passen mutaties, met het modelId en de express ID's van het geopende model */
  mutations: Mutation[];
  /** Element bestaat niet (meer) in deze versie */
  missing: number;
  /** Waarde in het IFC is intussen anders; omschrijving per conflict */
  conflicts: string[];
  /** Soort wijziging die niet naar een andere versie over te zetten is */
  untransferable: number;
}

const NOT_TRANSFERABLE = new Set<Mutation['type']>(['UPDATE_POSITIONAL_ATTRIBUTE', 'UPDATE_ENTITY_TYPE', 'CREATE_ENTITY', 'DELETE_ENTITY']);
const PROPERTY = new Set<Mutation['type']>(['CREATE_PROPERTY', 'UPDATE_PROPERTY', 'DELETE_PROPERTY']);

/** Waarden vergelijken zoals ze in JSON staan (leeg en ontbrekend zijn gelijk) */
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Per mutatie de GlobalId van het element toevoegen, voor opslaan */
export function withGlobalIds(model: FederatedModel, mutations: readonly Mutation[]): StoredMutation[] {
  const entities = model.ifcDataStore?.entities;
  return mutations.map(({ modelId: _session, ...m }) => {
    const globalId = m.entityId > 0 ? entities?.getGlobalId(m.entityId) || undefined : undefined;
    return globalId ? { ...m, globalId } : m;
  });
}

/** Omschrijving van een conflict voor de melding */
function describe(m: StoredMutation, model: FederatedModel): string {
  const name = model.ifcDataStore?.entities.getName(m.entityId) || m.globalId || `#${m.entityId}`;
  const what = m.attributeName ?? [m.psetName, m.propName].filter(Boolean).join('.');
  return `${what} op ${name}`;
}

export function transferChangeSet(
  stored: readonly StoredMutation[],
  model: FederatedModel,
  view: MutablePropertyView,
  sameVersion: boolean,
): TransferResult {
  const modelId = model.id;
  if (sameVersion) {
    return { mutations: stored.map(({ globalId: _g, ...m }) => ({ ...m, modelId }) as Mutation), missing: 0, conflicts: [], untransferable: 0 };
  }

  const dataStore = model.ifcDataStore;
  const result: TransferResult = { mutations: [], missing: 0, conflicts: [], untransferable: 0 };
  // Lopende waarde per eigenschap, hoeveelheid of attribuut: twee wijzigingen aan hetzelfde veld
  // achter elkaar vergelijken met de waarde na de eerste
  const running = new Map<string, unknown>();

  for (const m of stored) {
    if (NOT_TRANSFERABLE.has(m.type)) {
      result.untransferable++;
      continue;
    }
    // Model-brede wijziging (express ID 0) hoort niet bij een element
    let entityId = m.entityId;
    if (entityId > 0) {
      const found = m.globalId ? dataStore?.entities.getExpressIdByGlobalId(m.globalId) : undefined;
      if (found === undefined || found === null || found <= 0) {
        result.missing++;
        continue;
      }
      entityId = found;
    }

    let key: string | null = null;
    let current: unknown;
    if (PROPERTY.has(m.type) && m.psetName && m.propName) {
      key = `p:${entityId}:${m.psetName}:${m.propName}`;
      current = running.has(key) ? running.get(key) : view.getPropertyValue(entityId, m.psetName, m.propName);
    } else if ((m.type === 'CREATE_QUANTITY' || m.type === 'UPDATE_QUANTITY' || m.type === 'DELETE_QUANTITY') && m.psetName && m.propName) {
      key = `q:${entityId}:${m.psetName}:${m.propName}`;
      current = running.has(key)
        ? running.get(key)
        : view.getQuantitiesForEntity(entityId).find((q) => q.name === m.psetName)?.quantities.find((q) => q.name === m.propName)?.value;
    } else if (m.type === 'UPDATE_ATTRIBUTE' && m.attributeName) {
      key = `a:${entityId}:${m.attributeName}`;
      current = running.has(key)
        ? running.get(key)
        : (view.getAttributeMutationsForEntity(entityId).find((a) => a.name === m.attributeName)?.value ??
          (dataStore ? resolveBaseAttributeValue(dataStore, entityId, m.attributeName) : null));
    }

    if (key !== null) {
      if (!same(current, m.oldValue)) {
        result.conflicts.push(describe({ ...m, entityId }, model));
        continue;
      }
      running.set(key, m.type.startsWith('DELETE') ? null : m.newValue);
    }
    const { globalId: _g, ...rest } = m;
    result.mutations.push({ ...rest, entityId, modelId } as Mutation);
  }
  return result;
}
