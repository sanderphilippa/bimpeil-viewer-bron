/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The welcome card of the no-model start screen — logo, tagline, the
 * two-track action area, recent files and the privacy footnote.
 *
 * Extracted from `ViewportContainer.tsx` (#5119): that file sits on the
 * module-size allowlist at a frozen budget, so the one line every new user
 * asks about first ("does my model get uploaded?") had nowhere to land
 * without growing it. Living here it is also testable on its own.
 */

import { Upload, Clock3 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { MODEL_FILE_EXTENSIONS } from '@/services/supported-model-files';
import type { WebGPUStatus } from '@/hooks/useWebGPU';
import { formatFileSize, getCachedFile, type RecentFileEntry } from '@/lib/recent-files';
import { WebGpuDisabledCaption } from './WebGpuTroubleshooting';
import { TOUR_ANCHORS, tourAnchor } from '@/lib/tours/anchors';

/** Formats named under the Open button, derived from the one extension list
 *  so the copy can never advertise less (or more) than the picker accepts. */
const MODEL_FORMATS_LABEL = MODEL_FILE_EXTENSIONS.join(' ');

export interface ViewportWelcomeCardProps {
  webgpu: Pick<WebGPUStatus, 'supported' | 'checking'>;
  /** Open the file picker (File System Access API or the hidden input). */
  onOpenClick: () => void;
  /** Create an empty IFC and drop the user into the Model workspace's wall tool. */
  onStartBlank: () => void;
  recentFiles: RecentFileEntry[];
  /** The canonical load path (`useIfcLoader.loadFile`) for a cached recent file. */
  loadFile: (file: File) => Promise<void>;
}

/**
 * BIMpeil: the start screen shows the BIMpeil name, opening a model and the
 * recent files. The demo, blank, cloud, LLM and Layers actions, the tour
 * invite and the privacy footnote are removed.
 */
export function ViewportWelcomeCard({ webgpu, onOpenClick, recentFiles, loadFile }: ViewportWelcomeCardProps) {
  const { t } = useTranslation();
  const actionsDisabled = !webgpu.supported || webgpu.checking;

  return (
    <div {...tourAnchor(TOUR_ANCHORS.emptyStateCard)} className="max-w-md w-full bg-white dark:bg-[#16161e] border border-zinc-300 dark:border-[#3b4261] p-8 flex flex-col items-center transition-transform hover:-translate-y-1 duration-200 shadow-lg">

      {/* BIMpeil: logo, lichte en donkere versie (public/bimpeil-logo*.svg) */}
      <h2 className="mb-4">
        <img
          src={`${import.meta.env.BASE_URL}bimpeil-logo.svg`}
          alt="BIMpeil"
          className="h-14 w-auto dark:hidden"
        />
        <img
          src={`${import.meta.env.BASE_URL}bimpeil-logo-dark.svg`}
          alt="BIMpeil"
          className="h-14 w-auto hidden dark:block"
        />
      </h2>
      <p className="text-zinc-500 dark:text-[#565f89] font-mono text-sm text-center mb-8 border-b border-zinc-200 dark:border-[#3b4261] pb-4 w-full">
        Van alles met je IFC.
      </p>

      <button
        type="button"
        onClick={onOpenClick}
        disabled={actionsDisabled}
        className={`group w-full flex items-center justify-center gap-3 px-6 py-3 font-mono text-sm border transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
          actionsDisabled
            ? 'border-zinc-200 dark:border-[#3b4261]/50 text-zinc-300 dark:text-[#565f89]/50 cursor-not-allowed'
            : 'border-zinc-300 dark:border-[#3b4261] text-zinc-600 dark:text-[#a9b1d6] hover:border-primary hover:text-primary cursor-pointer'
        }`}
      >
        <Upload className={`h-4 w-4 transition-transform ${webgpu.supported ? 'group-hover:-translate-y-0.5' : ''}`} />
        <span>
          {webgpu.checking
            ? t('viewportLighting.container.emptyState.openButton.checking')
            : webgpu.supported
              ? t('viewportLighting.container.emptyState.openButton.open')
              : t('viewportLighting.container.emptyState.openButton.required')}
        </span>
      </button>

      {webgpu.supported ? (
        <p className="mt-2.5 text-2xs font-mono text-center text-zinc-400 dark:text-[#565f89]">
          <span>{t('viewportLighting.container.emptyState.dragDropHint')}</span>
          <span className="block mt-0.5 text-2xs opacity-80">{MODEL_FORMATS_LABEL}</span>
        </p>
      ) : !webgpu.checking && (
        // Used to sit under the removed demo button; still explains why nothing opens
        <p className="mt-2.5 text-2xs font-mono text-center text-zinc-400 dark:text-[#565f89]">
          <WebGpuDisabledCaption />
        </p>
      )}

      {recentFiles.length > 0 && (
        <div className="mt-6 w-full border-t border-zinc-200 dark:border-[#3b4261] pt-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-mono uppercase tracking-[0.2em] text-zinc-400 dark:text-[#565f89]">
            <Clock3 className="h-3.5 w-3.5" />
            <span>{t('viewportLighting.container.emptyState.recentFiles.heading')}</span>
          </div>
          <div className="flex flex-col gap-2">
            {recentFiles.map((file) => (
              <button
                key={`${file.name}-${file.timestamp}`}
                type="button"
                onClick={async () => {
                  const cached = await getCachedFile(file);
                  if (cached) {
                    await loadFile(cached);
                    return;
                  }
                  onOpenClick();
                }}
                className="flex items-center justify-between gap-3 border border-zinc-200 bg-zinc-50 px-3 py-2 text-left transition-colors hover:border-primary hover:text-primary dark:border-[#3b4261] dark:bg-[#1f2335] dark:hover:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate font-mono text-xs">{file.name}</span>
                <span className="shrink-0 font-mono text-2xs uppercase tracking-wide text-zinc-400 dark:text-[#565f89]">
                  {formatFileSize(file.size)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
