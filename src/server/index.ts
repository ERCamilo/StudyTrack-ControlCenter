import { createControlCenterServer } from './control-center-server.js';

const port = Number(process.env.PORT || 3000);
const app = createControlCenterServer();
const running = await app.listen(port);

console.log(`StudyTrack Control Center listening on http://127.0.0.1:${running.port}`);
