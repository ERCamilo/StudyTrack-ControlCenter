import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseUasdPensumRows, rowsContentHash } from '../src/ingestion/uasd-pensum.js';

function readUasdFixture() {
  const text = readFileSync(new URL('./fixtures/uasd-p-iciv-000012-rows.tsv', import.meta.url), 'utf8');
  const lines = text.trim().split(/\r?\n/);
  return {
    sourceUrl: lines[0]?.replace('# sourceUrl=', ''),
    rows: lines.filter((line) => !line.startsWith('#')).map((line) => line.split('\t')),
  };
}

const fixture = readUasdFixture();

describe('UASD pensum parser', () => {
  it('parses the Civil Engineering pensum captured from UASD into catalog periods', () => {
    const parsed = parseUasdPensumRows(fixture.rows, {
      careerName: 'Ingeniería Civil',
      institution: 'Universidad Autónoma de Santo Domingo',
      plan: '000012',
      programCode: 'P-ICIV',
      sourceUrl: fixture.sourceUrl,
    });

    expect(parsed.catalog.metadata).toMatchObject({
      career_name: 'Ingeniería Civil',
      institution: 'Universidad Autónoma de Santo Domingo',
      plan: '000012',
      source_url: fixture.sourceUrl,
    });
    expect(parsed.catalog.periods).toHaveLength(11);
    expect(parsed.subjectCount).toBe(70);
    expect(parsed.totalCredits).toBe(239);
    expect(parsed.validationErrors).toEqual([]);
  });

  it('keeps prerequisite text and equivalences as source metadata', () => {
    const parsed = parseUasdPensumRows(fixture.rows, {
      careerName: 'Ingeniería Civil',
      institution: 'Universidad Autónoma de Santo Domingo',
      plan: '000012',
      programCode: 'P-ICIV',
      sourceUrl: fixture.sourceUrl,
    });
    const calculus = parsed.catalog.periods[1]?.subjects.find((subject) => subject.id === 'MAT-2510');

    expect(calculus).toMatchObject({
      id: 'MAT-2510',
      name: 'Cálculo Y Analítica I',
      credits: 6,
      prerequisites: [{ type: 'one_of', subjects: ['MAT-2300'] }],
      source: {
        prerequisiteText: 'MAT2300 / (MAT2300)',
      },
    });
    expect(calculus?.source.equivalences).toContain('MAT-2500');
  });

  it('preserves prerequisite alternatives separately from mandatory groups', () => {
    const parsed = parseUasdPensumRows(fixture.rows, {
      careerName: 'Ingeniería Civil',
      institution: 'Universidad Autónoma de Santo Domingo',
      plan: '000012',
      programCode: 'P-ICIV',
      sourceUrl: fixture.sourceUrl,
    });
    const physics = parsed.catalog.periods
      .flatMap((period) => period.subjects)
      .find((subject) => subject.id === 'FIS-2110');

    expect(physics?.prerequisites).toEqual([
      { type: 'one_of', subjects: ['FIS-0140', 'FIS-0120', 'FIS-0180'] },
      { type: 'one_of', subjects: ['FIS-0200'] },
      { type: 'one_of', subjects: ['FIS-2210'] },
    ]);
  });

  it('produces a stable sha256 content hash for n8n source snapshots', () => {
    expect(rowsContentHash(fixture.rows)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(rowsContentHash(fixture.rows)).toBe(rowsContentHash(fixture.rows));
  });
});
