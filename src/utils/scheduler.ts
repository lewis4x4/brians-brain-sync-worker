import cron from 'node-cron';
import supabaseService from '../services/supabase.service';
import tokenService from '../services/token.service';
import microsoftService from '../services/microsoft.service';
import emailProcessor from '../processors/email.processor';
import calendarProcessor from '../processors/calendar.processor';

class Scheduler {
  private isRunning = false;

  start() {
    const intervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES || '5');
    const cronExpression = `*/${intervalMinutes} * * * *`;
    
    console.log(`Starting scheduler: syncing every ${intervalMinutes} minutes`);

    cron.schedule(cronExpression, async () => {
      if (this.isRunning) {
        console.log('Previous sync still running, skipping...');
        return;
      }

      this.isRunning = true;
      try {
        await this.syncAllConnections();
      } catch (error: any) {
        console.error('Scheduled sync error:', error.message);
      } finally {
        this.isRunning = false;
      }
    });
  }

  private async syncAllConnections() {
    console.log('Starting scheduled sync...');
    const connections = await supabaseService.getActiveConnections();
    
    if (!connections.length) {
      console.log('No active connections');
      return;
    }

    for (const connection of connections) {
      await this.syncConnection(connection);
    }
  }

  private async syncConnection(connection: any) {
    const runId = await supabaseService.createIngestionRun(connection.id);
    
    try {
      const accessToken = await tokenService.ensureValidToken(connection.id);
      
      const { messages } = await microsoftService.fetchMessages(
  accessToken,
  connection.account_email
);
      
      const emailStats = await emailProcessor.processMessages(messages, accessToken);
      
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
      
      console.log('✅ Sync completed successfully');
    } catch (error: any) {
      console.error('❌ Sync failed:', error.message);
      await supabaseService.failIngestionRun(runId, error.message);
    }
  }
}

export default new Scheduler();