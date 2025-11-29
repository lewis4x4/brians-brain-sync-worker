import oauthRouter from './routes/oauth';
import express from 'express';
import dotenv from 'dotenv';
import cron from 'node-cron';
import healthRoute from './routes/health';
import syncRoute from './routes/sync';
import scheduler from './utils/scheduler';
import briefService from './services/brief.service';
import { EnrichmentService } from './services/enrichment.service';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;


import cors from 'cors';

// ... other code ...

app.use(cors({
  origin: 'https://preview--brians-brain-nexus.lovable.app',
  credentials: true
}));
app.use(express.json());

app.use(express.json());

// Health and sync routes
app.use('/oauth', oauthRouter);
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

// =====================================================
// Enrichment Endpoints
// =====================================================

const enrichmentService = new EnrichmentService();

// Backfill enrichment for existing events
app.post('/enrichment/backfill', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    console.log(`🏷️ Starting enrichment backfill (limit: ${limit})`);

    const count = await enrichmentService.backfillEnrichment(limit);

    res.json({
      success: true,
      message: `Enriched ${count} events`,
      count
    });
  } catch (error: any) {
    console.error('Enrichment backfill error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Enrich a single event by ID
app.post('/enrichment/event/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    console.log(`🏷️ Enriching event ${eventId}`);

    const result = await enrichmentService.enrichEvent(eventId);

    if (result) {
      res.json({
        success: true,
        enrichment: result
      });
    } else {
      res.status(404).json({ success: false, error: 'Event not found or enrichment failed' });
    }
  } catch (error: any) {
    console.error('Event enrichment error:', error);
    res.status(500).json({ success: false, error: error.message });
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
