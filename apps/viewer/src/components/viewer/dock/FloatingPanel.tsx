/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A floating / edge-snapped workspace-panel window (issue #1201).
 *
 * Chrome around an arbitrary panel: a drag-by-header title bar, float controls
 * and a resize affordance. The float controls are two distinct ideas, and the
 * labels keep them apart (#1264):
 *   - SNAP left / right / bottom / free: positions the *floating overlay*; it
 *     still sits ON TOP of the model (the 3D view stays full size behind it).
 *   - DOCK: re-docks the panel into the sidebar, which RESERVES space so the
 *     panel and the model sit side by side (and can be split, #1266).
 *
 * Geometry lives in the dock slice so it persists and survives re-render; this
 * component only translates pointer gestures into `setFloatingPanelRect` /
 * `snapFloatingPanel` calls.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import {
  PanelLeft,
  PanelRight,
  PanelBottom,
  Square,
  X,
  GripVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n';
import type { FloatingPanelState, SnapZone } from '@/store';
import { computeFloatingPanelStyle, type FloatingArea, type SnapBounds } from './floating-panel-geometry';

export type { SnapBounds };

const MIN_W = 260;
const MIN_H = 180;
// Keep the opposite edge / header reachable when resizing against the viewport.
const RESIZE_EDGE_MARGIN = 40;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** BIMpeil: resize edges of a free-floating panel. The top is the drag handle. */
type FreeResizeEdge = 'left' | 'right' | 'bottom' | 'bottom-left' | 'bottom-right';

// Edges below the header (top-8) so they don't steal the drag; corners last so they win
const FREE_RESIZE_HANDLES: ReadonlyArray<readonly [FreeResizeEdge, string]> = [
  ['left', 'left-0 top-8 bottom-0 w-1.5 cursor-ew-resize'],
  ['right', 'right-0 top-8 bottom-0 w-1.5 cursor-ew-resize'],
  ['bottom', 'bottom-0 inset-x-0 h-1.5 cursor-ns-resize'],
  ['bottom-left', 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize'],
  ['bottom-right', 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize'],
];

interface FloatingPanelProps {
  panel: FloatingPanelState;
  title: string;
  zIndex: number;
  /** The viewport region edge snaps confine to; null until measured. */
  bounds: SnapBounds | null;
  /** The window size free-floating panels are clamped into; null until measured. */
  area: FloatingArea | null;
  children: ReactNode;
  onRect: (rect: Partial<Pick<FloatingPanelState, 'x' | 'y' | 'w' | 'h'>>) => void;
  onSnap: (snap: SnapZone) => void;
  onFocus: () => void;
  /** Re-dock into the right slot (stop floating, show docked). */
  onDock: () => void;
  onClose: () => void;
}

export function FloatingPanel({
  panel,
  title,
  zIndex,
  bounds,
  area,
  children,
  onRect,
  onSnap,
  onFocus,
  onClose,
}: FloatingPanelProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  // Tear down any in-flight drag / resize listeners if the panel unmounts mid-
  // gesture (closed / docked while dragging) so stale window listeners don't
  // keep firing onRect for a panel that no longer exists (#1208).
  const gestureCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => gestureCleanupRef.current?.(), []);

  // Drag by the header: snapped windows convert to free-float at their current
  // on-screen rect first, so they don't jump.
  const onDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a, [data-no-drag]')) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    onFocus();

    const rect = el.getBoundingClientRect();
    const parent = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    const startX = rect.left - (parent?.left ?? 0);
    const startY = rect.top - (parent?.top ?? 0);
    const w = rect.width;
    const h = rect.height;
    const maxX = Math.max(0, (el.offsetParent as HTMLElement | null ? (el.offsetParent as HTMLElement).clientWidth : window.innerWidth) - w);
    // Never above the toolbar bottom: a header dropped under the z-50 toolbar
    // could not be grabbed again (#5957).
    const minY = area?.top ?? 0;
    const maxY = Math.max(minY, (el.offsetParent as HTMLElement | null ? (el.offsetParent as HTMLElement).clientHeight : window.innerHeight) - h);
    const px = e.clientX;
    const py = e.clientY;
    if (panel.snap !== 'free') onSnap('free');
    onRect({ x: startX, y: startY, w, h });

    const move = (ev: MouseEvent) => {
      const x = Math.max(0, Math.min(maxX, startX + ev.clientX - px));
      const y = Math.max(minY, Math.min(maxY, startY + ev.clientY - py));
      onRect({ x, y });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      gestureCleanupRef.current = null;
    };
    gestureCleanupRef.current = up;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Resize: free → left, right and bottom edges plus the two bottom corners
  // (BIMpeil); left/right snap → inner edge (width); bottom snap → top edge (height).
  const onResizeStart = (e: React.MouseEvent, edge: FreeResizeEdge = 'bottom-right') => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    const rect = el.getBoundingClientRect();
    const startW = rect.width;
    const startH = rect.height;
    // Left edge of the panel within its container; growing to the left stops at 0
    const startX = rect.left - ((el.offsetParent as HTMLElement | null)?.getBoundingClientRect().left ?? 0);
    const px = e.clientX;
    const py = e.clientY;
    const snap = panel.snap;
    // Clamp growth so a snapped panel can't be dragged past its dock region
    // (header / inner edge becoming unreachable). Free panels clamp to the
    // window; edge-snapped panels clamp to the viewport region (#1208 / #1245).
    const maxW = snap === 'free'
      ? Math.max(MIN_W, window.innerWidth - RESIZE_EDGE_MARGIN)
      : Math.max(MIN_W, bounds?.width ?? window.innerWidth);
    const maxH = snap === 'free'
      ? Math.max(MIN_H, window.innerHeight - RESIZE_EDGE_MARGIN)
      : Math.max(MIN_H, bounds?.height ?? window.innerHeight);

    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - px;
      const dy = ev.clientY - py;
      if (snap === 'bottom') {
        onRect({ h: clamp(startH - dy, MIN_H, maxH) });
      } else if (snap === 'right') {
        onRect({ w: clamp(startW - dx, MIN_W, maxW) });
      } else if (snap === 'left') {
        onRect({ w: clamp(startW + dx, MIN_W, maxW) });
      } else {
        const next: Partial<Pick<FloatingPanelState, 'x' | 'w' | 'h'>> = {};
        if (edge === 'right' || edge === 'bottom-right') next.w = clamp(startW + dx, MIN_W, maxW);
        if (edge === 'left' || edge === 'bottom-left') {
          next.w = clamp(startW - dx, MIN_W, Math.min(maxW, startX + startW));
          next.x = startX + startW - next.w;
        }
        if (edge !== 'left' && edge !== 'right') next.h = clamp(startH + dy, MIN_H, maxH);
        onRect(next);
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      gestureCleanupRef.current = null;
    };
    gestureCleanupRef.current = up;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const snapBtn = (zone: SnapZone, Icon: typeof PanelLeft, label: string) => (
    <button
      type="button"
      data-no-drag
      title={label}
      onClick={() => onSnap(zone)}
      className={cn(
        'h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted transition-colors',
        panel.snap === zone && 'bg-muted text-primary',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div
      ref={ref}
      style={{ ...computeFloatingPanelStyle(panel, bounds, area), zIndex }}
      onMouseDown={onFocus}
      className="absolute pointer-events-auto flex flex-col rounded-lg border border-border bg-background shadow-2xl overflow-hidden"
    >
      {/* Title bar — drag handle + dock controls */}
      <div
        onMouseDown={onDragStart}
        className="flex items-center gap-1 px-2 h-8 shrink-0 border-b border-border bg-muted/40 cursor-move select-none"
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate min-w-0 flex-1">{title}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Float positioning (overlay); the model stays full size behind it. */}
          {snapBtn('left', PanelLeft, t('shellChrome.floatingPanel.snapLeft'))}
          {snapBtn('bottom', PanelBottom, t('shellChrome.floatingPanel.snapBottom'))}
          {snapBtn('right', PanelRight, t('shellChrome.floatingPanel.snapRight'))}
          {snapBtn('free', Square, t('shellChrome.floatingPanel.freeFloat'))}
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          {/* BIMpeil: no dock button; panels always float (bimpeil/alwaysFloat.ts) */}
          <button
            type="button"
            data-no-drag
            title={t('viewerShell.dialog.close')}
            onClick={onClose}
            className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>

      {/* Resize affordance */}
      {panel.snap === 'free' ? (
        // BIMpeil: free panels resize from the left, right and bottom edges and both bottom corners
        FREE_RESIZE_HANDLES.map(([edge, className]) => (
          <div
            key={edge}
            onMouseDown={(e) => onResizeStart(e, edge)}
            className={cn('absolute z-10', className)}
          />
        ))
      ) : (
        <div
          onMouseDown={onResizeStart}
          className={cn(
            'absolute z-10',
            panel.snap === 'bottom'
              ? 'top-0 inset-x-0 h-1.5 cursor-row-resize'
              : panel.snap === 'left'
                ? 'right-0 inset-y-0 w-1.5 cursor-col-resize'
                : 'left-0 inset-y-0 w-1.5 cursor-col-resize',
          )}
        />
      )}
    </div>
  );
}
