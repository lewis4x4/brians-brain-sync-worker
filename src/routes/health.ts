import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'brian-ai-brain-sync-worker',
    message: 'Sync worker is running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: 'GET /health',
      sync: 'POST /sync/:connectionId'
    }
  });
});

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'brian-ai-brain-sync-worker',
    uptime: process.uptime()
  });
});

export default router;
