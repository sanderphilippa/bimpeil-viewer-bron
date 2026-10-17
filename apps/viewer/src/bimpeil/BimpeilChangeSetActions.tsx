/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: change sets bewaren in BIMpeil (V4), naast Export en Import van IfcLite in het paneel
 * Change sets.
 *
 * - Opslaan: de wijzigingen van een change set per model splitsen; voor elk model uit BIMpeil
 *   (origin.ts) een change set bij dat bestand en die versie. Zonder sessie modelId: de mutaties
 *   verwijzen naar express ID's en kloppen dus alleen op precies die versie.
 * - Openen: change sets bij de open modellen uit BIMpeil. Alleen die van precies de open versie
 *   zijn toe te passen. Toepassen zoals IfcLite zelf meerdere wijzigingen in één stap vastlegt
 *   (lib/authoring/associations.ts): op de view toepassen, dan `recordMutationBatch`, zodat
 *   ongedaan maken, de telling en "Export modified IFC…" werken. De wijzigingen komen in een
 *   nieuwe change set met dezelfde naam, die actief wordt.
 */

import { useState } from 'react';
import { CloudDownload, CloudUpload, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { useViewerStore, type FederatedModel } from '@/store';
import { getOrCreateMutationView } from '@/sdk/adapters/mutation-view';
import { useBimpeilContext } from './context';
import { bimpeilRefOf, type BimpeilModelRef } from './origin';
import { transferChangeSet, withGlobalIds, type StoredMutation } from './changeSetTransfer';

interface StoredChangeSet {
  id: string;
  fileId: string;
  versionId: string;
  versionNumber: number;
  name: string;
  mutationCount: number;
  updatedAt: string;
  updatedByName: string | null;
  canManage: boolean;
}

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string; exists?: boolean }> {
  const r = await fetch(path, { ...init, headers: init?.body ? { 'content-type': 'application/json' } : undefined });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string; exists?: boolean };
  if (!r.ok) return { ok: false, error: data.error ?? 'Er ging iets mis.', exists: data.exists };
  return { ok: true, data };
}

const changeSetsPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/change-sets`;

/** Open modellen uit het actieve BIMpeil project, met hun verwijzing */
function bimpeilModels(projectId: string): { model: FederatedModel; ref: BimpeilModelRef }[] {
  const models = Array.from(useViewerStore.getState().models.values()) as FederatedModel[];
  return models.flatMap((model) => {
    const ref = bimpeilRefOf(model);
    return ref && ref.projectId === projectId ? [{ model, ref }] : [];
  });
}

/**
 * Een opgeslagen change set ophalen en toepassen op een geopend model, ook als dat een nieuwere
 * versie is (changeSetTransfer.ts). Geeft de melding voor de gebruiker, of gooit bij een fout.
 */
async function applyStoredChangeSet(projectId: string, cs: StoredChangeSet, model: FederatedModel, ref: BimpeilModelRef): Promise<string> {
  const r = await api<{ name: string; mutations: StoredMutation[] }>(`${changeSetsPath(projectId)}/${cs.id}`);
  if (!r.ok) throw new Error(r.error);
  const view = getOrCreateMutationView(useViewerStore, model.id);
  if (!view) throw new Error(`${model.name} is nog niet klaar met laden.`);
  const transfer = transferChangeSet(r.data.mutations, model, view, cs.versionId === ref.versionId);
  const state = useViewerStore.getState();
  state.createChangeSet(r.data.name);
  const before = view.getMutations().length;
  view.applyMutations(transfer.mutations);
  const applied = view.getMutations().slice(before);
  state.recordMutationBatch(model.id, applied);

  const parts = [`${applied.length} toegepast`];
  if (transfer.missing > 0) parts.push(`${transfer.missing} element${transfer.missing === 1 ? '' : 'en'} bestaat niet meer`);
  if (transfer.conflicts.length > 0) {
    const shown = transfer.conflicts.slice(0, 5).join(', ');
    parts.push(`${transfer.conflicts.length} conflict${transfer.conflicts.length === 1 ? '' : 'en'}, waarde in het IFC intussen anders (${shown}${transfer.conflicts.length > 5 ? ', …' : ''})`);
  }
  if (transfer.untransferable > 0) parts.push(`${transfer.untransferable} niet over te zetten naar een andere versie (positie, type of verwijderen)`);
  const notApplied = transfer.mutations.length - applied.length;
  if (notApplied > 0) parts.push(`${notApplied} niet toe te passen`);
  const from = cs.versionId === ref.versionId ? '' : ` (van versie ${cs.versionNumber})`;
  return `"${r.data.name}"${from} op ${model.name}: ${parts.join('; ')}.`;
}

/** Per naam de change set van de nieuwste versie die niet nieuwer is dan de geopende */
function applicableSets(sets: readonly StoredChangeSet[], ref: BimpeilModelRef): StoredChangeSet[] {
  const byName = new Map<string, StoredChangeSet>();
  for (const cs of sets) {
    if (cs.fileId !== ref.fileId || cs.versionNumber > ref.versionNumber) continue;
    const key = cs.name.toLowerCase();
    const known = byName.get(key);
    if (!known || cs.versionNumber > known.versionNumber) byName.set(key, cs);
  }
  return [...byName.values()];
}

/** Per model en sessie maar één keer vragen */
const offered = new Set<string>();

/**
 * Na het openen van een model uit BIMpeil: change sets van het eigen taakteam bij dat bestand
 * aanbieden (besluit 3 oktober 2026: aanbieden, niet automatisch). Fouten blijven stil; via
 * "Uit BIMpeil" kan het later alsnog.
 */
export async function offerChangeSets(model: FederatedModel): Promise<void> {
  const ref = bimpeilRefOf(model);
  if (!ref || offered.has(model.id)) return;
  offered.add(model.id);
  const r = await api<{ changeSets: StoredChangeSet[] }>(`${changeSetsPath(ref.projectId)}?files=${encodeURIComponent(ref.fileId)}`);
  if (!r.ok) return;
  const sets = applicableSets(r.data.changeSets, ref);
  if (sets.length === 0) return;
  const list = sets
    .map((cs) => `${cs.name} (versie ${cs.versionNumber}${cs.versionId === ref.versionId ? '' : ', eerdere versie'}, ${cs.mutationCount} wijzigingen)`)
    .join('; ');
  const ok = await confirmDialog({
    title: 'Change sets toepassen?',
    description: `Er ${sets.length === 1 ? 'is een change set' : `zijn ${sets.length} change sets`} van jouw taakteam voor ${model.name}: ${list}. Wijzigingen waarvan de waarde in het IFC intussen anders is, worden overgeslagen.`,
    confirmLabel: 'Toepassen',
  });
  if (!ok) return;
  const current = useViewerStore.getState().models.get(model.id) as FederatedModel | undefined;
  if (!current) return;
  for (const cs of sets) {
    try {
      toast.success(await applyStoredChangeSet(ref.projectId, cs, current, ref));
    } catch (err) {
      toast.error(`${cs.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Per change set in het paneel: "Opslaan in BIMpeil" */
export function BimpeilChangeSetSave({ changeSetId, name }: { changeSetId: string; name: string }) {
  const project = useBimpeilContext((s) => s.project);
  const [busy, setBusy] = useState(false);
  if (!project) return null;

  async function save() {
    if (!project) return;
    const changeSet = useViewerStore.getState().changeSets.get(changeSetId);
    if (!changeSet) return;
    const targets = bimpeilModels(project.id)
      .map(({ model, ref }) => ({ model, ref, mutations: changeSet.mutations.filter((m) => m.modelId === model.id) }))
      .filter((t) => t.mutations.length > 0);
    const local = changeSet.mutations.filter((m) => !targets.some((t) => t.model.id === m.modelId)).length;
    if (targets.length === 0) {
      // Zeggen waarom: geen wijzigingen, of modellen die niet als BIMpeil model herkend worden
      const models = useViewerStore.getState().models;
      const names = [...new Set(changeSet.mutations.map((m) => m.modelId))]
        .map((id) => (models.get(id) as FederatedModel | undefined)?.name)
        .filter((n): n is string => !!n);
      toast.error(
        changeSet.mutations.length === 0
          ? 'Deze change set heeft nog geen wijzigingen.'
          : names.length > 0
            ? `${names.join(', ')} ${names.length === 1 ? 'komt' : 'komen'} niet uit het actieve BIMpeil project (lokaal geopend, of de herkomst is onbekend). Open het model via BIMpeil bestanden en breng de wijziging opnieuw aan.`
            : 'Het model van deze wijzigingen is niet meer open.',
      );
      return;
    }
    setBusy(true);
    const put = (t: (typeof targets)[number], overwrite: boolean) =>
      api(changeSetsPath(project.id), {
        method: 'PUT',
        body: JSON.stringify({ fileId: t.ref.fileId, versionId: t.ref.versionId, name, mutations: withGlobalIds(t.model, t.mutations), overwrite }),
      });
    const saved: string[] = [];
    const failed: string[] = [];
    for (const t of targets) {
      let r = await put(t, false);
      if (!r.ok && r.exists) {
        const ok = await confirmDialog({
          title: 'Change set overschrijven?',
          description: `Bij ${t.model.name} staat al een change set "${name}" in BIMpeil. Overschrijven met deze ${t.mutations.length} wijzigingen?`,
          confirmLabel: 'Overschrijven',
        });
        if (!ok) continue;
        r = await put(t, true);
      }
      if (r.ok) saved.push(t.model.name);
      else failed.push(`${t.model.name}: ${r.error}`);
    }
    setBusy(false);
    if (saved.length > 0) toast.success(`"${name}" opgeslagen in BIMpeil bij ${saved.join(', ')}.`);
    if (failed.length > 0) toast.error(failed.join(' '));
    if (local > 0) toast.info(`${local} wijzigingen aan lokale modellen of modellen uit een ander project zijn niet opgeslagen.`);
  }

  return (
    <IconButton label={`${name} opslaan in BIMpeil`} className="h-6 w-6" disabled={busy} onClick={() => void save()}>
      <CloudUpload className="h-3 w-3" />
    </IconButton>
  );
}

/** Bovenaan het paneel: "Openen uit BIMpeil" */
export function BimpeilChangeSetOpen() {
  const project = useBimpeilContext((s) => s.project);
  const [list, setList] = useState<StoredChangeSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  if (!project) return null;

  const open = bimpeilModels(project.id);

  async function load() {
    if (!project) return;
    setError(null);
    setConfirmDelete(null);
    const fileIds = [...new Set(bimpeilModels(project.id).map((m) => m.ref.fileId))];
    if (fileIds.length === 0) {
      toast.error('Er staat geen model uit dit BIMpeil project open.');
      return;
    }
    setList([]);
    const r = await api<{ changeSets: StoredChangeSet[] }>(`${changeSetsPath(project.id)}?files=${fileIds.map(encodeURIComponent).join(',')}`);
    if (r.ok) setList(r.data.changeSets);
    else setError(r.error);
  }

  async function apply(cs: StoredChangeSet, model: FederatedModel, ref: BimpeilModelRef) {
    if (!project) return;
    setBusy(cs.id);
    try {
      const message = await applyStoredChangeSet(project.id, cs, model, ref);
      setList(null);
      toast.success(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(null);
  }

  async function remove(cs: StoredChangeSet) {
    if (!project) return;
    const r = await api(`${changeSetsPath(project.id)}/${cs.id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    if (!r.ok) setError(r.error);
    else setList((l) => l?.filter((x) => x.id !== cs.id) ?? null);
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={open.length === 0} onClick={() => void load()}
        title={open.length === 0 ? 'Open eerst een model uit BIMpeil' : undefined}>
        <CloudDownload className="h-3 w-3" aria-hidden="true" />
        Uit BIMpeil
      </Button>
      <Dialog open={list !== null} onOpenChange={(o) => { if (!o && busy === null) setList(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change sets uit BIMpeil</DialogTitle>
            <DialogDescription>
              Een change set van een eerdere versie wordt via de GlobalId overgezet; wijzigingen waarvan de waarde in het IFC intussen anders is, worden overgeslagen. Toepassen zet de wijzigingen in een nieuwe change set.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {list?.length === 0 && !error && <p className="text-sm text-muted-foreground">Geen change sets bij de open modellen.</p>}
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {open.map(({ model, ref }) => {
              const sets = (list ?? []).filter((cs) => cs.fileId === ref.fileId);
              if (sets.length === 0) return null;
              return (
                <div key={model.id} className="space-y-1">
                  <div className="truncate text-xs font-medium">{model.name}</div>
                  {sets.map((cs) => {
                    // Dezelfde of een eerdere versie: toe te passen (eerdere via GlobalId)
                    const fits = cs.versionNumber <= ref.versionNumber;
                    return (
                      <div key={cs.id} className={`flex items-center gap-2 rounded border px-2 py-1.5 text-sm ${fits ? '' : 'text-muted-foreground'}`}>
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{cs.name}</div>
                          <div className="text-2xs text-muted-foreground">
                            versie {cs.versionNumber} · {cs.mutationCount} wijzigingen · {new Date(cs.updatedAt).toLocaleDateString('nl-NL')}
                            {cs.updatedByName ? ` · ${cs.updatedByName}` : ''}
                          </div>
                        </div>
                        {confirmDelete === cs.id ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setConfirmDelete(null)}>Nee</Button>
                            <Button size="sm" variant="destructive" onClick={() => void remove(cs)}>Verwijderen</Button>
                          </>
                        ) : (
                          <>
                            {cs.canManage && (
                              <Button size="sm" variant="ghost" aria-label={`${cs.name} verwijderen`} onClick={() => setConfirmDelete(cs.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {fits ? (
                              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void apply(cs, model, ref)}>
                                {busy === cs.id ? 'Bezig…' : 'Toepassen'}
                              </Button>
                            ) : (
                              <span className="text-xs" title="Deze change set hoort bij een nieuwere versie dan de geopende">voor versie {cs.versionNumber}</span>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
