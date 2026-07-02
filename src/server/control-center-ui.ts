export function renderControlCenterWizard() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>StudyTrack Control Center</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
      main { max-width: 920px; margin: 0 auto; padding: 32px 20px; }
      section { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 8px 24px rgb(15 23 42 / 0.06); }
      label { display: block; font-weight: 650; margin-top: 16px; }
      input, select, textarea { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 10px; font: inherit; }
      button { margin-top: 20px; padding: 12px 16px; border: 0; border-radius: 10px; background: #1d4ed8; color: white; font-weight: 700; cursor: pointer; }
      button:disabled { background: #94a3b8; cursor: not-allowed; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .hint { color: #475569; font-size: 0.95rem; }
      .result { margin-top: 20px; padding: 16px; border-radius: 12px; background: #eff6ff; white-space: pre-wrap; }
      .error { background: #fef2f2; color: #991b1b; }
      .draft-card { margin-top: 14px; padding: 14px; border: 1px solid #cbd5e1; border-radius: 12px; background: #f8fafc; }
      .draft-card p { margin: 6px 0; }
      .status { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #dbeafe; color: #1e40af; font-size: 0.85rem; font-weight: 700; }
      .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .actions button { margin-top: 0; padding: 8px 10px; }
      .actions button[data-action="discard"] { background: #b91c1c; }
      .actions button[data-action="publish"] { background: #047857; }
      .review-panel { margin-top: 20px; }
      .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 12px 0; }
      .summary-card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px; }
      .summary-card strong { display: block; font-size: 1.4rem; }
      details { margin-top: 10px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; background: #f8fafc; }
      summary { cursor: pointer; font-weight: 800; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.92rem; }
      th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
      th { color: #334155; }
      .candidate-editor { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; min-height: 280px; }
      @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
      @media (max-width: 900px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    </style>
  </head>
  <body>
    <main>
      <h1>StudyTrack Control Center</h1>
      <p class="hint">Create a UASD curriculum draft, send it to n8n for extraction, then review the candidate before publishing.</p>
      <section>
        <h2>New UASD draft</h2>
        <form id="wizard">
          <label>University</label>
          <select name="institution" required>
            <option value="Universidad Autónoma de Santo Domingo">Universidad Autónoma de Santo Domingo</option>
          </select>
          <div class="grid">
            <label>Career name
              <input name="careerName" required placeholder="Ingeniería Civil" />
            </label>
            <label>Program code
              <input name="programCode" required placeholder="P-ICIV" />
            </label>
            <label>Plan
              <input name="plan" required placeholder="000012" />
            </label>
            <label>Expected periods
              <input name="expectedPeriods" required type="number" min="1" value="11" />
            </label>
          </div>
          <label>Pensum URL</label>
          <input name="sourceUrl" required type="url" placeholder="https://app.uasd.edu.do/PensumGrado/?periodoV=999999&programa=P-ICIV&plan=000012&nivel=GR" />
          <label>Requested by</label>
          <input name="requestedBy" type="email" placeholder="operator@example.com" />
          <label>Notes for review</label>
          <textarea name="notes" rows="3" placeholder="Anything the reviewer should know"></textarea>
          <button type="submit">Create draft and prepare n8n extraction</button>
        </form>
        <div id="result" class="result" hidden></div>
      </section>
      <section style="margin-top: 20px;">
        <h2>Drafts</h2>
        <p class="hint">Review created drafts, resend them to n8n, discard them, or publish once a valid candidate has returned.</p>
        <button type="button" id="refresh">Refresh drafts</button>
        <div id="drafts" class="result"></div>
      </section>
      <section id="candidate-review" class="review-panel" hidden>
        <h2>Candidate Review</h2>
        <p class="hint">Review extracted periods and subjects before publishing. Use the JSON editor for precise corrections.</p>
        <h3 id="review-title"></h3>
        <div id="review-summary" class="summary-grid"></div>
        <div id="review-catalog"></div>
        <label>Editable candidate JSON</label>
        <textarea id="candidate-json" class="candidate-editor" spellcheck="false"></textarea>
        <button type="button" id="save-candidate">Save candidate edits</button>
      </section>
    </main>
    <script>
      const form = document.querySelector('#wizard');
      const result = document.querySelector('#result');
      const drafts = document.querySelector('#drafts');
      const reviewPanel = document.querySelector('#candidate-review');
      const reviewTitle = document.querySelector('#review-title');
      const reviewSummary = document.querySelector('#review-summary');
      const reviewCatalog = document.querySelector('#review-catalog');
      const candidateJson = document.querySelector('#candidate-json');
      const saveCandidate = document.querySelector('#save-candidate');
      const terminalStatuses = new Set(['discarded', 'published']);
      let currentReviewDraftId = null;
      function showResult(message, isError = false) {
        result.hidden = false;
        result.className = isError ? 'result error' : 'result';
        result.textContent = message;
      }
      function dispatchMessage(status) {
        if (status === 'sent') return 'n8n extraction was requested.';
        if (status === 'failed') return 'n8n webhook request failed. Check the webhook URL, then retry this draft.';
        return 'n8n webhook is not configured. Copy this payload into the workflow webhook/manual input:';
      }
      function text(value) {
        return value == null ? '' : String(value);
      }
      function renderSummary(summary) {
        reviewSummary.replaceChildren();
        for (const [label, value] of [
          ['Periods', summary.periods],
          ['Subjects', summary.subjects],
          ['Credits', summary.credits],
          ['Validation', summary.validationStatus],
        ]) {
          const card = document.createElement('div');
          card.className = 'summary-card';
          const strong = document.createElement('strong');
          strong.textContent = text(value);
          const span = document.createElement('span');
          span.textContent = label;
          card.append(strong, span);
          reviewSummary.appendChild(card);
        }
      }
      function renderCatalog(catalog) {
        reviewCatalog.replaceChildren();
        for (const period of catalog.periods || []) {
          const details = document.createElement('details');
          details.open = true;
          const summary = document.createElement('summary');
          summary.textContent = text(period.name || 'Period ' + period.period_number) + ' · ' + (period.subjects || []).length + ' subjects';
          const table = document.createElement('table');
          table.innerHTML = '<thead><tr><th>Code</th><th>Subject</th><th>Credits</th><th>Prerequisites</th></tr></thead>';
          const tbody = document.createElement('tbody');
          for (const subject of period.subjects || []) {
            const row = document.createElement('tr');
            const prerequisiteText = (subject.prerequisites || [])
              .map((group) => (group.subjects || []).join(' or '))
              .filter(Boolean)
              .join('; ');
            for (const value of [subject.code, subject.name, subject.credits, prerequisiteText || 'None']) {
              const cell = document.createElement('td');
              cell.textContent = text(value);
              row.appendChild(cell);
            }
            tbody.appendChild(row);
          }
          table.appendChild(tbody);
          details.append(summary, table);
          reviewCatalog.appendChild(details);
        }
      }
      async function openReview(id) {
        showResult('Loading candidate review for ' + id + '...');
        const response = await fetch('/api/uasd/pensum-drafts/' + id + '/review');
        const json = await response.json();
        if (!response.ok) {
          showResult(json.details || json.error || 'Candidate review is not available yet', true);
          return;
        }
        currentReviewDraftId = id;
        reviewPanel.hidden = false;
        reviewTitle.textContent = json.draft.careerName + ' (' + json.draft.programCode + ' / ' + json.draft.plan + ')';
        renderSummary(json.summary);
        renderCatalog(json.candidate.extractedCatalogJson);
        candidateJson.value = JSON.stringify(json.candidate.extractedCatalogJson, null, 2);
        saveCandidate.disabled = terminalStatuses.has(json.draft.status);
        showResult('Candidate loaded for review.');
        reviewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      async function refreshDrafts() {
        const response = await fetch('/api/uasd/pensum-drafts');
        const json = await response.json();
        drafts.replaceChildren();
        if (!json.drafts.length) {
          drafts.textContent = 'No drafts yet.';
          return;
        }
        for (const draft of json.drafts) {
          const card = document.createElement('article');
          card.className = 'draft-card';

          const title = document.createElement('h3');
          title.textContent = draft.careerName + ' (' + draft.programCode + ' / ' + draft.plan + ')';
          const status = document.createElement('span');
          status.className = 'status';
          status.textContent = draft.status;
          const source = document.createElement('p');
          source.textContent = draft.sourceUrl;
          const actions = document.createElement('div');
          actions.className = 'actions';

          for (const action of ['review', 'retry', 'discard', 'publish']) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.id = draft.id;
            button.dataset.action = action;
            button.textContent = action[0].toUpperCase() + action.slice(1);
            button.disabled =
              (action === 'review' && !['candidate_ready', 'needs_review', 'published'].includes(draft.status)) ||
              (action !== 'review' && terminalStatuses.has(draft.status)) ||
              (action === 'publish' && draft.status !== 'candidate_ready');
            actions.appendChild(button);
          }

          card.append(title, status, source, actions);
          drafts.appendChild(card);
        }
      }
      async function runDraftAction(id, action) {
        showResult('Running ' + action + ' for ' + id + '...');
        const response = await fetch('/api/uasd/pensum-drafts/' + id + '/' + action, { method: 'POST' });
        const json = await response.json();
        if (!response.ok) {
          showResult(json.details || json.error || 'Action failed', true);
          return;
        }
        showResult('Draft ' + json.draft.id + ' is now ' + json.draft.status + '.');
        await refreshDrafts();
      }
      document.querySelector('#refresh').addEventListener('click', refreshDrafts);
      drafts.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        if (button.dataset.action === 'review') {
          await openReview(button.dataset.id);
          return;
        }
        await runDraftAction(button.dataset.id, button.dataset.action);
      });
      saveCandidate.addEventListener('click', async () => {
        if (!currentReviewDraftId) return;
        let extractedCatalogJson;
        try {
          extractedCatalogJson = JSON.parse(candidateJson.value);
        } catch (error) {
          showResult('Candidate JSON is invalid: ' + error.message, true);
          return;
        }
        const response = await fetch('/api/uasd/pensum-drafts/' + currentReviewDraftId + '/candidate', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ extractedCatalogJson }),
        });
        const json = await response.json();
        if (!response.ok) {
          showResult(json.details || json.error || 'Candidate save failed', true);
          return;
        }
        renderSummary(json.summary);
        renderCatalog(json.candidate.extractedCatalogJson);
        candidateJson.value = JSON.stringify(json.candidate.extractedCatalogJson, null, 2);
        showResult('Candidate edits saved.');
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        showResult('Creating draft...');
        const data = Object.fromEntries(new FormData(form).entries());
        data.expectedPeriods = Number(data.expectedPeriods);
        const response = await fetch('/api/uasd/pensum-drafts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        });
        const json = await response.json();
        if (!response.ok) {
          showResult(json.details || json.error || 'Request failed', true);
          return;
        }
        showResult([
          'Draft created: ' + json.draft.id,
          'Status: ' + json.draft.status,
          '',
          dispatchMessage(json.n8n.dispatchStatus),
          '',
          JSON.stringify(json.n8n.payload, null, 2),
        ].join('\\n'));
        await refreshDrafts();
      });
      refreshDrafts();
    </script>
  </body>
</html>`;
}
