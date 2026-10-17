/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: vaste gevallen voor classificatieregels (classRules.ts, classRulesTree.ts): toewijzing, lezen en de boom. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FilterGroup } from '@ifc-lite/rules';
import {
  addClass, assignClasses, findClass, flattenClasses, forSave, idsCount, indentClass, moveClass, parseDefinition, removeClass, updateClass,
  type EvaluateGroups, type IdsByModel, type RuleClass,
} from './classRules';
import { classBuckets, OWN_LABEL, UNCLASSIFIED_LABEL } from './classRulesTree';
import type { ClassMember, ClassResult } from './classRulesStore';

/**
 * Een kleine wereld zonder model: elementen met een klasse en een eigenschap. De nep `evaluate` begrijpt alleen
 * ifcType (in) en property (eq) en kijkt, zoals de echte, alleen naar de kandidaten.
 */
const ELEMENTS: Record<number, { type: string; loadBearing?: string }> = {
  1: { type: 'IfcWall', loadBearing: 'true' },
  2: { type: 'IfcWall', loadBearing: 'false' },
  3: { type: 'IfcWall' },
  4: { type: 'IfcSlab', loadBearing: 'true' },
  5: { type: 'IfcDoor' },
  6: { type: 'IfcWindow' },
};
const all = (): IdsByModel => new Map([['m1', Object.keys(ELEMENTS).map(Number)]]);
const type = (...values: string[]): FilterGroup => ({ combinator: 'AND', rules: [{ kind: 'ifcType', op: 'in', values }] });
const loadBearing = (value: string): FilterGroup => ({
  combinator: 'AND',
  rules: [{ kind: 'property', setName: 'Pset_WallCommon', propertyName: 'LoadBearing', op: 'eq', value }],
});
let calls = 0;
const evaluate: EvaluateGroups = async (groups, candidates) => {
  calls++;
  const hit = (id: number) =>
    groups.some((g) =>
      g.rules.every((r) =>
        r.kind === 'ifcType' ? r.values.includes(ELEMENTS[id].type) : r.kind === 'property' ? ELEMENTS[id].loadBearing === r.value : false,
      ),
    );
  return new Map([...candidates].map(([m, ids]) => [m, ids.filter(hit)]));
};
const cls = (id: string, groups: FilterGroup[], children?: RuleClass[]): RuleClass => ({ id, name: id, color: '#123456', groups, ...(children ? { children } : {}) });
const ids = (map: Map<string, IdsByModel>, id: string) => map.get(id)?.get('m1') ?? [];

test('eerste klas wint; een latere klas krijgt alleen wat over is', async () => {
  const r = await assignClasses([cls('dragend', [loadBearing('true')]), cls('wanden', [type('IfcWall')])], all(), evaluate);
  assert.deepEqual(ids(r.own, 'dragend'), [1, 4]);
  assert.deepEqual(ids(r.own, 'wanden'), [2, 3], 'wand 1 is al dragend');
  assert.deepEqual(r.unclassified.get('m1'), [5, 6]);
});

test('kinderen alleen binnen de ouder; wat geen kind past, blijft in de ouder', async () => {
  const r = await assignClasses(
    [cls('wanden', [type('IfcWall')], [cls('dragend', [loadBearing('true')]), cls('niet', [loadBearing('false')])]), cls('rest', [])],
    all(),
    evaluate,
  );
  assert.deepEqual(ids(r.own, 'dragend'), [1], 'de dragende vloer 4 is geen wand');
  assert.deepEqual(ids(r.own, 'niet'), [2]);
  assert.deepEqual(ids(r.own, 'wanden'), [3], 'zonder LoadBearing in de ouder');
  assert.deepEqual(ids(r.all, 'wanden'), [1, 2, 3]);
  assert.deepEqual(ids(r.own, 'rest'), [4, 5, 6], 'een klas zonder regels neemt de rest');
  assert.equal(idsCount(r.unclassified), 0);
});

test('elk element hooguit één klas, en niet rekenen als er niets meer over is', async () => {
  calls = 0;
  const r = await assignClasses([cls('alles', []), cls('wanden', [type('IfcWall')]), cls('deuren', [type('IfcDoor')])], all(), evaluate);
  assert.deepEqual(ids(r.own, 'alles'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ids(r.own, 'wanden'), []);
  assert.equal(calls, 0, 'na "alles" is er niets meer te rekenen');
  const seen = flattenClasses([cls('alles', []), cls('wanden', []), cls('deuren', [])]).flatMap(({ cls: c }) => ids(r.own, c.id));
  assert.equal(new Set(seen).size, seen.length);
});

test('een treffer buiten de kandidaten telt niet (vangnet om de evaluator)', async () => {
  const wild: EvaluateGroups = async () => new Map([['m1', [1, 99]], ['m2', [7]]]);
  const r = await assignClasses([cls('a', [type('IfcWall')])], new Map([['m1', [1, 2]]]), wild);
  assert.deepEqual([...r.own.get('a')!], [['m1', [1]]]);
});

test('afbreken stopt het rekenen', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(assignClasses([cls('a', [type('IfcWall')])], all(), evaluate, controller.signal), { name: 'AbortError' });
});

test('lezen: alleen de vorm van IfcLite, anders niets', () => {
  const ok = parseDefinition({ schema: 1, classes: [{ id: 'a', name: 'A', code: '21', color: '#000000', groups: [type('IfcWall')], children: [] }] });
  assert.deepEqual(ok, { schema: 1, classes: [{ id: 'a', code: '21', name: 'A', color: '#000000', groups: [type('IfcWall')] }] });
  assert.equal(parseDefinition({ schema: 2, classes: [] }), null);
  assert.equal(parseDefinition({ schema: 1, classes: [{ id: 'a', name: 'A', color: '#000000', groups: [{ rules: 'x', combinator: 'AND' }] }] }), null);
  assert.equal(parseDefinition({ schema: 1, classes: [{ id: 'a', name: 'A', color: '#000000', groups: [], children: [{ id: 'b' }] }] }), null);
});

test('boom: klassen op volgorde, (in de klas zelf) alleen bij kinderen, niet geclassificeerd onderaan', () => {
  const m = (expressId: number): ClassMember => ({ modelId: 'm1', expressId, globalId: expressId + 100 });
  const classes = [cls('wanden', [type('IfcWall')], [cls('dragend', [])]), cls('deuren', [])];
  const result: ClassResult = {
    own: new Map([['wanden', [m(3)]], ['dragend', [m(1)]], ['deuren', []]]),
    all: new Map([['wanden', [m(1), m(3)]], ['dragend', [m(1)]], ['deuren', []]]),
    unclassified: [m(6)],
  };
  const buckets = classBuckets(classes, result);
  assert.deepEqual(buckets.map((b) => `${b.label}:${b.members.length}`), ['wanden:2', 'deuren:0', `${UNCLASSIFIED_LABEL}:1`]);
  assert.deepEqual(buckets[0].children?.map((b) => `${b.label}:${b.members.length}`), ['dragend:1', `${OWN_LABEL}:1`]);
  assert.equal(buckets[1].children, undefined);
});

// --------------------------------------------------------------------------------------------- bewerken (K3)

const shape = (list: RuleClass[]) => flattenClasses(list).map(({ cls: c, depth }) => `${'.'.repeat(depth)}${c.id}`).join(' ');
const tree = () => [cls('a', []), cls('b', [], [cls('b1', []), cls('b2', [])]), cls('c', [])];

test('bewerken: toevoegen na een klas, als kind en onderaan; nooit de oude boom wijzigen', () => {
  const before = tree();
  assert.equal(shape(addClass(before, cls('n', []), { afterId: 'b1' })), 'a b .b1 .n .b2 c');
  assert.equal(shape(addClass(before, cls('n', []), { parentId: 'c' })), 'a b .b1 .b2 c .n');
  assert.equal(shape(addClass(before, cls('n', []))), 'a b .b1 .b2 c n');
  assert.equal(shape(before), 'a b .b1 .b2 c', 'de oude boom blijft');
});

test('bewerken: verplaatsen binnen een niveau, in- en uitspringen', () => {
  assert.equal(shape(moveClass(tree(), 'c', -1)), 'a c b .b1 .b2');
  assert.equal(shape(moveClass(tree(), 'a', -1)), 'a b .b1 .b2 c', 'bovenaan blijft bovenaan');
  assert.equal(shape(moveClass(tree(), 'b2', -1)), 'a b .b2 .b1 c');
  assert.equal(shape(indentClass(tree(), 'c', 'in')), 'a b .b1 .b2 .c');
  assert.equal(shape(indentClass(tree(), 'b2', 'in')), 'a b .b1 ..b2 c');
  assert.equal(shape(indentClass(tree(), 'a', 'in')), 'a b .b1 .b2 c', 'de eerste kan niet inspringen');
  assert.equal(shape(indentClass(tree(), 'b1', 'out')), 'a b .b2 b1 c', 'direct na de ouder');
  const last = indentClass(indentClass(tree(), 'b1', 'out'), 'b2', 'out');
  assert.equal(findClass(last, 'b')?.children, undefined, 'een lege lijst kinderen gaat weg');
});

test('bewerken: aanpassen en verwijderen (met de klassen eronder)', () => {
  const named = updateClass(tree(), 'b1', { name: 'Dragend', code: '21.1' });
  assert.equal(findClass(named, 'b1')?.name, 'Dragend');
  assert.equal(findClass(updateClass(named, 'b1', { code: '' }), 'b1')?.code, undefined, 'lege code weg');
  assert.equal(shape(removeClass(tree(), 'b')), 'a c');
  assert.equal(shape(removeClass(tree(), 'b2')), 'a b .b1 c');
});

test('opslaan: lege groepen weg; een klas met alleen lege groepen is nog niet af', () => {
  const empty = { combinator: 'AND' as const, rules: [] };
  const ok = forSave({ schema: 1, classes: [cls('a', [type('IfcWall'), empty]), cls('rest', [])] });
  assert.ok('definition' in ok);
  assert.equal(ok.definition.classes[0].groups.length, 1);
  const half = forSave({ schema: 1, classes: [cls('a', [], [cls('kind', [empty])])] });
  assert.ok('error' in half);
  assert.match(half.error, /Klas "kind" heeft een lege groep/);
});

// --------------------------------------------------------------------------------------------- elk op alles (K4c)

const ELEMENTS_W: Record<number, { type: string; mat: string; loadBearing?: string }> = {
  1: { type: 'IfcWall', mat: 'beton', loadBearing: 'true' },
  2: { type: 'IfcWall', mat: 'beton', loadBearing: 'false' },
  3: { type: 'IfcWall', mat: 'kzs', loadBearing: 'true' },
  4: { type: 'IfcWall', mat: 'gips' },
  5: { type: 'IfcSlab', mat: 'beton', loadBearing: 'true' },
};
const allW = (): IdsByModel => new Map([['m1', [1, 2, 3, 4, 5]]]);
const mat = (value: string): FilterGroup => ({ combinator: 'AND', rules: [{ kind: 'material', op: 'eq', value }] });
const evalW: EvaluateGroups = async (groups, candidates) => {
  const hit = (id: number) =>
    groups.some((g) =>
      g.rules.every((r) =>
        r.kind === 'ifcType' ? r.values.includes(ELEMENTS_W[id].type)
          : r.kind === 'property' ? ELEMENTS_W[id].loadBearing === r.value
            : r.kind === 'material' ? ELEMENTS_W[id].mat === r.value : false,
      ),
    );
  return new Map([...candidates].map(([m, ids]) => [m, ids.filter(hit)]));
};

test('elk op alles: elke onderliggende klas op alle elementen van de ouder, de rest blijft in de ouder', async () => {
  const wanden = { ...cls('wanden', [type('IfcWall')], [cls('beton', [mat('beton')]), cls('dragend', [loadBearing('true')])]), childMode: 'all' as const };
  const r = await assignClasses([wanden, cls('rest', [])], allW(), evalW);
  assert.deepEqual(ids(r.own, 'beton'), [1, 2]);
  assert.deepEqual(ids(r.own, 'dragend'), [1, 3], 'wand 1 staat ook in dragend');
  assert.deepEqual(ids(r.own, 'wanden'), [4], 'in geen van beide');
  assert.deepEqual(ids(r.all, 'wanden'), [1, 2, 3, 4]);
  assert.deepEqual(ids(r.own, 'rest'), [5], 'het hoogste niveau blijft eerste die past');
});

test('elk op alles met verdelingen: klassen zonder regels nemen alles, daaronder eerste die past met een rest', async () => {
  const materiaal = cls('materiaal', [], [cls('beton', [mat('beton')]), cls('overig-mat', [])]);
  const draag = cls('draag', [], [cls('dragend', [loadBearing('true')]), cls('niet-dragend', [])]);
  const wanden = { ...cls('wanden', [type('IfcWall')], [materiaal, draag]), childMode: 'all' as const };
  const r = await assignClasses([wanden], allW(), evalW);
  assert.deepEqual(ids(r.all, 'materiaal'), [1, 2, 3, 4]);
  assert.deepEqual(ids(r.all, 'draag'), [1, 2, 3, 4]);
  assert.deepEqual(ids(r.own, 'beton'), [1, 2]);
  assert.deepEqual(ids(r.own, 'overig-mat'), [3, 4]);
  assert.deepEqual(ids(r.own, 'dragend'), [1, 3]);
  assert.deepEqual(ids(r.own, 'niet-dragend'), [2, 4], 'wand 4 zonder LoadBearing valt in de rest');
  assert.deepEqual(ids(r.own, 'wanden'), [], 'elke wand zit in een verdeling');
  assert.deepEqual(r.unclassified.get('m1'), [5]);
});

test('regeltabel van BIMpeil: kolommen en cellen blijven bij lezen en opslaan staan', () => {
  const raw = {
    schema: 1,
    columns: [{ id: 'ifc', kind: 'ifcType' }],
    classes: [{ id: 'w', name: 'Wanden', color: '#000000', groups: [type('IfcWall')], cells: { ifc: 'IfcWall' }, columns: [{ id: 'mat', kind: 'material' }] }],
  };
  const def = parseDefinition(raw)!;
  assert.deepEqual(def.columns, raw.columns);
  assert.deepEqual(def.classes[0].cells, { ifc: 'IfcWall' });
  assert.deepEqual(def.classes[0].columns, [{ id: 'mat', kind: 'material' }]);
  const saved = forSave(def);
  assert.ok('definition' in saved);
  assert.deepEqual(saved.definition.columns, raw.columns);
  assert.deepEqual(saved.definition.classes[0].cells, { ifc: 'IfcWall' });
});
