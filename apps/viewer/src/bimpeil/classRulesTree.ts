/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: de modelboom per klas van de gekozen classificatieregels (K2, Hierarchy, knop Klassen). Net als de indeling
 * per BIM basis ILS alleen groepen, geen elementen: een klas selecteert, isoleert en verbergt alles eronder. Heeft een
 * klas kinderen en staan er ook elementen in de klas zelf, dan staan die onder "(in de klas zelf)". Onderaan wat in
 * geen klas past. De boom leest de uitkomst uit classRulesStore.ts; rekenen gebeurt daar, niet hier.
 */

import type { TreeNode } from '@/components/viewer/hierarchy/types';
import { asNodes, type Bucket, type Member } from './ilsTree';
import type { RuleClass } from './classRules';
import { activeClasses, useClassRules, type ClassMember, type ClassResult } from './classRulesStore';

export const UNCLASSIFIED_LABEL = '(niet geclassificeerd)';
export const OWN_LABEL = '(in de classificatie zelf)';

const asMember = (m: ClassMember): Member => ({ ...m, name: '', ifcType: '' });

/** De klassen als groepen, in de volgorde van de set */
export function classBuckets(classes: RuleClass[], result: ClassResult): Bucket[] {
  const walk = (list: RuleClass[]): Bucket[] =>
    list.map((cls) => {
      const children = cls.children?.length ? walk(cls.children) : [];
      const own = result.own.get(cls.id) ?? [];
      if (children.length && own.length) children.push({ key: `${cls.id}:eigen`, label: OWN_LABEL, members: own.map(asMember) });
      return {
        key: cls.id,
        label: cls.name,
        secondary: [cls.code, cls.childMode === 'all' ? 'elk op alles' : null].filter(Boolean).join(' · ') || undefined,
        members: (result.all.get(cls.id) ?? []).map(asMember),
        ...(children.length ? { children } : {}),
      };
    });
  const buckets = walk(classes);
  if (result.unclassified.length) buckets.push({ key: 'niet-geclassificeerd', label: UNCLASSIFIED_LABEL, members: result.unclassified.map(asMember) });
  return buckets;
}

/** Eén regel met uitleg als er (nog) niets te tonen is */
const hint = (name: string): TreeNode => ({
  id: 'klassen|hint',
  expressIds: [],
  globalIds: [],
  modelIds: [],
  name,
  type: 'ils-group',
  depth: 0,
  hasChildren: false,
  isExpanded: false,
  isVisible: true,
});

export function buildClassRulesTree(state: { classes: RuleClass[] | null; result: ClassResult | null; computing: boolean }): TreeNode[] {
  if (!state.classes) return [hint('Kies classificatieregels in het paneel Classificatieregels')];
  if (!state.result) return [hint(state.computing ? 'Classificaties worden uitgerekend…' : 'Open een model om de classificaties te zien')];
  if (state.classes.length === 0) return [hint('Deze classificatieregels hebben nog geen classificaties')];
  return asNodes(classBuckets(state.classes, state.result), 0, 'klassen');
}

/** Voor de modelboom (revealGlobalId.ts): de boom uit wat de store nu heeft */
export function buildClassRulesTreeFromStore(): TreeNode[] {
  const s = useClassRules.getState();
  return buildClassRulesTree({ classes: activeClasses(s), result: s.result, computing: s.computing });
}
