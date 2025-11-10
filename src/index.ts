import express from 'express';
import dotenv from 'dotenv';
import cron from 'node-cron';
import healthRoute from './routes/health';
import syncRoute from './routes/sync';
import scheduler from './utils/scheduler';
import briefService from './services/brief.service';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Health and sync routes
app.use('/', healthRoute);
app.use('/', syncRoute);

// Manual brief send endpoint
app.post('/brief/send/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`📧 Manual brief trigger for user ${userId}`);
    
    const result = await briefService.sendBrief(userId);
    
    if (result.ok) {
      res.json({ success: true, message: 'Brief sent successfully' });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error('Brief endpoint error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test brief endpoint (doesn't send, just returns HTML)
app.get('/brief/preview/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    res.send('Brief preview endpoint - implement if needed');
  } catch (error: any) {
    res.status(500).send(error.message);
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Sync worker started on port ${port}`);
  console.log(`✅ Ready to sync Microsoft 365 data`);
  
  // Start Microsoft 365 sync scheduler (every 5 minutes)
  scheduler.start();
  
  // Start daily brief scheduler (check every hour)
  console.log('⏰ Daily brief scheduler started (checking hourly)');
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ Checking for daily briefs to send...');
    try {
      await briefService.checkAndSendBriefs();
    } catch (error) {
      console.error('Error in brief scheduler:', error);
    }
  });
});