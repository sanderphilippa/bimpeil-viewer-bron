/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: paneel "BIMpeil bestanden". Toont de modellen van het actieve BIMpeil project en voegt
 * ze toe naast wat al open staat, of opent ze in plaats daarvan. Openen en Model toevoegen op de
 * ribbon openen dit paneel (localFiles.ts); een lokaal bestand openen kan onderaan. De lijst komt
 * van de BIMpeil API op dezelfde origin, met de sessiecookie: rechten en de WIP regel gelden daar.
 * Openen gaat via `?doel=viewer`, zodat het audit log "bestand geopend" toont.
 * Uploaden (V2): open modellen die niet uit BIMpeil komen, of een bestand van schijf, via de webapp
 * (upload.ts). Na het uploaden geldt een open model als BIMpeil model (federaties, change sets).
 * Alles sluiten (11 oktober 2026): IfcLite heeft geen knop om het laatste model te sluiten; hier wel, met een bevestiging
 * alleen als een model wijzigingen heeft (dirtyModels; IfcLite weet niet of die als change set bewaard zijn).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CloudUpload, FolderOpen, HardDrive, Plus, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toast';
import { useViewerStore, type FederatedModel } from '@/store';
import { useBimpeilContext } from './context';
import { useBimpeilAddModel } from './useBimpeilOpen';
import { requestLocalFiles } from './localFiles';
import { bimpeilRefOf, markBimpeilFile } from './origin';
import { uploadToBimpeil, type ViewerUpload } from './upload';
import { parseSize } from './boundedFetch';

interface FileVersion {
  id: string;
  number: number;
  size: number;
  isoStatus: string;
  suitability: string;
  revision: string | null;
}

interface ProjectFile {
  id: string;
  name: string;
  versions: FileVersion[];
}

const MODEL_EXTENSIONS = ['.ifc', '.ifcx', '.ifczip', '.glb', '.gltf'];
const isModel = (name: string) => MODEL_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
const STATUS: Record<string, string> = { WIP: 'WIP', Shared: 'Gedeeld', Published: 'Gepubliceerd', Archived: 'Gearchiveerd' };

function formatSize(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} MB`;
  return `${(bytes / 1024 ** 3).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} GB`;
}

export function BimpeilFilesPanel({ onClose }: { onClose?: () => void }) {
  const project = useBimpeilContext((s) => s.project);
  const addFromUrl = useBimpeilAddModel('add');
  const openFromUrl = useBimpeilAddModel('open');
  const models = useViewerStore((s) => s.models);
  const loading = useViewerStore((s) => s.loading);
  const hasModels = models.size > 0;
  // Alles sluiten: met wijzigingen eerst bevestigen (de namen van de modellen met wijzigingen)
  const dirtyModels = useViewerStore((s) => s.dirtyModels);
  const [confirmClose, setConfirmClose] = useState<string[] | null>(null);
  const closeAll = useCallback(() => {
    const { resetViewerState, clearAllModels } = useViewerStore.getState();
    resetViewerState();
    clearAllModels();
    setConfirmClose(null);
  }, []);
  const requestCloseAll = useCallback(() => {
    const changed = [...dirtyModels].map((id) => models.get(id)?.name).filter((n): n is string => !!n);
    if (changed.length > 0) setConfirmClose(changed);
    else closeAll();
  }, [dirtyModels, models, closeAll]);
  // Herkomst per open model; `refsChanged` ververst na een upload (de herkomst staat buiten de store)
  const [refsChanged, setRefsChanged] = useState(0);
  const openModels = useMemo(() => [...models.values()] as FederatedModel[], [models]);
  const openFileIds = useMemo(
    () => new Set(openModels.map((m) => bimpeilRefOf(m)?.fileId).filter(Boolean)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openModels, refsChanged],
  );
  const localModels = useMemo(
    () => openModels.filter((m) => m.sourceFile && !bimpeilRefOf(m)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openModels, refsChanged],
  );
  const [canUpload, setCanUpload] = useState(false);
  const [upload, setUpload] = useState<{ name: string; text: string; handle: ViewerUpload } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ProjectFile[] | null>(null);
  const [viewerMax, setViewerMax] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Alle namen in het project (ook geen modellen): dezelfde naam uploaden is een nieuwe versie
  const [allNames, setAllNames] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    if (!project) return;
    setError(null);
    fetch(`/api/projects/${encodeURIComponent(project.id)}/files`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Project niet gevonden.' : 'Bestanden ophalen is mislukt.');
        return r.json() as Promise<{ files: ProjectFile[]; viewerMaxBytes: number; canUpload: boolean }>;
      })
      .then((d) => {
        setAllNames(new Set(d.files.map((f) => f.name.toLowerCase())));
        setFiles(d.files.filter((f) => isModel(f.name)));
        setViewerMax(d.viewerMaxBytes);
        setCanUpload(d.canUpload);
      })
      .catch((err: Error) => setError(err.message));
  }, [project]);

  useEffect(() => {
    setFiles(null);
    load();
  }, [load]);

  async function loadModel(file: ProjectFile, version: FileVersion, mode: 'add' | 'open') {
    if (!project) return;
    setBusy(file.id);
    setError(null);
    const r = await fetch(`/api/projects/${encodeURIComponent(project.id)}/files/${file.id}/versions/${version.id}/download?doel=viewer`);
    const data = (await r.json().catch(() => ({}))) as { url?: string; size?: number; error?: string };
    if (!r.ok || !data.url) {
      setError(data.error ?? 'Openen is mislukt.');
      setBusy(null);
      return;
    }
    await (mode === 'open' ? openFromUrl : addFromUrl)(data.url, file.name, { projectId: project.id, fileId: file.id, versionId: version.id, versionNumber: version.number }, {
      // Begrensd ophalen (audit 2026-11 SEC-026)
      size: parseSize(data.size),
    });
    setBusy(null);
  }

  /** Bestanden een voor een uploaden; `model` krijgt daarna de herkomst in BIMpeil */
  async function uploadFiles(items: { file: File; model?: FederatedModel }[]) {
    if (!project) return;
    for (const { file, model } of items) {
      const handle = uploadToBimpeil(project.id, file, (phase, fraction) =>
        setUpload((u) => u && { ...u, text: phase === 'hash' ? `controleren ${Math.round(fraction * 100)}%` : `${Math.round(fraction * 100)}%` }),
      );
      setUpload({ name: file.name, text: 'starten…', handle });
      try {
        const { ref, newVersion } = await handle.done;
        if (model?.sourceFile) markBimpeilFile(model.sourceFile, ref);
        toast.success(`${file.name} staat in BIMpeil als ${newVersion ? `versie ${ref.versionNumber}` : 'nieuw bestand'} (WIP, S0).`);
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setUpload(null);
    setRefsChanged((n) => n + 1);
    load();
  }

  function pickFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (picked.length > 0) void uploadFiles(picked.map((file) => ({ file })));
  }

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="BIMpeil bestanden">
      <div className="flex items-center gap-2 border-b p-3">
        <FolderOpen className="h-4 w-4" aria-hidden="true" />
        <h2 className="flex-1 truncate text-sm font-medium">{project ? `${project.code} ${project.name}` : 'BIMpeil bestanden'}</h2>
        {project && (
          <IconButton label="Vernieuwen" className="h-6 w-6" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </IconButton>
        )}
        {onClose && (
          <IconButton label="Sluiten" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>

      {!project && <p className="p-3 text-sm text-muted-foreground">Kies in BIMpeil linksboven een project; dan staan de modellen hier.</p>}
      {project && error && <p className="p-3 text-sm text-destructive">{error}</p>}
      {project && !error && files === null && <p className="p-3 text-sm text-muted-foreground">Laden…</p>}
      {project && files?.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nog geen modellen in dit project die je kunt zien.</p>}

      {files && files.length > 0 && (
        <ol className="min-h-0 flex-1 divide-y overflow-y-auto">
          {files.map((f) => {
            const v = f.versions[0];
            const tooBig = viewerMax > 0 && v.size > viewerMax;
            const isOpen = openFileIds.has(f.id);
            return (
              <li key={f.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" title={f.name}>{f.name}</div>
                  <div className="text-2xs text-muted-foreground">
                    versie {v.number} · {STATUS[v.isoStatus] ?? v.isoStatus} {v.isoStatus !== 'Archived' ? v.suitability : ''}
                    {v.revision ? ` ${v.revision}` : ''} · {formatSize(v.size)}
                  </div>
                </div>
                {isOpen ? (
                  <span className="text-xs text-muted-foreground">open</span>
                ) : tooBig ? (
                  <span className="text-xs text-muted-foreground" title={`Groter dan ${formatSize(viewerMax)}, de browsergrens`}>
                    te groot
                  </span>
                ) : busy === f.id ? (
                  <span className="text-xs text-muted-foreground">Bezig…</span>
                ) : (
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" size="sm" variant="outline" disabled={busy !== null || loading} onClick={() => void loadModel(f, v, 'open')}
                      title="Vervangt wat open staat">
                      Openen
                    </Button>
                    {hasModels && (
                      <Button type="button" size="sm" variant="outline" disabled={busy !== null || loading} onClick={() => void loadModel(f, v, 'add')}
                        title="Naast wat open staat">
                        <Plus className="h-3 w-3" aria-hidden="true" />
                        Toevoegen
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!(files && files.length > 0) && <div className="min-h-0 flex-1" />}
      {project && canUpload && (
        <div className="border-t px-3 py-2">
          <div className="mb-1 text-xs font-medium">Uploaden naar BIMpeil</div>
          {localModels.map((m) => {
            const exists = allNames.has(m.sourceFile!.name.toLowerCase());
            return (
              <div key={m.id} className="flex items-center gap-2 py-1">
                <span className="min-w-0 flex-1 truncate text-sm" title={m.name}>{m.name}</span>
                <Button type="button" size="sm" variant="outline" disabled={upload !== null}
                  title={exists ? 'Er is al een bestand met deze naam: dit wordt een nieuwe versie' : 'Origineel bestand, zonder wijzigingen uit de viewer'}
                  onClick={() => void uploadFiles([{ file: m.sourceFile!, model: m }])}>
                  <CloudUpload className="h-3 w-3" aria-hidden="true" />
                  {exists ? 'Nieuwe versie' : 'Uploaden'}
                </Button>
              </div>
            );
          })}
          {upload ? (
            <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{upload.name}: {upload.text}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => upload.handle.cancel()}>Annuleren</Button>
            </div>
          ) : (
            <Button type="button" size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
              <CloudUpload className="h-3 w-3" aria-hidden="true" />
              Bestand van schijf uploaden
            </Button>
          )}
          <input ref={fileInput} type="file" multiple className="hidden" onChange={pickFiles} />
          <p className="mt-1 text-2xs text-muted-foreground">
            Komt in BIMpeil als WIP met S0. Wijzigingen uit de viewer gaan niet mee; die bewaar je als change set.
          </p>
        </div>
      )}
      <div className="border-t px-3 py-2">
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => requestLocalFiles('open')}>
            <HardDrive className="h-3 w-3" aria-hidden="true" />
            Lokaal bestand openen
          </Button>
          {hasModels && (
            <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => requestLocalFiles('add')}>
              <Plus className="h-3 w-3" aria-hidden="true" />
              Lokaal toevoegen
            </Button>
          )}
          {hasModels && (
            <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={requestCloseAll}>
              <X className="h-3 w-3" aria-hidden="true" />
              Alles sluiten
            </Button>
          )}
        </div>
        <p className="mt-1 text-2xs text-muted-foreground">
          Een lokaal geopend bestand staat niet in BIMpeil, tot je het uploadt. Statussen regel je in BIMpeil, bij Bestanden.
        </p>
      </div>
      <Dialog open={confirmClose !== null} onOpenChange={(open) => { if (!open) setConfirmClose(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alles sluiten?</DialogTitle>
            <DialogDescription>
              In {confirmClose?.join(', ')} staan wijzigingen uit de viewer. Heb je die niet als change set in BIMpeil bewaard,
              dan gaan ze verloren.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmClose(null)}>Annuleren</Button>
            <Button type="button" variant="destructive" onClick={closeAll}>Alles sluiten</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
