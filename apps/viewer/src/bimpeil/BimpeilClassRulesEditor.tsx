/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: classificatieregels bewerken in de viewer (K3). Klassen toevoegen, hernoemen, een code en kleur geven,
 * verplaatsen (de volgorde bepaalt welke klas wint), in- en uitspringen en verwijderen; per klas de regels met de
 * regeleditor van IfcLite (FilterGroupEditor, dezelfde als in Zoeken en Lens), beperkt tot de soorten die BIMpeil
 * toestaat. Het paneel, de kleuren en de boom rekenen tijdens het bewerken met het concept. Opslaan maakt een nieuwe
 * versie in BIMpeil; heeft iemand anders intussen opgeslagen, dan blijft het concept staan met een melding.
 */

import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, IndentDecrease, IndentIncrease, Plus, Trash2 } from 'lucide-react';
import { emptyFilterGroup } from '@ifc-lite/rules';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { FilterGroupEditor, type FilterGroupEditorState } from '@/components/viewer/FilterGroupEditor';
import { useViewerStore } from '@/store';
import {
  addClass,
  CLASS_COLORS,
  CLASS_RULE_KINDS,
  findClass,
  flattenClasses,
  indentClass,
  moveClass,
  newClassId,
  removeClass,
  updateClass,
  type RuleClass,
} from './classRules';
import { chooseClassRuleSet, saveDraft, setDraftClasses, stopEditing, useClassRules } from './classRulesStore';

const field = 'h-7 w-full rounded-md border bg-background px-2 text-sm';

export function BimpeilClassRulesEditor() {
  const { loaded, draft, dirty, saving, saveError, result } = useClassRules();
  const classes = useMemo(() => draft?.classes ?? [], [draft]);
  const flat = useMemo(() => flattenClasses(classes), [classes]);
  const [selectedId, setSelectedId] = useState<string | null>(flat[0]?.cls.id ?? null);
  const [note, setNote] = useState('');
  const selected = selectedId ? findClass(classes, selectedId) : null;

  const models = useViewerStore((s) => s.models);
  const modelOptions = useMemo(() => [...models.values()].map((m) => ({ id: m.id, name: m.name, sourceFingerprint: m.sourceFingerprint })), [models]);

  // De regeleditor wil een functionele update; de huidige groepen via een ref, zoals LensRuleEditor
  const [activeGroup, setActiveGroup] = useState(0);
  const groupsRef = useRef<FilterGroupEditorState>({ groups: [], activeGroup: 0 });
  groupsRef.current = { groups: selected?.groups ?? [], activeGroup };

  if (!loaded || !draft) return null;

  const change = (next: RuleClass[]) => setDraftClasses(next);
  const select = (id: string | null) => {
    setSelectedId(id);
    setActiveGroup(0);
  };
  const add = (asChild: boolean) => {
    const cls: RuleClass = { id: newClassId(), name: 'Nieuwe classificatie', color: CLASS_COLORS[flat.length % CLASS_COLORS.length], groups: [] };
    change(addClass(classes, cls, asChild && selectedId ? { parentId: selectedId } : { afterId: selectedId ?? undefined }));
    select(cls.id);
  };
  const remove = () => {
    if (!selectedId) return;
    const index = flat.findIndex((f) => f.cls.id === selectedId);
    const next = removeClass(classes, selectedId);
    const rest = flattenClasses(next);
    change(next);
    select(rest[Math.min(index, rest.length - 1)]?.cls.id ?? null);
  };
  const changeGroups = (updater: (prev: FilterGroupEditorState) => FilterGroupEditorState) => {
    if (!selectedId) return;
    const next = updater(groupsRef.current);
    groupsRef.current = next;
    setActiveGroup(next.activeGroup);
    change(updateClass(classes, selectedId, { groups: next.groups }));
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <span className="flex-1 truncate text-xs font-medium text-muted-foreground">
          Bewerken op versie {loaded.version}
          {dirty ? ', niet opgeslagen' : ''}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={() => add(false)}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Classificatie
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!selected} onClick={() => add(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Onderliggende classificatie
        </Button>
      </div>

      <ol className="max-h-56 overflow-y-auto border-b py-1" aria-label="Classificaties">
        {flat.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Nog geen classificaties. Voeg een classificatie toe.</li>}
        {flat.map(({ cls, depth }) => (
          <li key={cls.id}>
            <button
              type="button"
              aria-current={cls.id === selectedId}
              onClick={() => select(cls.id)}
              className={`flex w-full items-center gap-2 py-1 pr-3 text-left text-sm hover:bg-accent ${cls.id === selectedId ? 'bg-accent font-medium' : ''}`}
              style={{ paddingLeft: 12 + depth * 14 }}
            >
              <span className="h-3 w-3 shrink-0 rounded-sm border" style={{ backgroundColor: cls.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {cls.code ? <span className="mr-1 text-muted-foreground">{cls.code}</span> : null}
                {cls.name}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">{result?.all.get(cls.id)?.length ?? ''}</span>
            </button>
          </li>
        ))}
      </ol>

      {selected && (
        <div className="space-y-2 p-3">
          <div className="flex items-center gap-1">
            <span className="flex-1 text-xs font-medium text-muted-foreground">Classificatie</span>
            <IconButton label="Omhoog (wint eerder)" className="h-6 w-6" onClick={() => change(moveClass(classes, selected.id, -1))}>
              <ArrowUp className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Omlaag" className="h-6 w-6" onClick={() => change(moveClass(classes, selected.id, 1))}>
              <ArrowDown className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Uitspringen (een niveau hoger)" className="h-6 w-6" onClick={() => change(indentClass(classes, selected.id, 'out'))}>
              <IndentDecrease className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Inspringen (onder de classificatie erboven)" className="h-6 w-6" onClick={() => change(indentClass(classes, selected.id, 'in'))}>
              <IndentIncrease className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label={`${selected.name} verwijderen, met de classificaties eronder`} className="h-6 w-6" onClick={remove}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 text-xs">
              Naam
              <input className={field} value={selected.name} maxLength={100} onChange={(e) => change(updateClass(classes, selected.id, { name: e.target.value }))} />
            </label>
            <label className="w-20 text-xs">
              Code
              <input className={field} value={selected.code ?? ''} maxLength={30} onChange={(e) => change(updateClass(classes, selected.id, { code: e.target.value }))} />
            </label>
            <label className="text-xs">
              Kleur
              <input
                type="color"
                className="block h-7 w-9 cursor-pointer rounded-md border bg-transparent p-0.5"
                value={selected.color}
                onChange={(e) => change(updateClass(classes, selected.id, { color: e.target.value }))}
              />
            </label>
          </div>
          <label className="block text-xs">
            Onderliggende classificaties
            <select
              className={field}
              value={selected.childMode ?? ''}
              onChange={(e) => change(updateClass(classes, selected.id, { childMode: e.target.value === 'all' ? 'all' : undefined }))}
            >
              <option value="">Eerste die past (een element in één onderliggende classificatie)</option>
              <option value="all">Elk op alles (een element kan in meer onderliggende classificaties)</option>
            </select>
          </label>
          <div className="text-xs font-medium text-muted-foreground">Regels</div>
          {selected.groups.length === 0 ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Geen regels: deze classificatie neemt alles wat de classificaties erboven niet namen{findParentHint(classes, selected.id)}.
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => change(updateClass(classes, selected.id, { groups: [emptyFilterGroup()] }))}>
                Regels toevoegen
              </Button>
            </div>
          ) : (
            <>
              <FilterGroupEditor groups={selected.groups} activeGroup={activeGroup} onChange={changeGroups} models={modelOptions} allowedKinds={CLASS_RULE_KINDS} />
              <button type="button" className="text-xs underline text-muted-foreground" onClick={() => change(updateClass(classes, selected.id, { groups: [] }))}>
                Alle regels weghalen (de classificatie neemt dan alles wat over is)
              </button>
            </>
          )}
        </div>
      )}

      <div className="sticky bottom-0 space-y-2 border-t bg-background p-3">
        {saveError && (
          <div className="space-y-1" role="alert">
            <p className="text-xs text-destructive">
              {saveError.newer
                ? 'Iemand anders heeft intussen een nieuwere versie opgeslagen. Je wijzigingen staan hier nog. Noteer wat je veranderde, open de nieuwste versie en breng het daar opnieuw aan.'
                : saveError.message}
            </p>
            {saveError.newer && (
              <Button type="button" size="sm" variant="outline" onClick={() => void chooseClassRuleSet(loaded.id)}>
                Nieuwste openen en mijn wijzigingen weggooien
              </Button>
            )}
          </div>
        )}
        <label className="block text-xs">
          Toelichting bij deze versie (niet verplicht)
          <input className={field} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={stopEditing}>
            {dirty ? 'Wijzigingen weggooien' : 'Stoppen'}
          </Button>
          <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void saveDraft(note).then((ok) => ok && setNote(''))}>
            {saving ? 'Opslaan…' : 'Opslaan als nieuwe versie'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Bij een onderliggende klas: binnen welke ouder */
function findParentHint(classes: RuleClass[], id: string): string {
  const walk = (list: RuleClass[], parent: RuleClass | null): RuleClass | null | undefined => {
    for (const cls of list) {
      if (cls.id === id) return parent;
      const found = walk(cls.children ?? [], cls);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const parent = walk(classes, null);
  return parent ? ` binnen "${parent.name}"` : '';
}
