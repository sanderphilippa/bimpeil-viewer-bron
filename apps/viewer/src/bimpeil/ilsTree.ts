/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: Hierarchy ingedeeld per hoofdstuk van de BIM basis ILS (tweede versie, digigo.nu; 7 oktober 2026). Elk
 * hoofdstuk is een vaste regel; daaronder wat dat hoofdstuk regelt, zoals bij 3.3 alle bouwlagen met hun elementen.
 * Nog zonder oordeel (voldoet of niet). 4.8 Projectspecifiek heeft geen regel: dat verschilt per project.
 *
 * Een hoofdstuk wordt pas berekend als het uitgeklapt is (eigenschappen en classificaties leest IfcLite per element
 * uit de bron) en daarna bewaard per modellen en geometrie; zoeken vindt daarom alleen iets in uitgeklapte
 * hoofdstukken. Binnen een hoofdstuk komt de hele tak in één keer; uitklappen daarbinnen doet de projectie.
 *
 * Onder een hoofdstuk staan alleen groepen (bij 3.3 de bouwlagen), geen elementen (besluit Sander, 8 oktober 2026): een
 * groepsregel (`ils-group`) selecteert, isoleert en verbergt zijn elementen via `globalIds`. Bij 4.1 zijn de ruimten
 * zelf het onderwerp, net als de bouwlagen bij 3.3: elke ruimte een regel. Hoofdstuk 3.5, 4.1 (zones), 4.2 en 4.7
 * hergebruiken de indelingen Type, Groups en Material van IfcLite, zonder hun elementregels, één niveau dieper en met
 * het hoofdstuk voor de id.
 */
import {
  extractClassificationsOnDemand,
  extractPropertiesOnDemand,
  extractTypePropertiesOnDemand,
  type IfcDataStore,
} from '@ifc-lite/parser';
import { resolveEntityPredefinedType } from '@ifc-lite/rules';
import type { FederatedModel } from '@/store';
import type { ExpansionLookup, TreeNode } from '@/components/viewer/hierarchy/types';
import { buildGroupTree, buildIfcTypeTree, buildMaterialTree } from '@/components/viewer/hierarchy/treeDataBuilder';
import { makeAssemblyGeometry, resolveTreeGlobalId } from '@/components/viewer/hierarchy/productTree';
import type { TreeOverlay } from '@/components/viewer/hierarchy/treeOverlay';

export const NO_VALUE = '(geen waarde)';
const EXPAND_ALL: ExpansionLookup = { has: () => true };
const collator = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });

/** Een element in een groep */
export interface Member {
  modelId: string;
  expressId: number;
  globalId: number;
  name: string;
  ifcType: string;
}

/** Een groep onder een hoofdstuk, eventueel met groepen eronder */
export interface Bucket {
  key: string;
  label: string;
  secondary?: string;
  members: Member[];
  children?: Bucket[];
}

export interface IlsContext {
  models: Map<string, FederatedModel>;
  ifcDataStore: IfcDataStore | null | undefined;
  isMultiModel: boolean;
  geometricIds: Set<number>;
  geometryReadyModelIds: ReadonlySet<string>;
  overlay: TreeOverlay;
}

/** Elk model met zijn data store; zonder federatie het ene model als 'legacy' */
function stores(ctx: IlsContext): { modelId: string; name: string; store: IfcDataStore; model?: FederatedModel }[] {
  if (ctx.models.size > 0) {
    const out: { modelId: string; name: string; store: IfcDataStore; model?: FederatedModel }[] = [];
    const seen = new Set<IfcDataStore>();
    for (const [modelId, model] of ctx.models) {
      if (!model.ifcDataStore || seen.has(model.ifcDataStore)) continue;
      seen.add(model.ifcDataStore);
      out.push({ modelId, name: model.name, store: model.ifcDataStore, model });
    }
    return out;
  }
  return ctx.ifcDataStore ? [{ modelId: 'legacy', name: 'Model', store: ctx.ifcDataStore }] : [];
}

/** De elementen die in de andere productindelingen staan: producten die renderen (makeAssemblyGeometry) */
function products(ctx: IlsContext, modelId: string, store: IfcDataStore): Member[] {
  const geometry = makeAssemblyGeometry(store, modelId, ctx.models, ctx.geometricIds, ctx.geometryReadyModelIds.has(modelId));
  const out: Member[] = [];
  for (let i = 0; i < store.entities.count; i++) {
    const expressId = store.entities.expressId[i];
    const ifcType = store.entities.getTypeName(expressId) || 'Unknown';
    const globalId = resolveTreeGlobalId(modelId, expressId, ctx.models);
    if (!geometry.renders(ifcType, expressId, globalId)) continue;
    out.push({ modelId, expressId, globalId, name: store.entities.getName(expressId) || `${ifcType} #${expressId}`, ifcType });
  }
  return out;
}

/** Leden per waarde als groepen, op volgorde (getallen natuurlijk), (geen waarde) onderaan */
export function bucketsByValue(entries: { member: Member; values: string[] }[], keyPrefix: string, secondary?: (value: string) => string | undefined): Bucket[] {
  const byValue = new Map<string, Member[]>();
  for (const { member, values } of entries) {
    for (const value of values.length > 0 ? values : [NO_VALUE]) byValue.set(value, [...(byValue.get(value) ?? []), member]);
  }
  return [...byValue.keys()]
    .sort((a, b) => (a === NO_VALUE ? 1 : b === NO_VALUE ? -1 : collator.compare(a, b)))
    .map((value) => ({ key: `${keyPrefix}${value}`, label: value, secondary: value === NO_VALUE ? undefined : secondary?.(value), members: byValue.get(value)! }));
}

/** Waarde van een eigenschap als tekst, zoals de gebruiker hem leest */
export function valueText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Waar' : 'Onwaar';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(', ') || null;
  return String(value).trim() || null;
}

// --------------------------------------------------------------------------------------------- eigenschappen

type Psets = { name: string; properties: { name: string; value: unknown }[] }[];
/** Eigenschappen per element, van het element zelf en van zijn type; per data store bewaard */
const psetCache = new WeakMap<IfcDataStore, Map<number, Psets>>();
function psetsOf(store: IfcDataStore, expressId: number): Psets {
  let perStore = psetCache.get(store);
  if (!perStore) psetCache.set(store, (perStore = new Map()));
  const cached = perStore.get(expressId);
  if (cached) return cached;
  let own: Psets = [];
  let fromType: Psets = [];
  try {
    own = extractPropertiesOnDemand(store, expressId) as Psets;
  } catch {
    own = [];
  }
  try {
    fromType = (extractTypePropertiesOnDemand(store, expressId)?.properties ?? []) as Psets;
  } catch {
    fromType = [];
  }
  // Het element gaat voor het type (zoals in de properties van IfcLite)
  const psets = [...own, ...fromType.filter((t) => !own.some((o) => o.name === t.name))];
  perStore.set(expressId, psets);
  return psets;
}

/** Een eigenschap uit de gangbare buildingSMART set (Pset_…Common), anders uit elke set */
function propertyValue(psets: Psets, property: string): string | null {
  const common = psets.filter((p) => /^Pset_.*Common$/i.test(p.name));
  for (const group of [common, psets]) {
    for (const pset of group) {
      const prop = pset.properties.find((p) => p.name === property);
      const text = prop ? valueText(prop.value) : null;
      if (text) return text;
    }
  }
  return null;
}

// --------------------------------------------------------------------------------------------- hoofdstukken

interface Chapter {
  id: string;
  title: string;
  /** Groepen (eigen indeling) of regels van een indeling van IfcLite (al met diepte vanaf 0) */
  build(ctx: IlsContext): Bucket[] | TreeNode[];
}

const metres = (m: number) => (Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(1)} m`);

const propertyChapter = (id: string, title: string, property: string): Chapter => ({
  id,
  title,
  build(ctx) {
    const entries = stores(ctx).flatMap(({ modelId, store }) =>
      products(ctx, modelId, store).map((member) => {
        const value = propertyValue(psetsOf(store, member.expressId), property);
        return { member, values: value ? [value] : [] };
      }),
    );
    return bucketsByValue(entries, `${property}:`);
  },
});

export const ILS_CHAPTERS: Chapter[] = [
  {
    id: '3.1',
    title: 'Bestandsnaam',
    build: (ctx) => stores(ctx).map(({ modelId, name, store }) => ({ key: modelId, label: name, members: products(ctx, modelId, store) })),
  },
  {
    id: '3.2',
    title: 'Lokale positie',
    build: (ctx) =>
      stores(ctx).map(({ modelId, name, store, model }) => {
        const bounds = model?.geometryResult?.coordinateInfo?.originalBounds;
        let secondary = 'positie nog onbekend';
        if (bounds) {
          const c = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 };
          secondary = `midden op ${metres(Math.hypot(c.x, c.y, c.z))} van het nulpunt`;
        }
        return { key: modelId, label: name, secondary, members: products(ctx, modelId, store) };
      }),
  },
  {
    id: '3.3',
    title: 'Bouwlaagindeling en naamgeving',
    build(ctx) {
      const out: Bucket[] = [];
      const loose: Member[] = [];
      for (const { modelId, name, store } of stores(ctx)) {
        const all = products(ctx, modelId, store);
        const byId = new Map(all.map((m) => [m.expressId, m]));
        const sh = store.spatialHierarchy;
        const storeys = [...(sh?.byStorey?.keys() ?? [])].sort((a, b) => (sh!.storeyElevations.get(b) ?? 0) - (sh!.storeyElevations.get(a) ?? 0));
        for (const storeyId of storeys) {
          const members = (sh!.byStorey.get(storeyId) ?? []).map((id) => byId.get(id)).filter((m): m is Member => !!m);
          const elevation = sh!.storeyElevations.get(storeyId);
          out.push({
            key: `${modelId}:${storeyId}`,
            label: store.entities.getName(storeyId) || `IfcBuildingStorey #${storeyId}`,
            secondary: [elevation !== undefined ? `${elevation.toFixed(2)} m` : null, ctx.isMultiModel ? name : null].filter(Boolean).join(' · ') || undefined,
            members,
          });
        }
        for (const m of all) if (!sh?.elementToStorey?.has(m.expressId)) loose.push(m);
      }
      if (loose.length > 0) out.push({ key: 'los', label: '(niet aan een bouwlaag gekoppeld)', members: loose });
      return out;
    },
  },
  {
    id: '3.4',
    title: 'Correct gebruik entiteiten',
    build(ctx) {
      const byClass = new Map<string, { member: Member; values: string[] }[]>();
      for (const { modelId, store } of stores(ctx)) {
        for (const member of products(ctx, modelId, store)) {
          let predefined: string | undefined;
          try {
            predefined = resolveEntityPredefinedType(store, member.expressId);
          } catch {
            predefined = undefined;
          }
          byClass.set(member.ifcType, [...(byClass.get(member.ifcType) ?? []), { member, values: predefined ? [predefined] : [] }]);
        }
      }
      return [...byClass.keys()].sort(collator.compare).map((ifcClass) => {
        const entries = byClass.get(ifcClass)!;
        return { key: ifcClass, label: ifcClass, members: entries.map((e) => e.member), children: bucketsByValue(entries, `${ifcClass}:`) };
      });
    },
  },
  {
    id: '3.5',
    title: 'Structuur en naamgeving',
    build: (ctx) => buildIfcTypeTree(ctx.models, ctx.ifcDataStore, EXPAND_ALL, ctx.isMultiModel, ctx.geometricIds, ctx.geometryReadyModelIds, ctx.overlay),
  },
  {
    id: '3.6',
    title: 'Classificatiesystematiek',
    build(ctx) {
      const names = new Map<string, string>();
      const entries = stores(ctx).flatMap(({ modelId, store }) =>
        products(ctx, modelId, store).map((member) => {
          let refs: ReturnType<typeof extractClassificationsOnDemand> = [];
          try {
            refs = extractClassificationsOnDemand(store, member.expressId);
          } catch {
            refs = [];
          }
          const codes = [...new Set(refs.map((r) => r.identification?.trim()).filter((c): c is string => !!c))];
          for (const r of refs) if (r.identification && r.name && !names.has(r.identification.trim())) names.set(r.identification.trim(), r.name);
          return { member, values: codes };
        }),
      );
      return bucketsByValue(entries, 'code:', (code) => names.get(code));
    },
  },
  {
    id: '3.7',
    title: 'Gebruik propertysets',
    build(ctx) {
      const entries = stores(ctx).flatMap(({ modelId, store }) =>
        products(ctx, modelId, store).map((member) => ({ member, values: [...new Set(psetsOf(store, member.expressId).map((p) => p.name))] })),
      );
      return bucketsByValue(entries, 'pset:');
    },
  },
  {
    id: '3.8',
    title: 'Doublures en doorsnijdingen',
    build(ctx) {
      const out: Bucket[] = [];
      for (const { modelId, store } of stores(ctx)) {
        const byGuid = new Map<string, Member[]>();
        for (const member of products(ctx, modelId, store)) {
          const guid = store.entities.getGlobalId(member.expressId);
          if (guid) byGuid.set(guid, [...(byGuid.get(guid) ?? []), member]);
        }
        for (const [guid, members] of byGuid) if (members.length > 1) out.push({ key: `${modelId}:${guid}`, label: guid, secondary: 'dezelfde GlobalId', members });
      }
      return out;
    },
  },
  {
    id: '4.1',
    title: 'Ruimten',
    build(ctx) {
      const spaces: Member[] = [];
      for (const { modelId, store } of stores(ctx)) {
        for (const expressId of store.entityIndex.byType.get('IFCSPACE') ?? []) {
          spaces.push({
            modelId,
            expressId,
            globalId: resolveTreeGlobalId(modelId, expressId, ctx.models),
            name: store.entities.getName(expressId) || `IfcSpace #${expressId}`,
            ifcType: 'IfcSpace',
          });
        }
      }
      const zones = buildGroupTree(ctx.models, ctx.ifcDataStore, EXPAND_ALL, ctx.isMultiModel, ctx.geometricIds, 'zones', ctx.overlay);
      // Elke ruimte een regel (op naam), daarna de zones
      const spaceRows = [...spaces]
        .sort((a, b) => collator.compare(a.name, b.name))
        .map((space): Bucket => ({ key: `${space.modelId}:${space.expressId}`, label: space.name, members: [space] }));
      return [...asNodes(spaceRows, 0), ...zones];
    },
  },
  {
    id: '4.2',
    title: 'Installatietechnische systemen',
    build: (ctx) => buildGroupTree(ctx.models, ctx.ifcDataStore, EXPAND_ALL, ctx.isMultiModel, ctx.geometricIds, 'systems', ctx.overlay),
  },
  propertyChapter('4.3', 'Dragend / niet dragend', 'LoadBearing'),
  propertyChapter('4.4', 'Inwendig / uitwendig', 'IsExternal'),
  propertyChapter('4.5', 'Brandveiligheid', 'FireRating'),
  propertyChapter('4.6', 'Bouwfysische eigenschappen', 'ThermalTransmittance'),
  {
    id: '4.7',
    title: 'Materiaal',
    build: (ctx) => buildMaterialTree(ctx.models, ctx.ifcDataStore, EXPAND_ALL, ctx.isMultiModel, ctx.geometricIds, ctx.geometryReadyModelIds),
  },
];

// --------------------------------------------------------------------------------------------- regels

/** Groepen als regels vanaf `depth`, met de hele tak (uitklappen doet de projectie) */
export function asNodes(buckets: Bucket[], depth: number, parentId = ''): TreeNode[] {
  const out: TreeNode[] = [];
  for (const b of buckets) {
    const id = `${parentId}|g:${encodeURIComponent(b.key)}`;
    // Alleen groepen onder groepen; de elementen zelf staan niet in de boom
    const hasChildren = (b.children?.length ?? 0) > 0;
    out.push({
      id,
      expressIds: b.members.map((m) => m.expressId),
      globalIds: [...new Set(b.members.map((m) => m.globalId))],
      modelIds: [...new Set(b.members.map((m) => m.modelId))],
      name: b.label,
      secondaryName: b.secondary,
      type: 'ils-group',
      depth,
      hasChildren,
      isExpanded: hasChildren,
      isVisible: true,
      elementCount: new Set(b.members.map((m) => m.globalId)).size,
    });
    if (b.children?.length) out.push(...asNodes(b.children, depth + 1, id));
  }
  return out;
}

/** Regels van een indeling van IfcLite zonder de elementen: een regel houdt kinderen als er nog een groep onder staat */
export function withoutElements(nodes: TreeNode[]): TreeNode[] {
  const kept = nodes.filter((n) => n.type !== 'element' && n.type !== 'group-member');
  return kept.map((n, i) => {
    const hasChildren = (kept[i + 1]?.depth ?? -1) > n.depth;
    return hasChildren === n.hasChildren ? n : { ...n, hasChildren, isExpanded: hasChildren };
  });
}

/** Regels van een hoofdstuk één niveau dieper en met het hoofdstuk voor de id, zodat ze uniek blijven */
function nestUnder(chapterId: string, content: Bucket[] | TreeNode[]): TreeNode[] {
  const nodes = content.length > 0 && 'depth' in content[0] ? withoutElements(content as TreeNode[]) : asNodes(content as Bucket[], 0);
  return nodes.map((n) => ({ ...n, id: `${chapterId}|${n.id}`, depth: n.depth + 1 }));
}

// Berekende hoofdstukken, per modellen en geometrie (die veranderen bij laden en streamen)
let cacheKey: { models: unknown; geometricIds: unknown; store: unknown } | null = null;
let chapterCache = new Map<string, TreeNode[]>();

export function buildIlsTree(ctx: IlsContext, expansion: ExpansionLookup): TreeNode[] {
  if (!cacheKey || cacheKey.models !== ctx.models || cacheKey.geometricIds !== ctx.geometricIds || cacheKey.store !== ctx.ifcDataStore) {
    cacheKey = { models: ctx.models, geometricIds: ctx.geometricIds, store: ctx.ifcDataStore };
    chapterCache = new Map();
  }
  if (stores(ctx).length === 0) return [];
  const nodes: TreeNode[] = [];
  for (const chapter of ILS_CHAPTERS) {
    const id = `ils|${chapter.id}`;
    const expanded = expansion.has(id);
    let children: TreeNode[] | undefined = chapterCache.get(chapter.id);
    if (expanded && !children) {
      children = nestUnder(id, chapter.build(ctx));
      chapterCache.set(chapter.id, children);
    }
    // Alle elementen van het hoofdstuk, voor isoleren en verbergen; pas bekend na uitklappen
    const members = children ? [...new Set(children.filter((n) => n.depth === 1).flatMap((n) => n.globalIds))] : [];
    nodes.push({
      id,
      expressIds: [],
      globalIds: members,
      modelIds: [],
      name: `${chapter.id} ${chapter.title}`,
      type: 'ils-group',
      depth: 0,
      // Voor het uitklappen is niet bekend of er iets onder staat; daarna wel
      hasChildren: children ? children.length > 0 : true,
      isExpanded: expanded && !!children && children.length > 0,
      isVisible: true,
      elementCount: children ? members.length : undefined,
    });
    if (expanded && children) nodes.push(...children);
  }
  return nodes;
}
