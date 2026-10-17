/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: federatie opslaan en openen in BIMpeil (V3), in plaats van een `.federation.json`
 * downloaden en de modellen opnieuw van schijf kiezen. Vervangt `FederationSetupControls` in
 * `useFileCommands` en luistert naar dezelfde events van de ribbon en het opdrachtpalet.
 *
 * - Opslaan: de setup van IfcLite (`buildFederationSetupFile`: volgorde, zichtbaarheid, anker, tags)
 *   plus per model het bestand en de versie in BIMpeil (origin.ts). Alleen modellen uit het actieve
 *   project gaan mee; lokale modellen niet.
 * - Openen: lijst van federaties van het project, dan per model kiezen tussen de opgeslagen versie
 *   en de nieuwste zichtbare versie (standaard de nieuwste). Daarna vervangt de federatie wat open
 *   staat, via `applyFederationSetup` van IfcLite. Wat de gebruiker niet mag zien (WIP regel) komt
 *   van de API als niet beschikbaar, zonder naam.
 */

import { useCallback, useEffect, useState } from 'react';
import { Anchor, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useViewerStore, type FederatedModel } from '@/store';
import { useFederationSetup } from '@/hooks/useFederationSetup';
import { findReferenceSpatialModel } from '@/hooks/ingest/federationAlign';
import {
  buildFederationSetupFile,
  parseFederationSetupFile,
  type FederationSetupSlotMatch,
} from '@/lib/federation/federationSetupFile';
import { ModelTagsCommand } from '@/components/viewer/ModelTagsCommand';
import { useBimpeilContext, type BimpeilProject } from './context';
import { bimpeilRefOf, markBimpeilFile, modelForFile } from './origin';
import { offerChangeSets } from './BimpeilChangeSetActions';

const EVENT_SAVE = 'ifc-lite:save-federation-setup';
const EVENT_OPEN = 'ifc-lite:open-federation-setup';

interface FederationSummary {
  id: string;
  name: string;
  modelCount: number;
  updatedAt: string;
  updatedByName: string | null;
  canManage: boolean;
}

interface VersionInfo {
  id: string;
  number: number;
  size: number;
  isoStatus: string;
  suitability: string;
  revision: string | null;
}

type DetailSlot =
  | { index: number; available: false }
  | { index: number; available: true; slot: unknown; fileId: string; fileName: string; saved: VersionInfo | null; latest: VersionInfo };

interface FederationDetail {
  id: string;
  name: string;
  formatVersion: number;
  tags: unknown[];
  slots: DetailSlot[];
  viewerMaxBytes: number;
}

type AvailableSlot = Extract<DetailSlot, { available: true }>;

const STATUS: Record<string, string> = { WIP: 'WIP', Shared: 'Gedeeld', Published: 'Gepubliceerd', Archived: 'Gearchiveerd' };
const versionLabel = (v: VersionInfo) =>
  `versie ${v.number} · ${STATUS[v.isoStatus] ?? v.isoStatus}${v.isoStatus !== 'Archived' ? ` ${v.suitability}` : ''}${v.revision ? ` ${v.revision}` : ''}`;

function formatSize(bytes: number): string {
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} GB`;
}

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; exists?: boolean }> {
  const r = await fetch(path, { ...init, headers: init?.body ? { 'content-type': 'application/json' } : undefined });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string; exists?: boolean };
  if (!r.ok) return { ok: false, status: r.status, error: data.error ?? 'Er ging iets mis.', exists: data.exists };
  return { ok: true, data };
}

const federationsPath = (project: BimpeilProject) => `/api/projects/${encodeURIComponent(project.id)}/federations`;

/** Open modellen uit het actieve project (mee) en de rest (lokaal of ander project, niet mee) */
function splitModels(project: BimpeilProject) {
  const models = Array.from(useViewerStore.getState().models.values()) as FederatedModel[];
  const included = models.filter((m) => bimpeilRefOf(m)?.projectId === project.id);
  const excluded = models.filter((m) => bimpeilRefOf(m)?.projectId !== project.id);
  return { included, excluded };
}

export function BimpeilFederationControls() {
  const project = useBimpeilContext((s) => s.project);
  const { applyFederationSetup } = useFederationSetup();

  // Opslaan
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [existing, setExisting] = useState<FederationSummary[]>([]);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modelSplit, setModelSplit] = useState<{ included: FederatedModel[]; excluded: FederatedModel[] }>({ included: [], excluded: [] });

  // Openen
  const [openList, setOpenList] = useState<FederationSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [detail, setDetail] = useState<FederationDetail | null>(null);
  const [choice, setChoice] = useState<Record<number, 'saved' | 'latest'>>({});
  const [progress, setProgress] = useState<string | null>(null);

  const loadList = useCallback(async (p: BimpeilProject) => {
    const r = await api<{ federations: FederationSummary[]; canSave: boolean }>(federationsPath(p));
    if (!r.ok) {
      setListError(r.error);
      return null;
    }
    setListError(null);
    return r.data;
  }, []);

  const startSave = useCallback(() => {
    if (!project) {
      toast.error('Kies eerst in BIMpeil linksboven een project.');
      return;
    }
    const split = splitModels(project);
    if (split.included.length === 0) {
      toast.error('Geen van de open modellen komt uit dit BIMpeil project. Open ze via BIMpeil bestanden, of upload ze eerst.');
      return;
    }
    setModelSplit(split);
    setSaveError(null);
    setConfirmOverwrite(false);
    setExisting([]);
    setSaveOpen(true);
    void loadList(project).then((d) => {
      if (!d) return;
      setExisting(d.federations);
      if (!d.canSave) setSaveError('Je mag in dit project geen federaties opslaan.');
    });
  }, [project, loadList]);

  const startOpen = useCallback(() => {
    if (!project) {
      toast.error('Kies eerst in BIMpeil linksboven een project.');
      return;
    }
    setConfirmDelete(null);
    setOpenList([]);
    void loadList(project).then((d) => setOpenList(d ? d.federations : []));
  }, [project, loadList]);

  useEffect(() => {
    window.addEventListener(EVENT_SAVE, startSave);
    window.addEventListener(EVENT_OPEN, startOpen);
    return () => {
      window.removeEventListener(EVENT_SAVE, startSave);
      window.removeEventListener(EVENT_OPEN, startOpen);
    };
  }, [startSave, startOpen]);

  async function save(overwrite: boolean) {
    if (!project) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setSaveError('Geef de federatie een naam.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    // Opnieuw bepalen: er kan intussen een model geopend of gesloten zijn
    const { included } = splitModels(project);
    const state = useViewerStore.getState();
    const anchorModelId = findReferenceSpatialModel()?.modelId ?? state.anchorModelIdOverride ?? null;
    const setup = await buildFederationSetupFile(included, anchorModelId, state);
    const r = await api<{ id: string }>(federationsPath(project), {
      method: 'PUT',
      body: JSON.stringify({ name: trimmed, setup, models: included.map((m) => bimpeilRefOf(m)), overwrite }),
    });
    setSaving(false);
    if (!r.ok) {
      if (r.exists && !overwrite) setConfirmOverwrite(true);
      else setSaveError(r.error);
      return;
    }
    setSaveOpen(false);
    toast.success(`Federatie "${trimmed}" opgeslagen in BIMpeil.`);
  }

  async function remove(f: FederationSummary) {
    if (!project) return;
    const r = await api(`${federationsPath(project)}/${f.id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    if (!r.ok) {
      setListError(r.error);
      return;
    }
    setOpenList((list) => list?.filter((x) => x.id !== f.id) ?? null);
  }

  async function choose(f: FederationSummary) {
    if (!project) return;
    const r = await api<FederationDetail>(`${federationsPath(project)}/${f.id}`);
    if (!r.ok) {
      setListError(r.error);
      return;
    }
    setOpenList(null);
    setChoice({});
    setDetail(r.data);
  }

  async function apply() {
    if (!project || !detail) return;
    const available = detail.slots.filter((s): s is AvailableSlot => s.available);
    const chosen = (s: AvailableSlot) => (s.saved && choice[s.index] === 'saved' ? s.saved : s.latest);
    const tooBig = (v: VersionInfo) => detail.viewerMaxBytes > 0 && v.size > detail.viewerMaxBytes;

    // Setup met alleen de beschikbare modellen, gecontroleerd door de strenge parser van IfcLite
    const raw = {
      formatVersion: detail.formatVersion,
      tags: detail.tags,
      slots: available.map((s) => {
        const v = chosen(s);
        return { ...(s.slot as object), name: v.id === s.latest.id ? s.fileName : `${s.fileName} (versie ${v.number})` };
      }),
    };
    const parsed = parseFederationSetupFile(JSON.stringify(raw));
    if (!parsed.ok) {
      toast.error(`Deze federatie kan niet geopend worden: ${parsed.error}`);
      return;
    }
    const setup = parsed.setup;

    // Modellen ophalen, één voor één; pas daarna wat open staat vervangen
    const matches: FederationSetupSlotMatch[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];
    for (const [i, s] of available.entries()) {
      const v = chosen(s);
      const slot = setup.slots[i];
      if (tooBig(v)) {
        skipped.push(s.fileName);
        matches.push({ slot, slotIndex: i, file: null, confidence: 'none' });
        continue;
      }
      setProgress(`Ophalen ${i + 1} van ${available.length}: ${s.fileName}`);
      try {
        const link = await api<{ url: string }>(
          `/api/projects/${encodeURIComponent(project.id)}/files/${s.fileId}/versions/${v.id}/download?doel=viewer`,
        );
        if (!link.ok) throw new Error(link.error);
        const res = await fetch(link.data.url);
        if (!res.ok) throw new Error(`${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], slot.name, { type: blob.type || 'application/x-step' });
        markBimpeilFile(file, { projectId: project.id, fileId: s.fileId, versionId: v.id, versionNumber: v.number });
        matches.push({ slot, slotIndex: i, file, confidence: v.id === s.saved?.id ? 'content' : 'name-size' });
      } catch {
        failed.push(s.fileName);
        matches.push({ slot, slotIndex: i, file: null, confidence: 'none' });
      }
    }
    if (!matches.some((m) => m.file)) {
      setProgress(null);
      toast.error('Geen van de modellen kon opgehaald worden.');
      return;
    }

    setProgress('Openen…');
    const { resetViewerState, clearAllModels } = useViewerStore.getState();
    resetViewerState();
    clearAllModels();
    const result = await applyFederationSetup(setup, matches);
    setProgress(null);
    setDetail(null);

    const unavailable = detail.slots.length - available.length;
    const parts = [`${result.restoredCount} van ${detail.slots.length} modellen geopend`];
    if (unavailable > 0) parts.push(`${unavailable} niet beschikbaar`);
    if (skipped.length > 0) parts.push(`te groot voor de browser: ${skipped.join(', ')}`);
    if (failed.length > 0) parts.push(`ophalen mislukt: ${failed.join(', ')}`);
    if (result.anchorMissing) parts.push('het ankermodel ontbreekt, uitlijning kan afwijken');
    const message = `${detail.name}: ${parts.join('; ')}.`;
    if (result.restoredCount === detail.slots.length && !result.anchorMissing) toast.success(message);
    else toast.error(message);

    // Change sets per geopend model aanbieden (V4b), één vraag tegelijk
    for (const m of matches) {
      const model = m.file ? modelForFile(m.file) : null;
      if (model) await offerChangeSets(model);
    }
  }

  const busy = progress !== null;

  return (
    <>
      <ModelTagsCommand />

      {/* Opslaan */}
      <Dialog open={saveOpen} onOpenChange={(open) => { if (!open && !saving) setSaveOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Federatie opslaan in BIMpeil</DialogTitle>
            <DialogDescription>
              {project ? `In ${project.code} ${project.name}. ` : ''}
              Volgorde, zichtbaarheid, anker en tags worden bewaard, met per model het bestand en de versie.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setConfirmOverwrite(false); }}
              placeholder="Naam, bijvoorbeeld Coördinatie"
              maxLength={100}
              autoFocus
              aria-label="Naam van de federatie"
            />
            {existing.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <span className="text-xs text-muted-foreground">Bestaand:</span>
                {existing.map((f) => (
                  <button key={f.id} type="button" className="text-xs underline" onClick={() => { setName(f.name); setConfirmOverwrite(false); }}>
                    {f.name}
                  </button>
                ))}
              </div>
            )}
            <div className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {modelSplit.included.map((m) => (
                <div key={m.id} className="truncate rounded border px-2 py-1">{m.name}</div>
              ))}
              {modelSplit.excluded.map((m) => (
                <div key={m.id} className="truncate rounded border border-dashed px-2 py-1 text-muted-foreground">
                  {m.name}: gaat niet mee (lokaal of uit een ander project)
                </div>
              ))}
            </div>
            {confirmOverwrite && <p className="text-sm">Er is al een federatie met deze naam. Overschrijven?</p>}
            {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>Annuleren</Button>
            {confirmOverwrite ? (
              <Button onClick={() => void save(true)} disabled={saving}>{saving ? 'Opslaan…' : 'Overschrijven'}</Button>
            ) : (
              <Button onClick={() => void save(false)} disabled={saving}>{saving ? 'Opslaan…' : 'Opslaan'}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Openen: kiezen */}
      <Dialog open={openList !== null} onOpenChange={(open) => { if (!open) setOpenList(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Federatie openen uit BIMpeil</DialogTitle>
            <DialogDescription>{project ? `${project.code} ${project.name}` : ''}</DialogDescription>
          </DialogHeader>
          {listError && <p className="text-sm text-destructive">{listError}</p>}
          {openList?.length === 0 && !listError && <p className="text-sm text-muted-foreground">Nog geen federaties in dit project.</p>}
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {openList?.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{f.name}</div>
                  <div className="text-2xs text-muted-foreground">
                    {f.modelCount} {f.modelCount === 1 ? 'model' : 'modellen'} · {new Date(f.updatedAt).toLocaleDateString('nl-NL')}
                    {f.updatedByName ? ` · ${f.updatedByName}` : ''}
                  </div>
                </div>
                {confirmDelete === f.id ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setConfirmDelete(null)}>Nee</Button>
                    <Button size="sm" variant="destructive" onClick={() => void remove(f)}>Verwijderen</Button>
                  </>
                ) : (
                  <>
                    {f.canManage && (
                      <Button size="sm" variant="ghost" aria-label={`${f.name} verwijderen`} onClick={() => setConfirmDelete(f.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => void choose(f)}>Openen</Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Openen: versies kiezen */}
      <Dialog open={detail !== null} onOpenChange={(open) => { if (!open && !busy) setDetail(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
            <DialogDescription>
              Kies per model de versie. Standaard de nieuwste die je mag zien. Openen vervangt wat nu open staat.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {detail?.slots.map((s) => {
              if (!s.available) {
                return (
                  <div key={s.index} className="rounded border border-dashed px-2 py-1.5 text-sm text-muted-foreground">
                    Niet beschikbaar: geen rechten, of het bestand is verwijderd
                  </div>
                );
              }
              const isAnchor = !!(s.slot as { anchor?: unknown })?.anchor;
              const newer = s.saved && s.saved.id !== s.latest.id;
              const v = s.saved && choice[s.index] === 'saved' ? s.saved : s.latest;
              const big = detail.viewerMaxBytes > 0 && v.size > detail.viewerMaxBytes;
              return (
                <div key={s.index} className="space-y-1 rounded border px-2 py-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    {isAnchor && <Anchor className="h-3.5 w-3.5 shrink-0" aria-label="Anker" />}
                    <span className="flex-1 truncate">{s.fileName}</span>
                  </div>
                  {newer ? (
                    <div className="space-y-0.5 text-xs">
                      <p className="text-muted-foreground">Er is een nieuwere versie dan bij het opslaan.</p>
                      {(['latest', 'saved'] as const).map((k) => {
                        const option = k === 'latest' ? s.latest : s.saved!;
                        return (
                          <label key={k} className="flex items-center gap-1.5">
                            <input
                              type="radio"
                              name={`versie-${s.index}`}
                              checked={(choice[s.index] ?? 'latest') === k}
                              onChange={() => setChoice((c) => ({ ...c, [s.index]: k }))}
                            />
                            {k === 'latest' ? 'Nieuwste' : 'Opgeslagen'}: {versionLabel(option)}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {versionLabel(s.latest)}
                      {!s.saved ? ' (de opgeslagen versie is er niet meer)' : ''}
                    </p>
                  )}
                  {big && <p className="text-xs text-destructive">Groter dan {formatSize(detail.viewerMaxBytes)}, wordt overgeslagen</p>}
                </div>
              );
            })}
          </div>
          {progress && <p className="text-sm text-muted-foreground">{progress}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)} disabled={busy}>Annuleren</Button>
            <Button onClick={() => void apply()} disabled={busy || !detail?.slots.some((s) => s.available)}>
              {busy ? 'Bezig…' : 'Openen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
