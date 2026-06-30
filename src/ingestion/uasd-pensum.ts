import { createHash } from 'node:crypto';
import { z } from 'zod';

const rowSchema = z.array(z.array(z.string()));
const subjectCodePattern = /^[A-Z]{2,4}-?\d{4}$/;

export type UasdPensumMetadata = {
  careerName: string;
  institution: string;
  plan: string;
  programCode: string;
  sourceUrl: string;
};

export type UasdCatalogSubject = {
  id: string;
  code: string;
  name: string;
  credits: number;
  prerequisites: Array<{ type: 'one_of'; subjects: string[] }>;
  source: {
    ht: number;
    hp: number;
    prerequisiteText: string;
    equivalences: string[];
  };
};

function normalizeSubjectCode(value: string) {
  const compact = value.trim().replace(/[()]/g, '').replace(/-/g, '');
  if (!/^[A-Z]{2,4}\d{4}$/.test(compact)) return '';
  return `${compact.slice(0, -4)}-${compact.slice(-4)}`;
}

function parsePrerequisiteText(text: string) {
  return text
    .split(',')
    .map((group) => {
      const seen = new Set<string>();
      for (const match of group.match(/[A-Z]{2,4}-?\d{4}/g) || []) {
        const code = normalizeSubjectCode(match);
        if (code) seen.add(code);
      }

      return { type: 'one_of' as const, subjects: [...seen] };
    })
    .filter((group) => group.subjects.length > 0);
}

function parseEquivalences(text: string) {
  return (text.match(/[A-Z]{2,4}-?\d{4}/g) || []).map(normalizeSubjectCode).filter(Boolean);
}

export function rowsContentHash(rows: string[][]) {
  return `sha256:${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`;
}

export function parseUasdPensumRows(rows: unknown, metadata: UasdPensumMetadata) {
  const parsedRows = rowSchema.parse(rows);
  const periods: Array<{ period_number: number; name: string; subjects: UasdCatalogSubject[] }> = [];
  let currentPeriod: { period_number: number; name: string; subjects: UasdCatalogSubject[] } | null = null;
  let subjectCount = 0;
  let totalCredits = 0;

  for (const row of parsedRows) {
    if (row.length === 1 && row[0]?.trim()) {
      currentPeriod = { period_number: periods.length + 1, name: row[0].trim(), subjects: [] };
      periods.push(currentPeriod);
      continue;
    }

    const [rawCode, rawName, ht, hp, credits, prerequisiteText = '', equivalenceText = ''] = row;
    if (!rawCode || !subjectCodePattern.test(rawCode)) continue;
    if (!currentPeriod) {
      currentPeriod = { period_number: periods.length + 1, name: 'Sin semestre', subjects: [] };
      periods.push(currentPeriod);
    }

    const code = normalizeSubjectCode(rawCode);
    const numericCredits = Number(credits || 0);
    subjectCount += 1;
    totalCredits += numericCredits;
    currentPeriod.subjects.push({
      id: code,
      code,
      name: rawName.trim(),
      credits: numericCredits,
      prerequisites: parsePrerequisiteText(prerequisiteText),
      source: {
        ht: Number(ht || 0),
        hp: Number(hp || 0),
        prerequisiteText,
        equivalences: parseEquivalences(equivalenceText),
      },
    });
  }

  const validationErrors: Array<{ path: string; message: string; severity: 'error' | 'warning' }> = [];
  if (!periods.length) validationErrors.push({ path: 'periods', message: 'At least one period is required', severity: 'error' });
  if (!subjectCount) validationErrors.push({ path: 'subjects', message: 'At least one subject is required', severity: 'error' });

  return {
    catalog: {
      metadata: {
        career_name: metadata.careerName,
        institution: metadata.institution,
        plan: metadata.plan,
        program_code: metadata.programCode,
        source_url: metadata.sourceUrl,
        source_type: 'uasd_pensum',
      },
      periods,
    },
    subjectCount,
    totalCredits,
    validationErrors,
    contentHash: rowsContentHash(parsedRows),
  };
}
