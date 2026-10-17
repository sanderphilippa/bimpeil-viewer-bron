/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · File tab — everything that moves model bytes in or out:
 * open / add / refresh, the exporter fleet, and link-based sharing.
 */

import React from 'react';
import { AddFile, Loading, OpenFile, SaveFederationSetup, Share, CollabsRoom } from '@/icons';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { isCollabEnabled } from '@/lib/collab/config';
import { useTranslation } from '@/i18n';
import type { FileCommands } from '../../toolbar/useFileCommands';
import { surfaceCommand } from '../../surface-commands';
import { RibbonExportGroup } from './RibbonExportGroup';
import { RIBBON_EXPORT_ICONS } from './ribbon-export-icons';
import {
  RibbonGroup,
  RibbonGroupDivider,
  RibbonSmallStack,
} from '../primitives';
import { RibbonCommandLargeButton, RibbonCommandSmallButton } from '../command-button';

/** Renders model input/output commands, with compact setup actions beside the prominent export controls. */
export function FileTab({ fileCommands }: { fileCommands: FileCommands }) {
  const { t } = useTranslation();
  const { handleOpenClick, handleAddModelClick, hasModelsLoaded, openShareDialog } = fileCommands;
  const { loading } = useIfc();
  const saveSetup = surfaceCommand('file:save-federation-setup', 'ribbon');
  const shareCommand = surfaceCommand('file:share', 'ribbon');
  const openSetup = surfaceCommand('file:open-federation-setup', 'ribbon');
  const modelTags = surfaceCommand('file:model-tags', 'ribbon');
  const collabRole = useViewerStore((s) => s.collabRole);
  const canEditInSession = collabRole === null || collabRole === 'editor' || collabRole === 'admin';

  // Collaboration: the Share cluster is gated behind the collab feature flag.
  // The ShareDialog itself (and its `ifc-lite:open-share-dialog` listener)
  // lives in useFileCommands so it stays mounted on every tab and while the
  // ribbon is collapsed — this panel only holds the buttons.
  const collabEnabled = React.useMemo(() => isCollabEnabled(), []);
  const collabPeerCount = useViewerStore((s) => s.collabPeers.length);
  const collabRoomId = useViewerStore((s) => s.collabRoomId);
  const collabPanelVisible = useViewerStore((s) => s.collabPanelVisible);

  return (
    <>
      <RibbonGroup label={t('ribbon.file.modelGroup')}>
        <RibbonCommandLargeButton
          commandId="file:open"
          icon={loading ? Loading : OpenFile}
          disabled={loading}
          className={loading ? '[&_svg]:animate-spin' : undefined}
          commandContext={{ openFiles: () => { void handleOpenClick(); } }}
        />
        {/* BIMpeil: no Sources (Dropbox, Microsoft, Dalux) and no Refresh (local file handles only) */}
        <RibbonSmallStack>
          <RibbonCommandSmallButton
            commandId="file:add-model"
            icon={AddFile}
            disabled={loading || !hasModelsLoaded}
            commandContext={{ addModel: () => { void handleAddModelClick(); } }}
          />
        </RibbonSmallStack>
        {[[saveSetup, openSetup], [modelTags]].map((commands) => (
          <RibbonSmallStack key={commands[0].id} className="gap-1">
            {commands.map((command) => (
              <RibbonCommandSmallButton
                key={command.id}
                commandId={command.id}
                icon={command.id === saveSetup.id ? SaveFederationSetup : undefined}
                tooltip={t(command.labelKey)}
                className="min-h-6"
                disabled={!command.enabled({ canEditInSession })}
              />
            ))}
          </RibbonSmallStack>
        ))}
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonExportGroup icons={RIBBON_EXPORT_ICONS} />

      {collabEnabled && (
        <>
          <RibbonGroupDivider />
          <RibbonGroup label={t('ribbon.file.shareGroup')}>
            <RibbonCommandLargeButton
              commandId={shareCommand.id}
              icon={Share}
              disabled={!hasModelsLoaded}
              commandContext={{ openShareDialog }}
              badge={collabPeerCount > 0 ? (
                <span className="absolute right-1 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-2xs font-medium text-primary-foreground">
                  {collabPeerCount + 1}
                </span>
              ) : undefined}
            />
            {/* Room panel toggle — live presence + management. Shown whenever
                collab is on, not only inside a room: the palette and rail offer
                it unconditionally. Gating it here left ribbon users unable to
                open the panel before joining. It also contradicted this toolbar's own rule
                that its geography stays put rather than appearing mid-session. */}
            <RibbonCommandLargeButton
              commandId="panel:collab"
              icon={CollabsRoom}
              tooltip={collabRoomId ? t('ribbon.file.roomTooltip') : t('ribbon.file.roomNotJoinedTooltip')}
              active={collabPanelVisible}
              commandContext={{ activateRightPanel: () => useViewerStore.getState().toggleWorkspacePanel('collab', 'ribbon') }}
              badge={collabPeerCount > 0 ? (
                <span className="absolute right-1 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-1 text-2xs font-medium text-white">
                  {collabPeerCount + 1}
                </span>
              ) : undefined}
            />
          </RibbonGroup>
        </>
      )}
    </>
  );
}
