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
      @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
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
    </main>
    <script>
      const form = document.querySelector('#wizard');
      const result = document.querySelector('#result');
      const drafts = document.querySelector('#drafts');
      const terminalStatuses = new Set(['discarded', 'published']);
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

          for (const action of ['retry', 'discard', 'publish']) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.id = draft.id;
            button.dataset.action = action;
            button.textContent = action[0].toUpperCase() + action.slice(1);
            button.disabled = terminalStatuses.has(draft.status) || (action === 'publish' && draft.status !== 'candidate_ready');
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
        await runDraftAction(button.dataset.id, button.dataset.action);
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
