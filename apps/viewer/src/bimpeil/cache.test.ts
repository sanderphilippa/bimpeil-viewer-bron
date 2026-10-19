/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: een model uit BIMpeil komt nooit in de browsercache, een lokaal bestand wel (cache.ts, audit VIEW-001) */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planCacheWrite } from '../hooks/cacheTier.js';
import { withoutBimpeilCache } from './cache';

const opts = { meshOnlyEnabled: true, minSize: 10 * 1024 ** 2, maxSourceSize: 150 * 1024 ** 2, maxMeshOnlySize: 400 * 1024 ** 2 };

test('een model uit BIMpeil: geen cache, ook niet in de banden waar IfcLite wel zou bewaren', () => {
  for (const mb of [20, 200]) {
    const plan = planCacheWrite(mb * 1024 ** 2, opts);
    assert.equal(plan.shouldCache, true, `IfcLite zou ${mb} MB bewaren`);
    const ours = withoutBimpeilCache(plan, true);
    assert.equal(ours.shouldCache, false);
    assert.equal(ours.persistSource, false);
    assert.equal(ours.tier, 'none');
  }
});

test('een lokaal geopend bestand: het plan van IfcLite blijft', () => {
  const plan = planCacheWrite(20 * 1024 ** 2, opts);
  assert.deepEqual(withoutBimpeilCache(plan, false), plan);
});
