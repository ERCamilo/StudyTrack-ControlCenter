import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const workflow = JSON.parse(
  readFileSync(new URL('../n8n/workflows/uasd-pensum-ingestion.json', import.meta.url), 'utf8'),
);

describe('n8n UASD workflow', () => {
  it('is importable JSON with the expected Control Center endpoints', () => {
    expect(workflow.name).toBe('StudyTrack - UASD Pensum to Control Center');
    expect(workflow.nodes.map((node: { name: string }) => node.name)).toEqual(
      expect.arrayContaining([
        'Set UASD Params',
        'Wizard Webhook',
        'Fetch UASD Pensum',
        'Extract UASD Rows',
        'Post Candidate to Control Center',
      ]),
    );
    expect(JSON.stringify(workflow)).toContain('/api/uasd/pensum-candidates');
    expect(JSON.stringify(workflow)).toContain('studytrack/uasd-pensum');
    expect(JSON.stringify(workflow)).toContain('$json.body?.sourceUrl');
    expect(JSON.stringify(workflow)).toContain('P-ICIV');
    expect(workflow.active).toBe(false);
  });

  it('runs wizard payload extraction before posting the extracted candidate', () => {
    expect(workflow.connections['Wizard Webhook'].main[0][0].node).toBe('Set UASD Params');
    expect(workflow.connections['Set UASD Params'].main[0][0].node).toBe('Fetch UASD Pensum');
    expect(workflow.connections['Extract UASD Rows'].main[0][0].node).toBe('Post Candidate to Control Center');
  });
});
