/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: een model ophalen met een bovengrens (boundedFetch.ts, audit 2026-11 SEC-026) */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HARD_LIMIT, parseSize, readBounded, readLimit, TooLarge } from './boundedFetch';

const streamOf = (chunks: number[]) => {
  let i = 0;
  return { read: async () => (i < chunks.length ? { done: false, value: new Uint8Array(chunks[i++]) } : { done: true }) };
};

test('de grens: de opgegeven grootte plus de marge, zonder grootte de vaste grens', () => {
  assert.equal(readLimit(1000), 1000 + 10 + 65_536);
  assert.equal(readLimit(undefined), HARD_LIMIT);
  assert.equal(readLimit(0), HARD_LIMIT);
});

test('een stream die veel meer levert dan opgegeven: TooLarge, binnen de grens: alles', async () => {
  await assert.rejects(readBounded(streamOf([40_000, 40_000]), readLimit(1000)), TooLarge);
  assert.equal((await readBounded(streamOf([600, 400]), readLimit(1000))).length, 1000);
});

test('een grootte uit een bericht: alleen een positief geheel getal', () => {
  assert.equal(parseSize(5), 5);
  for (const bad of [0, -1, 1.5, '5', null, undefined, Number.POSITIVE_INFINITY]) assert.equal(parseSize(bad), undefined);
});
