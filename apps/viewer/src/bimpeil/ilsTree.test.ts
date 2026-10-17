/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: vaste gevallen voor de indeling per BIM basis ILS (ilsTree.ts): waarden, groepen en de regels eronder. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asNodes, bucketsByValue, ILS_CHAPTERS, NO_VALUE, valueText, withoutElements, type Member } from './ilsTree';

const m = (expressId: number, name: string): Member => ({ modelId: 'm1', expressId, globalId: expressId + 100, name, ifcType: 'IfcWall' });

test('waarden zoals de gebruiker ze leest', () => {
  assert.equal(valueText(true), 'Waar');
  assert.equal(valueText(false), 'Onwaar');
  assert.equal(valueText(0.2345678), '0.235');
  assert.equal(valueText(60), '60');
  assert.equal(valueText('  REI 60 '), 'REI 60');
  assert.equal(valueText(''), null);
  assert.equal(valueText(null), null);
});

test('groepen per waarde: natuurlijke volgorde, (geen waarde) onderaan, een element onder meer waarden', () => {
  const buckets = bucketsByValue(
    [
      { member: m(1, 'A'), values: ['21.32'] },
      { member: m(2, 'B'), values: ['21.4'] },
      { member: m(3, 'C'), values: [] },
      { member: m(4, 'D'), values: ['21.32', '22.1'] },
    ],
    'code:',
    (code) => (code === '21.32' ? 'Buitenwanden' : undefined),
  );
  assert.deepEqual(
    buckets.map((b) => `${b.label}${b.secondary ? ` (${b.secondary})` : ''}: ${b.members.map((x) => x.name).join(',')}`),
    ['21.4: B', '21.32 (Buitenwanden): A,D', '22.1: D', `${NO_VALUE}: C`],
  );
});

test('regels: alleen groepen, geen elementen; een groep selecteert zijn elementen', () => {
  const nodes = asNodes(
    [
      { key: 'x', label: 'Bouwlaag 00', members: [m(2, 'Wand B'), m(1, 'Wand A')] },
      { key: 'y', label: 'IfcWall', members: [m(1, 'Wand A')], children: [{ key: 'z', label: 'SOLIDWALL', members: [m(1, 'Wand A')] }] },
    ],
    1,
    'ils|3.3',
  );
  assert.deepEqual(
    nodes.map((n) => `${n.depth} ${n.type} ${n.name} ${n.hasChildren ? 'open' : 'blad'}`),
    ['1 ils-group Bouwlaag 00 blad', '1 ils-group IfcWall open', '2 ils-group SOLIDWALL blad'],
  );
  assert.equal(nodes[0].elementCount, 2);
  assert.deepEqual(nodes[0].globalIds, [102, 101]);
  assert.equal(new Set(nodes.map((n) => n.id)).size, 3);
});

test('indeling van IfcLite zonder elementregels: een type zonder groepen eronder wordt een blad', () => {
  const node = (id: string, depth: number, type: string, hasChildren: boolean) =>
    ({ id, depth, type, hasChildren, isExpanded: hasChildren, expressIds: [], globalIds: [], modelIds: [], name: id, isVisible: true }) as never;
  const rows = withoutElements([
    node('IfcWallType', 0, 'type-group', true),
    node('W01', 1, 'ifc-type', true),
    node('wand1', 2, 'element', false),
    node('W02', 1, 'ifc-type', true),
    node('wand2', 2, 'element', false),
  ]);
  assert.deepEqual(rows.map((n) => `${n.id} ${n.hasChildren ? 'open' : 'blad'}`), ['IfcWallType open', 'W01 blad', 'W02 blad']);
});

test('de hoofdstukken van de BIM basis ILS, zonder 4.8 Projectspecifiek', () => {
  assert.deepEqual(
    ILS_CHAPTERS.map((c) => c.id),
    ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7', '3.8', '4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7'],
  );
});
