/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: link naar de broncode van precies deze viewer (MPL 2.0 artikel 3.2; audit BIMpeil 2026-11 VIEW-003,
 * besluiten punt 126). viewer:build in BIMpeil geeft het adres mee (VITE_BIMPEIL_SOURCE_URL): de openbare repo
 * bimpeil-viewer-bron op de tag van de vastgezette commit. Zonder adres (in de dev server) geen link.
 */
const SOURCE_URL: string | undefined = import.meta.env.VITE_BIMPEIL_SOURCE_URL;

export function BimpeilSourceLink() {
  if (!SOURCE_URL) return null;
  return (
    <p>
      <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">
        Broncode van deze viewer (MPL 2.0)
      </a>
    </p>
  );
}
