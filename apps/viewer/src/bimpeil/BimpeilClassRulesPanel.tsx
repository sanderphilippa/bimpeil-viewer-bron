/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: paneel Classificatieregels (K2). Een set van het actieve project kiezen, de klassen met hun aantallen,
 * kleuren per klas (de lens uit classRulesStore.ts), per klas isoleren en verbergen, en de modelboom per klas openen.
 * Bewerken (K3) in BimpeilClassRulesEditor.tsx; een nieuwe set via een dialoog met alleen de naam.
 */

import { useMemo, useState } from 'react';
import { Eye, EyeOff, Focus, ListTree, Pencil, Plus, RefreshCw, Shapes, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Switch } from '@/components/ui/switch';
import { useViewerStore } from '@/store';
import { useBimpeilContext } from './context';
import { flattenClasses } from './classRules';
import { BimpeilClassRulesEditor } from './BimpeilClassRulesEditor';
import {
  CLASS_RULES_LENS_ID,
  activeClasses,
  chooseClassRuleSet,
  createClassRuleSet,
  loadClassRuleSets,
  setColorScope,
  showClassColors,
  startEditing,
  useClassRules,
  type ClassMember,
} from './classRulesStore';
import { UNCLASSIFIED_LABEL } from './classRulesTree';

const GREY = '#9ca3af';

export function BimpeilClassRulesPanel({ onClose }: { onClose?: () => void }) {
  const project = useBimpeilContext((s) => s.project);
  const { sets, canEdit, listError, loaded, loading, computing, result, error, draft, colorScope } = useClassRules();
  const [newName, setNewName] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const colorsOn = useViewerStore((s) => s.activeLensId === CLASS_RULES_LENS_ID);
  const hiddenEntities = useViewerStore((s) => s.hiddenEntities);
  const isolated = useViewerStore((s) => s.isolatedEntities);

  const rows = useMemo(() => {
    const classes = activeClasses({ loaded, draft });
    if (!classes || !result) return [];
    const list = flattenClasses(classes).map(({ cls, depth }) => ({
      key: cls.id,
      name: cls.name,
      code: cls.code,
      color: cls.color,
      all: cls.childMode === 'all',
      depth,
      members: result.all.get(cls.id) ?? [],
    }));
    if (result.unclassified.length) list.push({ key: 'niet', name: UNCLASSIFIED_LABEL, code: undefined, color: GREY, all: false, depth: 0, members: result.unclassified });
    return list;
  }, [loaded, draft, result]);

  // Kleuren op (K4c): klassen met onderliggende klassen, zoals een verdeling onder een klas op elk op alles
  const scopes = useMemo(() => flattenClasses(activeClasses({ loaded, draft }) ?? []).filter(({ cls }) => (cls.children?.length ?? 0) > 0), [loaded, draft]);
  const ids = (members: ClassMember[]) => members.map((m) => m.globalId);
  const allHidden = (members: ClassMember[]) => members.length > 0 && members.every((m) => hiddenEntities.has(m.globalId));
  const isIsolated = (members: ClassMember[]) => !!isolated && isolated.size === members.length && members.every((m) => isolated.has(m.globalId));

  async function create() {
    const name = (newName ?? '').trim();
    if (!name) {
      setNewError('Geef de set een naam.');
      return;
    }
    setCreating(true);
    const problem = await createClassRuleSet(name);
    setCreating(false);
    if (problem) setNewError(problem);
    else setNewName(null);
  }

  function openTree() {
    const viewer = useViewerStore.getState();
    viewer.setHierarchyMode('klassen');
    viewer.setLeftPanelCollapsed(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Classificatieregels">
      <div className="flex items-center gap-2 border-b p-3">
        <Shapes className="h-4 w-4" aria-hidden="true" />
        <h2 className="flex-1 truncate text-sm font-medium">Classificatieregels</h2>
        {project && (
          <IconButton label="Opnieuw ophalen" className="h-6 w-6" onClick={() => void loadClassRuleSets(project.id)}>
            <RefreshCw className="h-3.5 w-3.5" />
          </IconButton>
        )}
        {onClose && (
          <IconButton label="Sluiten" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>

      {!project && <p className="p-3 text-sm text-muted-foreground">Open de viewer vanuit een project in BIMpeil om de classificatieregels van dat project te gebruiken.</p>}

      {project && (
        <div className="space-y-2 border-b p-3">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="bimpeil-classificaties-set">
            Set van {project.code}
          </label>
          <select
            id="bimpeil-classificaties-set"
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={loaded?.id ?? ''}
            disabled={sets === null || loading || !!draft}
            onChange={(e) => void chooseClassRuleSet(e.target.value || null)}
          >
            <option value="">{sets === null ? 'Laden…' : sets.length === 0 ? 'Nog geen classificatieregels in dit project' : 'Kies een set'}</option>
            {sets?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (versie {s.version}, {s.classCount} {s.classCount === 1 ? 'klas' : 'klassen'})
              </option>
            ))}
          </select>
          {canEdit && !draft && (
            <Button type="button" size="sm" variant="outline" onClick={() => { setNewName(''); setNewError(null); }}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Nieuwe set
            </Button>
          )}
          {listError && <p className="text-xs text-destructive" role="alert">{listError}</p>}
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          {loaded && (
            <>
              {loaded.version < loaded.latestVersion && (
                <p className="text-xs text-muted-foreground">
                  Je bekijkt versie {loaded.version}; de nieuwste is {loaded.latestVersion}.{' '}
                  <button type="button" className="underline" onClick={() => void chooseClassRuleSet(loaded.id)}>
                    Nieuwste openen
                  </button>
                </p>
              )}
              <div className="flex items-center gap-2">
                <Switch id="bimpeil-classificaties-kleuren" checked={colorsOn} disabled={!result} onCheckedChange={showClassColors} />
                <label htmlFor="bimpeil-classificaties-kleuren" className="flex-1 text-sm">
                  Kleuren per classificatie
                </label>
                <Button type="button" size="sm" variant="outline" onClick={openTree}>
                  <ListTree className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Boom per classificatie
                </Button>
              </div>
              {scopes.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground" htmlFor="bimpeil-classificaties-kleuren-op">
                  Kleuren op
                  <select
                    id="bimpeil-classificaties-kleuren-op"
                    className="h-7 flex-1 rounded-md border bg-background px-2 text-sm text-foreground"
                    value={colorScope ?? ''}
                    onChange={(e) => setColorScope(e.target.value || null)}
                  >
                    <option value="">Hele set</option>
                    {scopes.map(({ cls, depth }) => (
                      <option key={cls.id} value={cls.id}>
                        {'  '.repeat(depth)}
                        {cls.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {loaded.canEdit && !draft && (
                loaded.version === loaded.latestVersion ? (
                  <Button type="button" size="sm" variant="outline" onClick={startEditing}>
                    <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Bewerken
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">Bewerken kan alleen op de nieuwste versie.</p>
                )
              )}
            </>
          )}
        </div>
      )}

      {draft && <BimpeilClassRulesEditor />}

      {!draft && loaded && computing && !result && <p className="p-3 text-sm text-muted-foreground">Classificaties worden uitgerekend…</p>}
      {!draft && loaded && !computing && !result && !error && <p className="p-3 text-sm text-muted-foreground">Open een model om te zien wat er in elke classificatie valt.</p>}
      {!draft && loaded && result && rows.length === 0 && <p className="p-3 text-sm text-muted-foreground">Deze classificatieregels hebben nog geen classificaties.</p>}

      {!draft && rows.length > 0 && (
        <ol className="min-h-0 flex-1 overflow-y-auto py-1" aria-busy={computing}>
          {rows.map((row) => {
            const hidden = allHidden(row.members);
            const empty = row.members.length === 0;
            return (
              <li key={row.key} className="flex items-center gap-2 py-1 pr-2" style={{ paddingLeft: 12 + row.depth * 14 }}>
                <span className="h-3 w-3 shrink-0 rounded-sm border" style={{ backgroundColor: row.color }} aria-hidden="true" />
                <span className={`min-w-0 flex-1 truncate text-sm ${hidden ? 'line-through text-muted-foreground' : ''}`} title={row.name}>
                  {row.code ? <span className="mr-1 text-muted-foreground">{row.code}</span> : null}
                  {row.name}
                  {row.all && <span className="ml-1 text-xs text-muted-foreground">elk op alles</span>}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{row.members.length}</span>
                <IconButton
                  label={isIsolated(row.members) ? `Isoleren van ${row.name} opheffen` : `${row.name} isoleren`}
                  className="h-6 w-6"
                  disabled={empty}
                  onClick={() => useViewerStore.getState().isolateEntities(ids(row.members))}
                >
                  <Focus className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                  label={hidden ? `${row.name} tonen` : `${row.name} verbergen`}
                  className="h-6 w-6"
                  disabled={empty}
                  onClick={() => (hidden ? useViewerStore.getState().showEntities(ids(row.members)) : useViewerStore.getState().hideEntities(ids(row.members)))}
                >
                  {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </IconButton>
              </li>
            );
          })}
        </ol>
      )}

      <Dialog open={newName !== null} onOpenChange={(open) => { if (!open) setNewName(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nieuwe classificatieregels</DialogTitle>
            <DialogDescription>Een lege set in {project?.code}; daarna voeg je de classificaties toe.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="space-y-2">
            <label className="block text-sm">
              Naam
              <input
                autoFocus
                className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm"
                value={newName ?? ''}
                maxLength={100}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            {newError && <p className="text-xs text-destructive" role="alert">{newError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewName(null)}>Annuleren</Button>
              <Button type="submit" disabled={creating}>{creating ? 'Aanmaken…' : 'Aanmaken'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
