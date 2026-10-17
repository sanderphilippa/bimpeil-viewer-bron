/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: modellen openen vanuit de webapp eromheen, zonder de viewer te herladen.
 *
 * De webapp (zelfde origin, iframe op /viewer/) stuurt:
 * - `{ type: 'bimpeil:open', url, name, ref, mode }` met een kortlopende ondertekende URL op /opslag/ en het
 *   bestand en de versie in BIMpeil (origin.ts); `mode` 'open' vervangt wat open staat, 'add' (standaard) voegt toe;
 * - `{ type: 'bimpeil:context', project }` met het actieve project, voor het paneel BIMpeil bestanden;
 * - `{ type: 'bimpeil:theme', theme }` met licht of donker voor de hele site (T1);
 * - `{ type: 'bimpeil:compare', base, head }` om twee versies te vergelijken (V5d, compare.ts).
 * Toevoegen gaat met dezelfde `addModel` als `?model=`, openen met `loadFile` zoals Openen in IfcLite.
 * De viewer meldt `bimpeil:ready` bij het starten en daarna `bimpeil:opened` of `bimpeil:open-failed`.
 *
 * VEILIGHEID: alleen berichten van dezelfde origin, en alleen URL's op dezelfde origin, net als
 * `?model=` (useModelUrlAutoload).
 */

import { useCallback, useEffect } from 'react';
import { useIfcLoader } from '@/hooks/useIfcLoader.js';
import { useIfcFederation } from '@/hooks/useIfcFederation.js';
import { useWebGpuOpenGuard } from '@/hooks/useWebGpuOpenGuard';
import { getWebGPUStatus, retryWebGPU } from '@/hooks/useWebGPU';
import { showLoadError } from '@/lib/analytics';
import { useViewerStore } from '@/store';
import { useTranslation } from '@/i18n';
import { useBimpeilContext, type BimpeilProject } from './context';
import { markBimpeilFile, modelForFile, parseModelRef, type BimpeilModelRef } from './origin';
import { offerChangeSets } from './BimpeilChangeSetActions';
import { modelForVersion, selectComparison } from './compare';

const isObject = (data: unknown): data is Record<string, unknown> => !!data && typeof data === 'object';

/**
 * Een model van een URL op dezelfde origin laden: `add` zet het naast wat open staat, `open`
 * vervangt alles (zoals Openen met één bestand in IfcLite). Geeft true bij succes; een fout komt in
 * de foutkaart van de viewer (zonder Opnieuw: de ondertekende URL verloopt, opnieuw gaat via BIMpeil).
 */
export function useBimpeilAddModel(
  mode: 'add' | 'open' = 'add',
): (url: string, name: string, ref?: BimpeilModelRef | null, options?: { offerChangeSets?: boolean }) => Promise<boolean> {
  const { loadFile } = useIfcLoader();
  const { addModel } = useIfcFederation(loadFile);
  const { guard: guardWebGpu } = useWebGpuOpenGuard();
  const { t } = useTranslation();

  return useCallback(
    async (url: string, name: string, ref?: BimpeilModelRef | null, options?: { offerChangeSets?: boolean }) => {
      let source: URL;
      try {
        source = new URL(url, window.location.href);
      } catch {
        return false;
      }
      if (source.origin !== window.location.origin) return false;
      // Bij een koude start komt het bericht van BIMpeil vaak binnen terwijl IfcLite nog naar een
      // GPU adapter vraagt; dan wachten op die controle (geen tweede) in plaats van "still being checked"
      if (getWebGPUStatus().checking) await retryWebGPU();
      if (!guardWebGpu()) return false;
      try {
        const res = await fetch(source.href);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const blob = await res.blob();
        const file = new File([blob], name, { type: blob.type || 'application/x-step' });
        if (ref) markBimpeilFile(file, ref);
        if (mode === 'open') await loadFile(file, { kind: 'primary' });
        else await addModel(file);
        // Change sets van het eigen taakteam bij dit bestand aanbieden (V4b); niet bij vergelijken (V5d)
        const model = ref && options?.offerChangeSets !== false ? modelForFile(file) : null;
        if (model) void offerChangeSets(model);
        return true;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const { setError, setLastLoadRetry } = useViewerStore.getState();
        showLoadError(setError, setLastLoadRetry, t('viewportLighting.container.modelUrlAutoload.fetchFailed', { reason }), 'model_url_fetch_failed', null);
        return false;
      }
    },
    [mode, loadFile, addModel, guardWebGpu, t],
  );
}

export function useBimpeilOpen(): void {
  const addFromUrl = useBimpeilAddModel();
  const openFromUrl = useBimpeilAddModel('open');
  const setProject = useBimpeilContext((s) => s.setProject);

  useEffect(() => {
    const reply = (message: Record<string, unknown>) => {
      if (window.parent !== window) window.parent.postMessage(message, window.location.origin);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isObject(event.data)) return;
      const data = event.data;
      // Licht of donker uit BIMpeil (T1), voor de hele site
      if (data.type === 'bimpeil:theme') {
        if (data.theme === 'light' || data.theme === 'dark') useViewerStore.getState().setTheme(data.theme);
        return;
      }
      if (data.type === 'bimpeil:context') {
        const project = isObject(data.project) && typeof data.project.id === 'string' ? (data.project as unknown as BimpeilProject) : null;
        setProject(project);
        return;
      }
      // Twee versies vergelijken (V5d): eerst laden wat nog niet open staat, een voor een
      if (data.type === 'bimpeil:compare') {
        const parse = (x: unknown) => {
          if (!isObject(x) || typeof x.url !== 'string') return null;
          const ref = parseModelRef(x.ref);
          return ref ? { url: x.url, name: typeof x.name === 'string' && x.name ? x.name : 'model.ifc', ref } : null;
        };
        const base = parse(data.base);
        const head = parse(data.head);
        if (!base || !head) return;
        const ensure = async (m: NonNullable<typeof base>) =>
          modelForVersion(m.ref.versionId) ?? ((await addFromUrl(m.url, m.name, m.ref, { offerChangeSets: false })) ? modelForVersion(m.ref.versionId) : null);
        void (async () => {
          const a = await ensure(base);
          const b = a ? await ensure(head) : null;
          if (a && b) selectComparison(a.id, b.id);
          reply(a && b ? { type: 'bimpeil:opened', name: head.name } : { type: 'bimpeil:open-failed', name: head.name });
        })();
        return;
      }
      if (data.type !== 'bimpeil:open' || typeof data.url !== 'string') return;
      const name = typeof data.name === 'string' && data.name ? data.name : 'model.ifc';
      // Openen vervangt wat open staat, Toevoegen zet het ernaast; zonder mode (oudere webapp) toevoegen
      const load = data.mode === 'open' ? openFromUrl : addFromUrl;
      void load(data.url, name, parseModelRef(data.ref)).then((ok) => reply(ok ? { type: 'bimpeil:opened', name } : { type: 'bimpeil:open-failed', name }));
    };

    window.addEventListener('message', onMessage);
    reply({ type: 'bimpeil:ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [addFromUrl, openFromUrl, setProject]);
}
