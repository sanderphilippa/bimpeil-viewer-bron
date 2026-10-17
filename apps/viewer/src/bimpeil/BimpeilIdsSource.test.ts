/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: vaste gevallen voor de lijsten van IDS uit BIMpeil (BimpeilIdsSource.tsx). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectIdsOf, usableTemplates } from './BimpeilIdsSource';

test('IDS van het project: alleen met een vaste versie, de laatste, op naam', () => {
  const list = [
    { id: 'a', name: 'Eisen constructie', fixed: { version: 3, header: { ifcVersions: ['IFC4', 'IFC4X3_ADD2'] } } },
    { id: 'b', name: 'Alleen een concept', fixed: null },
    { id: 'c', name: 'Basis', fixed: { version: 1, header: null } },
  ];
  assert.deepEqual(projectIdsOf(list), [
    { idsId: 'c', version: 1, name: 'Basis', sub: 'versie 1' },
    { idsId: 'a', version: 3, name: 'Eisen constructie', sub: 'versie 3, IFC4, IFC4X3_ADD2' },
  ]);
});

test('sjablonen: vervallen weg, op naam', () => {
  const list = [
    { versionId: '2', system: 'MiniBIM ILS (VO)', version: '3.1' },
    { versionId: '1', system: 'BIM basis ILS (IFC4)', version: '2.0' },
    { versionId: '3', system: 'Oud', version: '1', deprecated: true },
  ];
  assert.deepEqual(usableTemplates(list).map((t) => t.versionId), ['1', '2']);
});

test('Flow: een IDS alleen uit BIMpeil (de naam begint met het voorvoegsel)', async () => {
  const { assertIdsFromBimpeil, BIMPEIL_IDS_PREFIX } = await import('./idsOnly');
  assert.doesNotThrow(() => assertIdsFromBimpeil(`${BIMPEIL_IDS_PREFIX}BIM basis ILS (IFC4)`));
  assert.throws(() => assertIdsFromBimpeil('eigen.ids'), /alleen uit BIMpeil/);
});
