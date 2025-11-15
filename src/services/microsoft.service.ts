import { Client } from '@microsoft/microsoft-graph-client';
import logger from '../utils/logger';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client for delta link storage
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const USER_ID = '3ccb8364-da19-782e-b3fa-6ee4ed40820b';

export class MicrosoftService {
  
  /**
   * Get stored delta link from Supabase sync_state table
   */
  private async getDeltaLink(
    accountEmail: string, 
    resourceType: 'messages' | 'calendar'
  ): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('sync_state')
        .select('delta_link')
        .eq('user_id', USER_ID)
        .eq('service', 'microsoft_graph')
        .eq('account_email', accountEmail)
        .eq('resource_type', resourceType)
        .single();

      if (error) {
        logger.info(`No delta link found for ${accountEmail} ${resourceType}, will do initial sync`);
        return null;
      }

      return data?.delta_link || null;
    } catch (error: any) {
      logger.warn('Error getting delta link:', error.message);
      return null;
    }
  }

  /**
   * Save delta link to Supabase sync_state table
   */
  private async saveDeltaLink(
    accountEmail: string,
    resourceType: 'messages' | 'calendar',
    deltaLink: string
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('sync_state')
        .upsert({
          user_id: USER_ID,
          service: 'microsoft_graph',
          account_email: accountEmail,
          resource_type: resourceType,
          delta_link: deltaLink,
          last_sync_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,service,account_email,resource_type'
        });

      if (error) {
        logger.error('Failed to save delta link:', error);
      } else {
        logger.info(`✅ Saved delta link for ${accountEmail} ${resourceType}`);
      }
    } catch (error: any) {
      logger.error('Error saving delta link:', error.message);
    }
  }

  /**
   * Fetch messages using delta queries (incremental sync)
   * On first run: fetches all messages
   * Subsequent runs: only new/changed messages
   */
  async fetchMessages(
    accessToken: string, 
    accountEmail: string,
    daysBack: number = 30  // Only used for initial sync
  ) {
    const client = Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      },
    });

    // Get stored delta link (if exists)
    const storedDeltaLink = await this.getDeltaLink(accountEmail, 'messages');
    
    let allMessages: any[] = [];
    let nextLink: string | null = null;
    let deltaLink: string | null = null;

    try {
      // Build initial URL
      let url: string;
      
      if (storedDeltaLink) {
        // Use stored delta link for incremental sync
        logger.info(`🔄 Using delta sync for ${accountEmail}`);
        url = storedDeltaLink;
      } else {
        // Initial sync - use delta endpoint with date filter
        logger.info(`🆕 Initial delta sync for ${accountEmail} (last ${daysBack} days)`);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        const filterDate = startDate.toISOString();
        
        url = `/me/mailFolders/inbox/messages/delta?$filter=receivedDateTime ge ${filterDate}&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,hasAttachments&$top=50`;
      }

      // Fetch messages (handle pagination)
      let pageCount = 0;
      const maxPages = 20; // Safety limit

      while (url && pageCount < maxPages) {
        pageCount++;
        
        let response: any;
        if (url.startsWith('http')) {
          // Use direct URL for delta/next links
          response = await client.api(url).get();
        } else {
          // Use path for initial request
          response = await client.api(url).get();
        }

        // Collect messages from this page
        if (response.value && response.value.length > 0) {
          allMessages = allMessages.concat(response.value);
          logger.info(`📧 Page ${pageCount}: ${response.value.length} messages (total: ${allMessages.length})`);
        }

        // Check for next page (pagination during delta sync)
        if (response['@odata.nextLink']) {
          url = response['@odata.nextLink'];
          nextLink = url;
        } else {
          // No more pages, check for delta link
          if (response['@odata.deltaLink']) {
            deltaLink = response['@odata.deltaLink'];
            logger.info(`✅ Got delta link for next sync`);
          }
          break;
        }
      }

      // Save delta link for next sync
      if (deltaLink) {
        await this.saveDeltaLink(accountEmail, 'messages', deltaLink);
      }

      logger.info(`📧 Fetched ${allMessages.length} messages total for ${accountEmail}`);
      
      return {
        messages: allMessages,
        deltaLink: deltaLink
      };

    } catch (error: any) {
      logger.error('Failed to fetch messages:', error.message);
      
      // If delta link is invalid (expired/broken), reset it
      if (error.message?.includes('delta') || error.statusCode === 410) {
        logger.warn('Delta link invalid, resetting for full sync next time');
        await supabase
          .from('sync_state')
          .delete()
          .eq('user_id', USER_ID)
          .eq('service', 'microsoft_graph')
          .eq('account_email', accountEmail)
          .eq('resource_type', 'messages');
      }
      
      throw error;
    }
  }

  /**
   * Fetch calendar events using delta queries
   * ✅ FIXED: Use calendarView/delta (not calendar/events/delta)
   * Calendar delta MUST use calendarView endpoint with startDateTime/endDateTime
   */
  async fetchCalendarEvents(
    accessToken: string, 
    accountEmail: string,
    daysBack: number = 30
  ) {
    const client = Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      },
    });

    const storedDeltaLink = await this.getDeltaLink(accountEmail, 'calendar');
    
    let allEvents: any[] = [];
    let deltaLink: string | null = null;

    try {
      let url: string;
      
      if (storedDeltaLink) {
        logger.info(`🔄 Using delta sync for ${accountEmail} calendar`);
        url = storedDeltaLink;
      } else {
        logger.info(`🆕 Initial delta sync for ${accountEmail} calendar`);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 90);
        
        // ✅ FIXED: Calendar must use calendarView/delta with query params
        // NOT calendar/events/delta with $filter (that causes the error)
        url = `/me/calendarView/delta?startDateTime=${startDate.toISOString()}&endDateTime=${endDate.toISOString()}`;
      }

      // Fetch events (handle pagination)
      let pageCount = 0;
      const maxPages = 20;

      while (url && pageCount < maxPages) {
        pageCount++;
        
        const response = await client.api(url).get();

        if (response.value && response.value.length > 0) {
          allEvents = allEvents.concat(response.value);
          logger.info(`📅 Page ${pageCount}: ${response.value.length} events (total: ${allEvents.length})`);
        }

        if (response['@odata.nextLink']) {
          url = response['@odata.nextLink'];
        } else {
          if (response['@odata.deltaLink']) {
            deltaLink = response['@odata.deltaLink'];
            logger.info(`✅ Got delta link for calendar next sync`);
          }
          break;
        }
      }

      if (deltaLink) {
        await this.saveDeltaLink(accountEmail, 'calendar', deltaLink);
      }

      logger.info(`📅 Fetched ${allEvents.length} calendar events for ${accountEmail}`);
      
      return {
        events: allEvents,
        deltaLink: deltaLink
      };

    } catch (error: any) {
      logger.error('Failed to fetch calendar events:', error.message);
      
      // Reset if delta link invalid
      if (error.message?.includes('delta') || error.statusCode === 410) {
        logger.warn('Calendar delta link invalid, resetting');
        await supabase
          .from('sync_state')
          .delete()
          .eq('user_id', USER_ID)
          .eq('service', 'microsoft_graph')
          .eq('account_email', accountEmail)
          .eq('resource_type', 'calendar');
      }
      
      throw error;
    }
  }

  /**
   * Fetch attachments (unchanged - not using delta)
   */
  async fetchAttachments(messageId: string, accessToken: string): Promise<any[]> {
    const url = `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch attachments: ${response.statusText}`);
    }

    const data = await response.json() as { value?: any[] };
    return data.value || [];
  }

  /**
   * Download attachment (unchanged)
   */
  async downloadAttachment(messageId: string, attachmentId: string, accessToken: string): Promise<Buffer> {
    const url = `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments/${attachmentId}/$value`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download attachment: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

export default new MicrosoftService();