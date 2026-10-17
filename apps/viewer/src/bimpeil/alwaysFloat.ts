/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: every workspace panel always floats, and nothing is open on start.
 *
 * Panels open through many entry points (store actions, usePanelControls,
 * direct flag writes). Instead of patching each one, this subscription turns
 * any docked state into a floating panel. Actions change the store in several
 * steps, so the state is evaluated once per synchronous batch (microtask),
 * comparing the state before the batch with the final state.
 *
 * Desktop only; the mobile layout keeps its own sheets.
 */

import type { StoreApi } from 'zustand';
import type { ViewerState } from '@/store';
import type { WorkspacePanelId } from '@/lib/panels/registry';
import { getPanelDef } from '@/lib/panels/registry';
import { activeBottomPanel, bottomPanelFlags } from '@/lib/panels/bottom-panels';
import type { FloatingPanelState } from '@/store/slices/dockSlice';
import { SIDEBAR_PANEL_FLAGS } from '@/store/store-sync';

/** Start size for wide panels (Lists, Script, Gantt...) instead of 360x460. */
const WIDE_RECT = { w: 720, h: 420 };

export function registerAlwaysFloat(store: StoreApi<ViewerState>): void {
  // Last geometry per panel, so a panel reopens where it was closed
  const remembered = new Map<WorkspacePanelId, Pick<FloatingPanelState, 'x' | 'y' | 'w' | 'h' | 'snap'>>();

  const initial = store.getState();
  if (!initial.isMobile) {
    // Nothing open on start, also not the floats of the previous session
    initial.resetDockLayout();
    store.setState({ ...bottomPanelFlags(null) });
    initial.setLeftPanelCollapsed(true);
    if (initial.sidebarMode !== 'collapsed') initial.setSidebarMode('collapsed');
  }

  const isFloating = (s: ViewerState, id: WorkspacePanelId) => s.floatingPanels.some((p) => p.id === id);

  function float(id: WorkspacePanelId): void {
    const s = store.getState();
    const isNew = !isFloating(s, id);
    s.floatPanel(id);
    if (!isNew) return;
    const rect = remembered.get(id);
    if (rect) {
      const { snap, ...geometry } = rect;
      s.setFloatingPanelRect(id, geometry);
      if (snap !== 'free') s.snapFloatingPanel(id, snap);
    } else if (getPanelDef(id)?.prefersWide) {
      s.setFloatingPanelRect(id, WIDE_RECT);
    }
  }

  function apply(before: ViewerState): void {
    const s = store.getState();
    if (s.isMobile) return;

    for (const p of before.floatingPanels) {
      if (!isFloating(s, p.id)) remembered.set(p.id, { x: p.x, y: p.y, w: p.w, h: p.h, snap: p.snap });
    }
    const floatable = (id: WorkspacePanelId) => !s.poppedOutIds.includes(id);

    // Hierarchy docked in the left column, or a model was opened (same test as
    // selectHasModelsLoaded in hooks/model-presence.ts, inlined to avoid an import cycle)
    const hasModels = (v: ViewerState) => v.models.size > 0 || (v.geometryResult?.meshes?.length ?? 0) > 0;
    const modelOpened = s.models.size > before.models.size || (hasModels(s) && !hasModels(before));
    if (modelOpened && floatable('hierarchy')) float('hierarchy');
    if (!s.leftPanelCollapsed) {
      float('hierarchy');
      s.setLeftPanelCollapsed(true);
    }

    // A panel docked in the right column
    if (s.sidebarMode === 'expanded') {
      if (floatable(s.sidebarActivePanel)) float(s.sidebarActivePanel);
      s.setSidebarMode('collapsed');
    }

    // Side panels with a visibility flag: opening one clears the flags of the
    // others, but floating panels need theirs (Clash and IDS read them).
    const now = store.getState();
    const flagPatch: Record<string, boolean> = {};
    for (const [flag, id] of SIDEBAR_PANEL_FLAGS) {
      if (isFloating(now, id) && !now[flag]) flagPatch[flag] = true;
      else if (now[flag] && !isFloating(now, id) && floatable(id)) float(id);
    }
    if (Object.keys(flagPatch).length > 0) store.setState(flagPatch as Partial<ViewerState>);

    // A panel docked in the bottom strip; its flag goes off so closing the float closes it
    const bottom = activeBottomPanel(store.getState());
    if (bottom && floatable(bottom)) {
      float(bottom);
      store.setState({ ...bottomPanelFlags(null) });
    }
  }

  let before: ViewerState | null = null;
  store.subscribe((_state, prev) => {
    if (before) return;
    before = prev;
    queueMicrotask(() => {
      const snapshot = before!;
      before = null;
      apply(snapshot);
    });
  });
}
