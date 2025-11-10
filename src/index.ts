import express from 'express';
import dotenv from 'dotenv';
import healthRoute from './routes/health';
import syncRoute from './routes/sync';
import scheduler from './utils/scheduler';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.use('/', healthRoute);
app.use('/', syncRoute);

app.listen(port, () => {
  console.log(`🚀 Sync worker started on port ${port}`);
  console.log(`✅ Ready to sync Microsoft 365 data`);
  
  scheduler.start();
});
