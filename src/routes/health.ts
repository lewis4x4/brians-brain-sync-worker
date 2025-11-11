import { Router } from 'express';

const router = Router();

// Root endpoint - for n8n health checks and browser visits
router.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'brian-ai-brain-sync-worker',
    message: 'Sync worker is running. Use /health for detailed status.',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: 'GET /health',
      sync: 'POST /sync/:connectionId'
    }
  });
});

// Detailed health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'brian-ai-brain-sync-worker',
    uptime: process.uptime()
  });
});

export default router;
```

---

## Step 7: Save and Exit Nano

1. **Press:** `Ctrl+X`
2. **It asks:** "Save modified buffer?"
3. **Type:** `Y` (yes)
4. **Press:** `Enter` (confirms filename)

**You're back at the command prompt:**
```
brianlewis@Mac sync-worker %
