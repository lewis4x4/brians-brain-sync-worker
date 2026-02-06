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

    // Start async sync process
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
    // ✅ Safety check: verify email exists
    if (!connection.config?.email) {
      console.error('❌ No email found in connection config:', connection.id);
      return;
    }

    runId = await supabaseService.createIngestionRun(connection.id);
    console.log(`🔄 Starting manual sync for ${connection.config.email}...`);
    
    const accessToken = await tokenService.ensureValidToken(connection.id);
    
    console.log('📧 Syncing emails (inbox + sent)...');
    const [{ messages: inboxMessages }, { messages: sentMessages }] = await Promise.all([
      microsoftService.fetchMessages(accessToken, connection.config.email, 30, 'inbox'),
      microsoftService.fetchMessages(accessToken, connection.config.email, 30, 'sentitems'),
    ]);

    const inboxStats = await emailProcessor.processMessages(inboxMessages, connection.id, connection.config.email, 'inbox');
    const sentStats = await emailProcessor.processMessages(sentMessages, connection.id, connection.config.email, 'sentitems');
    const emailStats = {
      created: inboxStats.created + sentStats.created,
      duplicates: inboxStats.duplicates + sentStats.duplicates,
      skipped: inboxStats.skipped + sentStats.skipped,
    };
    const messages = [...inboxMessages, ...sentMessages];

    console.log('📅 Syncing calendar...');
    // ✅ FIXED: Use connection.config.email (not connection.account_email)
    const { events } = await microsoftService.fetchCalendarEvents(
      accessToken,
      connection.config.email
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