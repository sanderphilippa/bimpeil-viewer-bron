/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: een IDS komt in de viewer alleen uit BIMpeil (besluit Sander, 11 oktober 2026). De knoppen van IfcLite om een
 * IDS van de eigen computer te laden staan uit met deze vlag (IDS validation, het demovoorbeeld, Import IDS as rules en
 * in Flow de import in een check job). Flow bewaart een IDS in de job; de naam begint dan met BIMPEIL_IDS_PREFIX, zodat
 * de controle bij het draaien (assertIdsFromBimpeil in check-resources.ts) een IDS van elders weigert, ook bij "kies
 * bij elke run". Geen beveiliging tegen een met de hand aangepast flowbestand; wel tegen laden via de knoppen.
 */
export const BIMPEIL_IDS_ONLY = true;

export const BIMPEIL_IDS_PREFIX = 'BIMpeil: ';

/** Gooit als een IDS niet uit BIMpeil komt (de naam van de bron in een check job) */
export function assertIdsFromBimpeil(name: string): void {
  if (BIMPEIL_IDS_ONLY && !name.startsWith(BIMPEIL_IDS_PREFIX)) {
    throw new Error(`${name}: een IDS komt alleen uit BIMpeil. Kies hem in de job met IDS uit BIMpeil.`);
  }
}
