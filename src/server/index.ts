import { createControlCenterServer } from './control-center-server.js';

const port = Number(process.env.PORT || 3000);
const app = createControlCenterServer({ n8nUasdWebhookUrl: process.env.N8N_UASD_WEBHOOK_URL });
const running = await app.listen(port);

console.log(`StudyTrack Control Center listening on http://127.0.0.1:${running.port}`);
