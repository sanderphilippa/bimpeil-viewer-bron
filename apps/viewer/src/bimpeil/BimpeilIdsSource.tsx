/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: IDS uit BIMpeil in het paneel Validatie (11 oktober 2026, besluiten punt 28, stap M1 van het plan voor
 * modelcontrole). Twee lijsten van het actieve project: de IDS van het project (14 oktober 2026, besluiten punt 56:
 * een eigen onderdeel van het project, geen bestand in Bestanden; alleen de laatste vaste versie, nooit een concept) en
 * de IDS sjablonen die de organisatie van het project in haar bibliotheek heeft. Een klik haalt een ondertekende URL op
 * dezelfde origin, leest de IDS en laadt hem met loadIdsContent van IfcLite; controleren gaat daarna zoals altijd.
 */

import { useCallback, useEffect, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { loadIdsContent } from '@/hooks/ids/loadIdsContent';
import { useViewerStore } from '@/store';
import { useBimpeilContext } from './context';
import { BIMPEIL_IDS_PREFIX } from './idsOnly';

/** Een IDS van het project zoals GET /api/projects/:id/ids hem geeft */
interface ProjectIdsItem {
  id: string;
  name: string;
  fixed: { version: number; header: { ifcVersions?: string[] } | null } | null;
}

interface Template {
  versionId: string;
  system: string;
  version: string;
  deprecated?: boolean;
  idsHeader?: { ifcVersions?: string[] } | null;
}

export interface ProjectIds {
  idsId: string;
  version: number;
  name: string;
  sub: string;
}

// Een IDS alleen uit BIMpeil: de vlag en de controle staan in idsOnly.ts (ook voor Flow)
export { BIMPEIL_IDS_ONLY } from './idsOnly';

/** De IDS van het project met een vaste versie (een concept laadt de viewer nooit), op naam */
export function projectIdsOf(list: ProjectIdsItem[]): ProjectIds[] {
  return list
    .filter((i) => i.fixed)
    .map((i) => ({
      idsId: i.id,
      version: i.fixed!.version,
      name: i.name,
      sub: [`versie ${i.fixed!.version}`, i.fixed!.header?.ifcVersions?.join(', ')].filter(Boolean).join(', '),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

/** Sjablonen die gebruikt mogen worden: niet vervallen, op naam */
export function usableTemplates(list: Template[]): Template[] {
  return list.filter((t) => !t.deprecated).sort((a, b) => a.system.localeCompare(b.system, 'nl') || b.version.localeCompare(a.version, 'nl'));
}

async function json<T>(path: string): Promise<T> {
  const r = await fetch(path);
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(d.error ?? `BIMpeil antwoordt met ${r.status}`);
  return d;
}

/**
 * Zonder `onLoaded` laadt een klik de IDS in het paneel Validatie; met `onLoaded` (een check job in Flow) gaat de tekst
 * met de naam (beginnend met BIMPEIL_IDS_PREFIX) naar de aanroeper.
 */
export function BimpeilIdsSource({ onLoaded, compact = false }: { onLoaded?: (xml: string, name: string) => void; compact?: boolean } = {}) {
  const project = useBimpeilContext((s) => s.project);
  const [files, setFiles] = useState<ProjectIds[] | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!project) return;
    setError(null);
    setFiles(null);
    setTemplates(null);
    json<{ ids: ProjectIdsItem[] }>(`/api/projects/${project.id}/ids`)
      .then((d) => setFiles(projectIdsOf(d.ids)))
      .catch((e: unknown) => {
        setFiles([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    json<{ versions: Template[] }>(`/api/projects/${project.id}/ids-templates`)
      .then((d) => setTemplates(usableTemplates(d.versions)))
      .catch((e: unknown) => {
        setTemplates([]);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [project]);

  useEffect(reload, [reload]);

  async function load(key: string, path: string, name: string) {
    setBusy(key);
    setError(null);
    try {
      const { url } = await json<{ url: string }>(path);
      // Alleen de opslag op dezelfde origin (/opslag), zoals bij modellen
      if (new URL(url, location.href).origin !== location.origin) throw new Error('Onverwacht adres voor de IDS');
      const r = await fetch(url);
      if (!r.ok) throw new Error(`De IDS kon niet gelezen worden (${r.status})`);
      const xml = await r.text();
      if (onLoaded) onLoaded(xml, `${BIMPEIL_IDS_PREFIX}${name}`);
      else loadIdsContent(useViewerStore, xml);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!project) {
    return <p className="px-6 pb-4 text-xs text-muted-foreground">Open de viewer vanuit een project in BIMpeil om de IDS van dat project te kiezen.</p>;
  }

  const row = (key: string, title: string, sub: string, path: string) => (
    <li key={key} className="flex items-center gap-2 py-1">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm" title={title}>{title}</div>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void load(key, path, title)}>
        {busy === key ? 'Bezig…' : onLoaded ? 'Kiezen' : 'Laden'}
      </Button>
    </li>
  );

  return (
    <div className={compact ? 'py-1' : 'border-t px-6 py-3'}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium">IDS uit BIMpeil, {project.code}</span>
        <IconButton label="Opnieuw ophalen" className="h-7 w-7" onClick={reload}>
          <RefreshCw className="h-4 w-4" />
        </IconButton>
      </div>
      {error && <p className="mb-1 text-xs text-destructive" role="alert">{error}</p>}
      <div className="mt-2 text-xs font-medium text-muted-foreground">IDS van het project</div>
      {files === null ? (
        <p className="py-1 text-xs text-muted-foreground">Laden…</p>
      ) : files.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">Dit project heeft nog geen IDS met een vaste versie.</p>
      ) : (
        <ul>{files.map((f) => row(`p:${f.idsId}:${f.version}`, f.name, f.sub, `/api/projects/${project.id}/ids/${f.idsId}/download?versie=${f.version}`))}</ul>
      )}
      <div className="mt-2 text-xs font-medium text-muted-foreground">Sjablonen van de organisatie</div>
      {templates === null ? (
        <p className="py-1 text-xs text-muted-foreground">Laden…</p>
      ) : templates.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">De organisatie van dit project heeft geen IDS sjablonen in haar bibliotheek.</p>
      ) : (
        <ul>
          {templates.map((t) =>
            row(`t:${t.versionId}`, t.system, [`versie ${t.version}`, t.idsHeader?.ifcVersions?.join(', ')].filter(Boolean).join(', '), `/api/projects/${project.id}/ids-templates/${t.versionId}/download`),
          )}
        </ul>
      )}
    </div>
  );
}
