/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: panelen van IfcLite die BIMpeil niet aanbiedt (besluit Sander, 17 oktober 2026; besluiten punt 126).
 *
 * - `sources` (Bronnen: modellen uit Dropbox, OneDrive en SharePoint, en andere CDE's): in BIMpeil komt alles uit
 *   BIMpeil zelf, via de CDE met zijn rechten en audit trail. De pagina's om in te loggen bij Dropbox en Microsoft
 *   (`public/oauth/dropbox`, `public/oauth/msgraph`) haalt viewer:build in BIMpeil uit de build.
 *
 * Terugdraaien: het paneel uit HIDDEN_PANELS halen, en in BIMpeil in apps/viewer/scripts/build.mjs de regel die
 * oauth/dropbox en oauth/msgraph weghaalt aanpassen; dan ook de privacyverklaring (deel De viewer) en
 * docs/architectuur.md par. 1.2 bijwerken. De poorten staan in useRailPanelIds.ts, ribbon/PanelGroupBrowser.tsx en
 * surface-commands-panels.ts (gemarkeerd met BIMpeil:).
 */
const HIDDEN_PANELS: ReadonlySet<string> = new Set(['sources']);

export function hiddenByBimpeil(panelId: string): boolean {
  return HIDDEN_PANELS.has(panelId);
}
