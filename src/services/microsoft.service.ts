import { Client } from '@microsoft/microsoft-graph-client';
import logger from '../utils/logger';

export class MicrosoftService {
  async fetchMessages(accessToken: string, daysBack: number = 30) {
    const client = Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      },
    });

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const filterDate = startDate.toISOString();

    try {
      const response = await client
        .api('/me/messages')
        .filter(`receivedDateTime ge ${filterDate}`)
        .select('id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,hasAttachments')
        .top(100)
        .orderby('receivedDateTime desc')
        .get();

      logger.info(`📧 Fetched ${response.value?.length || 0} messages`);
      
      return {
        messages: response.value || [],
        deltaLink: null
      };
    } catch (error: any) {
      logger.error('Failed to fetch messages:', error.message);
      throw error;
    }
  }

  async fetchCalendarEvents(accessToken: string, daysBack: number = 30) {
    const client = Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      },
    });

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 90);

    try {
      const response = await client
        .api('/me/calendarview')
        .query({
          startDateTime: startDate.toISOString(),
          endDateTime: endDate.toISOString()
        })
        .select('id,subject,start,end,attendees,body,location,organizer')
        .top(100)
        .orderby('start/dateTime')
        .get();

      logger.info(`📅 Fetched ${response.value?.length || 0} calendar events`);
      
      return {
        events: response.value || [],
        deltaLink: null
      };
    } catch (error: any) {
      logger.error('Failed to fetch calendar events:', error.message);
      throw error;
    }
  }

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

    const data = await response.json();
    return data.value || [];
  }

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