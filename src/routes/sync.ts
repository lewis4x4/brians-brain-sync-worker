import { Router } from 'express';
import supabaseService from '../services/supabase.service';
import tokenService from '../services/token.service';
import microsoftService from '../services/microsoft.service';
import emailProcessor from '../processors/email.processor';
import calendarProcessor from '../processors/calendar.processor';

const router = Router();

router.post('/sync/:connectionId', async (req, res) => {
  const { connectionId } = req.params;
  
  try {
    const connection = await supabaseService.getConnection(connectionId);
    
    if (!connection) {
      return res.status(404).json({ ok: false, error: 'Connection not found' });
    }
    
    performSync(connection).catch(err => console.error('Async sync error:', err));
    
    return res.status(202).json({ ok: true, message: 'Sync started' });
  } catch (error: any) {
    console.error('Sync route error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

async function performSync(connection: any) {
  let runId;
  
  try {
    runId = await supabaseService.createIngestionRun(connection.id);
    
    console.log('🔄 Starting sync...');
    
    const accessToken = await tokenService.ensureValidToken(connection.id);
    
    console.log('📧 Syncing emails...');
    // ✅ UPDATED: Add connection.account_email parameter
    const { messages } = await microsoftService.fetchMessages(
      accessToken,
      connection.account_email
    );
    const emailStats = await emailProcessor.processMessages(messages, accessToken);
    
    console.log('📅 Syncing calendar...');
    // ✅ UPDATED: Add connection.account_email parameter
    const { events } = await microsoftService.fetchCalendarEvents(
      accessToken,
      connection.account_email
    );
    const calendarStats = await calendarProcessor.processEvents(events);
    
    await supabaseService.completeIngestionRun(runId, {
      items_processed: messages.length + events.length,
      items_created: emailStats.created + calendarStats.created,
      items_updated: 0
    });
    
    console.log('✅ Sync completed successfully!');
  } catch (error: any) {
    console.error('❌ Sync failed:', error.message);
    console.error('Stack:', error.stack);
    
    if (runId) {
      await supabaseService.failIngestionRun(runId, error.message);
    }
  }
}

export default router;