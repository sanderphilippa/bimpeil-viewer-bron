/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: Openen en Model toevoegen (ribbon, opdrachtpalet, welkomstkaart, mobiele balk) openen
 * het paneel BIMpeil bestanden in plaats van de bestandskiezer. Een lokaal bestand openen kan nog
 * via dat paneel: het stuurt een event dat de oorspronkelijke kiezer van IfcLite start
 * (`useFileCommands` op desktop, `MobileToolbar` op mobiel; er is altijd precies één gemonteerd).
 * Het event gaat synchroon binnen de klik, zodat de browser de bestandskiezer toestaat.
 */

import { useEffect } from 'react';
import { useViewerStore } from '@/store';

const LOCAL_OPEN_EVENT = 'bimpeil:local-open';
const LOCAL_ADD_EVENT = 'bimpeil:local-add';

/** Het paneel BIMpeil bestanden openen (zwevend op desktop via alwaysFloat.ts) */
export function openBimpeilFiles(): void {
  useViewerStore.getState().openWorkspacePanel('bimpeilFiles', 'programmatic');
}

/** Lokaal bestand openen (vervangt wat open staat) of toevoegen, met de kiezer van IfcLite */
export function requestLocalFiles(mode: 'open' | 'add'): void {
  window.dispatchEvent(new Event(mode === 'open' ? LOCAL_OPEN_EVENT : LOCAL_ADD_EVENT));
}

/** Koppelt de oorspronkelijke kiezers van IfcLite aan de events van het paneel */
export function useBimpeilLocalFiles(open: () => unknown, add: () => unknown): void {
  useEffect(() => {
    const onOpen = () => void open();
    const onAdd = () => void add();
    window.addEventListener(LOCAL_OPEN_EVENT, onOpen);
    window.addEventListener(LOCAL_ADD_EVENT, onAdd);
    return () => {
      window.removeEventListener(LOCAL_OPEN_EVENT, onOpen);
      window.removeEventListener(LOCAL_ADD_EVENT, onAdd);
    };
  }, [open, add]);
}
