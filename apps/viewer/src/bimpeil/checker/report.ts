/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: het compacte rapport van een controle (besluiten punt 29). Uit het rapport van IfcLite alleen wat BIMpeil
 * bewaart: per specificatie de tellingen en de falende elementen (tot een grens), met per element de redenen en de
 * codes, zodat BIMpeil later een Nederlandse tekst kan maken. Puur, met tests (report.test.ts).
 */
import type { IDSValidationReport } from '@ifc-lite/ids';

/** Hooguit zoveel falende elementen per specificatie in het rapport; de telling blijft volledig */
export const MAX_FAILURES_PER_SPECIFICATION = 500;

export interface CheckFailure {
  globalId: string | null;
  name: string | null;
  type: string;
  reasons: { facet: string; text: string; code: string | null; expected: string | null; actual: string | null }[];
}

export interface CheckSpecification {
  id: string;
  name: string;
  description: string | null;
  status: 'pass' | 'fail' | 'not_applicable';
  applicable: number;
  passed: number;
  failed: number;
  failures: CheckFailure[];
  /** Meer falende elementen dan in failures */
  truncated: boolean;
}

export interface CheckReport {
  summary: { specifications: number; passedSpecifications: number; failedSpecifications: number; checked: number; passed: number; failed: number };
  specifications: CheckSpecification[];
}

const text = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));

export function compactReport(report: IDSValidationReport): CheckReport {
  const specifications = report.specificationResults.map((s): CheckSpecification => {
    const failing = s.entityResults.filter((e) => !e.passed);
    return {
      id: s.specification.id,
      name: s.specification.name,
      description: text(s.specification.description),
      status: s.status,
      applicable: s.applicableCount,
      passed: s.passedCount,
      failed: s.failedCount,
      truncated: failing.length > MAX_FAILURES_PER_SPECIFICATION,
      failures: failing.slice(0, MAX_FAILURES_PER_SPECIFICATION).map((e) => ({
        globalId: text(e.globalId),
        name: text(e.entityName),
        type: e.entityType,
        reasons: e.requirementResults
          .filter((r) => r.status !== 'pass')
          .map((r) => ({
            facet: r.facetType,
            text: r.failureReason ?? r.checkedDescription,
            code: r.failure?.type ?? null,
            expected: text(r.expectedValue),
            actual: text(r.actualValue),
          })),
      })),
    };
  });
  const s = report.summary;
  return {
    summary: {
      specifications: s.totalSpecifications,
      passedSpecifications: s.passedSpecifications,
      failedSpecifications: s.failedSpecifications,
      checked: s.totalEntitiesChecked,
      passed: s.totalEntitiesPassed,
      failed: s.totalEntitiesFailed,
    },
    specifications,
  };
}
