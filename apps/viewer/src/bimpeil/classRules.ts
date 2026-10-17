/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: classificatieregels (12 oktober 2026, stap K2, besluiten punt 46). Een set uit BIMpeil is een boom van
 * klassen met regels in de vorm van `FilterGroup`; het formaat en de controle staan in BIMpeil
 * (`packages/shared/src/class-rules.ts`), de API onder `/api/projects/:id/class-rules`.
 *
 * Toewijzing, zoals een classificatie in Solibri: de klassen op volgorde; een element komt in de eerste klas waarvan de
 * regels passen en probeert daarna de kinderen van die klas; past geen kind, dan blijft het in de klas zelf. Een klas
 * zonder regels past op alles wat de ouder doorlaat. Zo heeft elk element binnen een set hooguit één klas, behalve onder
 * een klas op "elk op alles" (`childMode: 'all'`, K4c): daar rekent elke onderliggende klas op alle elementen van die
 * klas en kan een element in meer ervan staan.
 *
 * Deze module is zonder store en zonder React (te testen met een eigen `evaluate`); de store en het rekenen op de
 * geladen modellen staan in classRulesStore.ts.
 */

import { isFilterGroup, type FilterGroup } from '@ifc-lite/rules';

export interface RuleClass {
  id: string;
  code?: string;
  name: string;
  color: string;
  groups: FilterGroup[];
  children?: RuleClass[];
  /** Onderliggende klassen (K4c): zonder dit veld wint de eerste die past; met 'all' rekent elke op alles van deze klas */
  childMode?: 'all';
  /**
   * Regeltabel van BIMpeil (K4d): kolommen van de tabel eronder en de getypte tekst per kolom. De viewer rekent er niet
   * mee (de regels in `groups` zijn de waarheid), maar laat ze staan zodat opslaan hier ze niet weggooit.
   */
  columns?: unknown[];
  cells?: Record<string, string>;
}

export interface ClassRulesDefinition {
  schema: 1;
  classes: RuleClass[];
  /** Regeltabel van BIMpeil (K4d): kolommen op het hoogste niveau, alleen doorgegeven */
  columns?: unknown[];
}

/** Een set in de lijst van het project */
export interface ClassRuleSetSummary {
  id: string;
  name: string;
  description: string | null;
  version: number;
  classCount: number;
}

/** Een geladen set: de gekozen versie met de definitie */
export interface LoadedClassRuleSet {
  id: string;
  name: string;
  version: number;
  latestVersion: number;
  definition: ClassRulesDefinition;
  canEdit: boolean;
}

/** Kandidaten of treffers per model: expressIds */
export type IdsByModel = Map<string, number[]>;

/** Rekent de regels van één klas uit binnen de kandidaten; geeft de treffers per model */
export type EvaluateGroups = (groups: FilterGroup[], candidates: IdsByModel) => Promise<IdsByModel>;

export interface Assignment {
  /** Per klas de elementen die in die klas zelf staan (niet in een kind) */
  own: Map<string, IdsByModel>;
  /** Per klas alles eronder, ook in de kinderen */
  all: Map<string, IdsByModel>;
  /** Wat in geen enkele klas past */
  unclassified: IdsByModel;
}

const count = (ids: IdsByModel) => [...ids.values()].reduce((n, list) => n + list.length, 0);
export const idsCount = count;

/** `a` zonder wat in `b` staat */
function without(a: IdsByModel, b: IdsByModel): IdsByModel {
  const out: IdsByModel = new Map();
  for (const [modelId, list] of a) {
    const drop = new Set(b.get(modelId) ?? []);
    const kept = drop.size ? list.filter((id) => !drop.has(id)) : list;
    if (kept.length) out.set(modelId, kept);
  }
  return out;
}

/** Alles uit `a` en `b` samen */
function union(a: IdsByModel, b: IdsByModel): IdsByModel {
  const out: IdsByModel = new Map([...a].map(([m, l]) => [m, [...l]]));
  for (const [modelId, list] of b) {
    const have = new Set(out.get(modelId) ?? []);
    out.set(modelId, [...(out.get(modelId) ?? []), ...list.filter((id) => !have.has(id))]);
  }
  return out;
}

/** Alleen wat ook in `scope` staat (de evaluator mag nooit buiten de kandidaten treffen, maar zeker is zeker) */
function within(found: IdsByModel, scope: IdsByModel): IdsByModel {
  const out: IdsByModel = new Map();
  for (const [modelId, list] of found) {
    const allowed = new Set(scope.get(modelId) ?? []);
    const kept = list.filter((id) => allowed.has(id));
    if (kept.length) out.set(modelId, kept);
  }
  return out;
}

/**
 * De klassen toewijzen aan de kandidaten (de elementen van de geladen modellen). Elke klas rekent alleen op wat zijn
 * ouder doorliet en wat een eerdere broer of zus nog niet nam.
 */
export async function assignClasses(classes: RuleClass[], candidates: IdsByModel, evaluate: EvaluateGroups, signal?: AbortSignal): Promise<Assignment> {
  const own = new Map<string, IdsByModel>();
  const all = new Map<string, IdsByModel>();
  // `overlap`: de klassen in `list` rekenen elk op de hele `pool` (de ouder staat op elk op alles); anders eerste die past
  const walk = async (list: RuleClass[], pool: IdsByModel, overlap: boolean): Promise<IdsByModel> => {
    let remaining = pool;
    let taken: IdsByModel = new Map();
    for (const cls of list) {
      if (signal?.aborted) throw new DOMException('Classificatieregels afgebroken', 'AbortError');
      const from = overlap ? pool : remaining;
      const matched = count(from) === 0 ? new Map() : cls.groups.length === 0 ? from : within(await evaluate(cls.groups, from), from);
      if (overlap) taken = union(taken, matched);
      else remaining = without(remaining, matched);
      all.set(cls.id, matched);
      own.set(cls.id, cls.children?.length ? await walk(cls.children, matched, cls.childMode === 'all') : matched);
    }
    // Wat in geen van deze klassen viel, blijft bij de ouder
    return overlap ? without(pool, taken) : remaining;
  };
  const unclassified = await walk(classes, candidates, false);
  return { own, all, unclassified };
}

/** De klassen in boomvolgorde, met hun diepte */
export function flattenClasses(classes: RuleClass[], depth = 0): { cls: RuleClass; depth: number }[] {
  return classes.flatMap((cls) => [{ cls, depth }, ...flattenClasses(cls.children ?? [], depth + 1)]);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Wat de API teruggeeft, nog eens nagaan in de vorm van IfcLite; anders liever niets dan een verkeerde klas */
export function parseDefinition(raw: unknown): ClassRulesDefinition | null {
  if (!isObject(raw) || raw.schema !== 1 || !Array.isArray(raw.classes)) return null;
  const walk = (list: unknown[]): RuleClass[] | null => {
    const out: RuleClass[] = [];
    for (const item of list) {
      if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.color !== 'string') return null;
      if (!Array.isArray(item.groups) || !item.groups.every(isFilterGroup)) return null;
      const children = Array.isArray(item.children) ? walk(item.children) : [];
      if (!children) return null;
      out.push({
        id: item.id,
        ...(typeof item.code === 'string' ? { code: item.code } : {}),
        name: item.name,
        color: item.color,
        groups: item.groups as FilterGroup[],
        ...(children.length ? { children } : {}),
        ...(item.childMode === 'all' ? { childMode: 'all' as const } : {}),
        ...(Array.isArray(item.columns) ? { columns: item.columns } : {}),
        ...(isObject(item.cells) ? { cells: item.cells as Record<string, string> } : {}),
      });
    }
    return out;
  };
  const classes = walk(raw.classes);
  return classes ? { schema: 1, classes, ...(Array.isArray(raw.columns) ? { columns: raw.columns } : {}) } : null;
}

// --------------------------------------------------------------------------------------------- bewerken (K3)

/** Kleuren voor een nieuwe klas, op volgorde; geen amber (dat is in BIMpeil alleen voor de bel) */
export const CLASS_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#0d9488', '#db2777', '#4f46e5', '#65a30d', '#0891b2', '#7c3aed'];

/** Soorten regels die BIMpeil in een klas toestaat (packages/shared/src/class-rules.ts); de rest staat niet in de editor */
export const CLASS_RULE_KINDS = new Set([
  'ifcType', 'predefinedType', 'storey', 'name', 'attribute', 'property', 'quantity', 'material', 'classification', 'elevation', 'type', 'parent', 'group',
] as const);

export const newClassId = () => `k${Math.random().toString(36).slice(2, 10)}`;

/** De lijst waarin een klas staat, met de plek */
function locate(classes: RuleClass[], id: string): { list: RuleClass[]; index: number; parent: RuleClass | null } | null {
  const walk = (list: RuleClass[], parent: RuleClass | null): ReturnType<typeof locate> => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return { list, index: i, parent };
      const found = walk(list[i].children ?? [], list[i]);
      if (found) return found;
    }
    return null;
  };
  return walk(classes, null);
}

/** Diepe kopie, zodat React en de store elke wijziging als nieuw zien */
const copy = (classes: RuleClass[]): RuleClass[] => structuredClone(classes);
const tidy = (cls: RuleClass) => {
  if (cls.children && cls.children.length === 0) delete cls.children;
};

export function findClass(classes: RuleClass[], id: string): RuleClass | null {
  const at = locate(classes, id);
  return at ? at.list[at.index] : null;
}

/** Een nieuwe klas: na `afterId` op hetzelfde niveau, als laatste kind van `parentId`, of anders onderaan */
export function addClass(classes: RuleClass[], cls: RuleClass, where: { afterId?: string; parentId?: string } = {}): RuleClass[] {
  const next = copy(classes);
  if (where.parentId) {
    const parent = findClass(next, where.parentId);
    if (parent) {
      parent.children = [...(parent.children ?? []), cls];
      return next;
    }
  }
  const at = where.afterId ? locate(next, where.afterId) : null;
  if (at) at.list.splice(at.index + 1, 0, cls);
  else next.push(cls);
  return next;
}

export function updateClass(classes: RuleClass[], id: string, patch: Partial<Omit<RuleClass, 'id' | 'children'>>): RuleClass[] {
  const next = copy(classes);
  const cls = findClass(next, id);
  if (cls) Object.assign(cls, patch);
  if (cls && patch.code !== undefined && !patch.code) delete cls.code;
  return next;
}

export function removeClass(classes: RuleClass[], id: string): RuleClass[] {
  const next = copy(classes);
  const at = locate(next, id);
  if (!at) return next;
  at.list.splice(at.index, 1);
  if (at.parent) tidy(at.parent);
  return next;
}

/** Eén plek omhoog of omlaag binnen hetzelfde niveau (de volgorde bepaalt welke klas wint) */
export function moveClass(classes: RuleClass[], id: string, delta: -1 | 1): RuleClass[] {
  const next = copy(classes);
  const at = locate(next, id);
  if (!at) return next;
  const to = at.index + delta;
  if (to < 0 || to >= at.list.length) return next;
  const [cls] = at.list.splice(at.index, 1);
  at.list.splice(to, 0, cls);
  return next;
}

/** Inspringen: laatste kind van de klas erboven. Uitspringen: direct na de ouder. */
export function indentClass(classes: RuleClass[], id: string, direction: 'in' | 'out'): RuleClass[] {
  const next = copy(classes);
  const at = locate(next, id);
  if (!at) return next;
  const cls = at.list[at.index];
  if (direction === 'in') {
    if (at.index === 0) return next;
    const above = at.list[at.index - 1];
    at.list.splice(at.index, 1);
    above.children = [...(above.children ?? []), cls];
    return next;
  }
  if (!at.parent) return next;
  const outer = locate(next, at.parent.id);
  if (!outer) return next;
  at.list.splice(at.index, 1);
  tidy(at.parent);
  outer.list.splice(outer.index + 1, 0, cls);
  return next;
}

/**
 * Klaar om op te slaan: groepen zonder regels weg (BIMpeil weigert ze). Een klas met alleen lege groepen is nog niet
 * af: zonder groepen zou hij alles nemen wat over is, en dat is iets anders dan wat de gebruiker ziet (een lege groep
 * past nergens op). Dan een fout met de naam van de klas.
 */
export function forSave(definition: ClassRulesDefinition): { definition: ClassRulesDefinition } | { error: string } {
  let error: string | null = null;
  const clean = (list: RuleClass[]): RuleClass[] =>
    list.map((cls) => {
      const groups = cls.groups.filter((g) => g.rules.length > 0);
      if (cls.groups.length > 0 && groups.length === 0 && !error) {
        error = `Klas "${cls.name}" heeft een lege groep regels. Geef een regel, of haal de groep weg als de klas alles mag nemen wat over is.`;
      }
      const out: RuleClass = { ...cls, groups };
      if (cls.children?.length) out.children = clean(cls.children);
      else delete out.children;
      return out;
    });
  const classes = clean(definition.classes);
  return error ? { error } : { definition: { schema: 1, classes, ...(definition.columns ? { columns: definition.columns } : {}) } };
}
