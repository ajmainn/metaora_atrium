import { startDailyEmailScheduler } from './scheduledEmails';
import { createApp } from './app';

const port = Number(process.env.API_PORT) || 4000;
const app = createApp();

app.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
  startDailyEmailScheduler();
});
