/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: de controle zonder viewer met een paar uit het corpus van buildingSMART (report.ts, zoals check.worker.ts). */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { IfcParser } from '@ifc-lite/parser';
import { parseIDS, validateIDS, createTranslationService } from '@ifc-lite/ids';
import { createDataAccessor } from '@ifc-lite/ids/bridge';
import { compactReport, MAX_FAILURES_PER_SPECIFICATION } from './report';

const corpus = join(process.cwd(), '..', '..', 'packages', 'ids', 'src', '__corpus__', 'buildingsmart-ids', 'attribute');

async function run(base: string) {
  const ifc = readFileSync(join(corpus, `${base}.ifc`));
  const ids = readFileSync(join(corpus, `${base}.ids`), 'utf8');
  const store = await new IfcParser().parseColumnar(ifc.buffer.slice(ifc.byteOffset, ifc.byteOffset + ifc.byteLength));
  const accessor = createDataAccessor(store);
  const report = await validateIDS(parseIDS(ids), accessor, { modelId: 'm', schemaVersion: store.schemaVersion, entityCount: store.entityCount ?? 0 }, {
    translator: createTranslationService('en'),
    includePassingEntities: false,
  });
  return compactReport(report);
}

test('een geslaagd en een gefaald paar uit het corpus', async () => {
  const files = readdirSync(corpus).filter((f) => f.endsWith('.ids'));
  const pass = files.find((f) => f.startsWith('pass-'))!.replace(/\.ids$/, '');
  const fail = files.find((f) => f.startsWith('fail-'))!.replace(/\.ids$/, '');
  const ok = await run(pass);
  assert.equal(ok.summary.failedSpecifications, 0, pass);
  assert.ok(ok.specifications.every((s) => s.failures.length === 0));
  const bad = await run(fail);
  assert.ok(bad.summary.failedSpecifications > 0, fail);
  const failing = bad.specifications.find((s) => s.status === 'fail')!;
  assert.ok(failing.failures.length > 0 && failing.failures.length <= MAX_FAILURES_PER_SPECIFICATION);
  assert.ok(failing.failures[0].reasons.length > 0);
});
