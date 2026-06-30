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
        'Create CC Ingestion Request',
        'Fetch UASD Pensum',
        'Extract UASD Rows',
        'Post Candidate to Control Center',
      ]),
    );
    expect(JSON.stringify(workflow)).toContain('/api/ingestion-requests');
    expect(JSON.stringify(workflow)).toContain('/api/uasd/pensum-candidates');
    expect(JSON.stringify(workflow)).toContain('P-ICIV');
    expect(workflow.active).toBe(false);
  });

  it('runs request creation before posting the extracted candidate', () => {
    expect(workflow.connections['Create CC Ingestion Request'].main[0][0].node).toBe('Fetch UASD Pensum');
    expect(workflow.connections['Extract UASD Rows'].main[0][0].node).toBe('Post Candidate to Control Center');
  });
});
