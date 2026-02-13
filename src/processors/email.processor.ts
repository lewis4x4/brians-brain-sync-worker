import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EnrichmentService } from '../services/enrichment.service';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const enrichmentService = new EnrichmentService();

export default class EmailProcessor {
  /**
   * Check if an email already exists based on internetMessageId
   * @returns existing event if found, null otherwise
   */
  private static async checkForDuplicateEmail(
    supabase: SupabaseClient,
    messageId: string,
    subject: string
  ): Promise<{ id: string; subject: string; created_at_ts: string } | null> {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('id, subject, created_at_ts')
        .eq('event_type', 'email')
        .eq('external_id', messageId)
        .maybeSingle();

      if (error) {
        console.error('[DUPLICATE CHECK ERROR]', error);
        return null; // Fail-safe: allow insert if check fails
      }

      return data;
    } catch (err) {
      console.error('[DUPLICATE CHECK EXCEPTION]', err);
      return null; // Fail-safe: allow insert if check fails
    }
  }

  /**
   * Log when we prevent a duplicate insertion
   */
  private static async logDuplicatePrevented(
    supabase: SupabaseClient,
    messageId: string,
    subject: string,
    existingEventId: string
  ): Promise<void> {
    try {
      await supabase.from('duplicate_prevention_log').insert({
        event_type: 'email',
        identifier: messageId,
        subject: subject,
        existing_event_id: existingEventId,
        source: 'email_processor',
        metadata: {
          sync_timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      // Don't fail the sync if logging fails
      console.error('[DUPLICATE LOG ERROR]', err);
    }
  }

  /**
   * Extract plain text from email body
   */
  private static extractBodyText(message: any): string {
    if (!message.body) return '';

    // Prefer plain text, fall back to HTML
    if (message.body.contentType === 'text') {
      return message.body.content || '';
    } else if (message.body.contentType === 'html') {
      // Basic HTML stripping
      return (message.body.content || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return message.body.content || '';
  }

  /**
   * Process email messages from Microsoft Graph API
   * STATIC method - called as EmailProcessor.processMessages()
   */
  static async processMessages(
    messages: any[],
    connectionId: string,
    accountEmail?: string,
    folder: string = 'inbox'
  ): Promise<{ created: number; duplicates: number; skipped: number }> {
    console.log(`[EMAIL PROCESSOR] Processing ${messages.length} messages [${folder}]`);
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    let created = 0;
    let skipped = 0;
    let duplicates = 0;

    for (const message of messages) {
      try {
        // Extract message identifier
        const messageId = message.internetMessageId || message.id;
        
        if (!messageId) {
          console.warn('[EMAIL PROCESSOR] Message missing ID, skipping:', message.subject);
          skipped++;
          continue;
        }

        // ===== DUPLICATE CHECK =====
        const existing = await this.checkForDuplicateEmail(supabase, messageId, message.subject);
        
        if (existing) {
          console.log('[DUPLICATE SKIP] Email already exists:', {
            messageId,
            subject: message.subject,
            existingEventId: existing.id,
            firstSeen: existing.created_at_ts
          });
          
          // Log the prevented duplicate
          await this.logDuplicatePrevented(supabase, messageId, message.subject, existing.id);
          
          duplicates++;
          continue; // Skip to next message
        }
        // ===== END DUPLICATE CHECK =====

        // If we get here, it's not a duplicate - proceed with insert
        const eventData = {
          user_id: '3ccb8364-da19-482e-b3fa-6ee4ed40820b',
          event_type: 'email',
          source: 'microsoft_graph',
          external_id: messageId, // CRITICAL: Use internetMessageId
          subject: message.subject || '(No Subject)',
          body_text: this.extractBodyText(message),
          created_at_ts: message.receivedDateTime || message.sentDateTime || new Date().toISOString(),
          metadata: {
            direction: folder === 'sentitems' ? 'sent' : 'received',
            connection_id: connectionId,
            from_email: message.from?.emailAddress?.address,
            from_name: message.from?.emailAddress?.name,
            to_email: message.toRecipients?.[0]?.emailAddress?.address,
            from: message.from?.emailAddress?.address,
            to: message.toRecipients?.map((r: any) => r.emailAddress?.address),
            cc: message.ccRecipients?.map((r: any) => r.emailAddress?.address),
            bcc: message.bccRecipients?.map((r: any) => r.emailAddress?.address),
            hasAttachments: message.hasAttachments,
            importance: message.importance,
            conversationId: message.conversationId,
            thread_key: message.conversationId,
            internetMessageId: message.internetMessageId,
            isRead: message.isRead,
            isDraft: message.isDraft
          },
          raw_source_data: message // Store complete message for future reference
        };

        const { data: inserted, error } = await supabase
          .from('events')
          .insert(eventData)
          .select('id')
          .single();

        if (error) {
          console.error('[EMAIL INSERT ERROR]', {
            messageId,
            subject: message.subject,
            error
          });
          skipped++;
        } else {
          created++;

          // Auto-enrich the event with tags and categorization
          if (inserted?.id) {
            await enrichmentService.enrichEvent(inserted.id);
          }
        }

      } catch (err) {
        console.error('[EMAIL PROCESSING ERROR]', {
          messageId: message?.internetMessageId || message?.id,
          error: err
        });
        skipped++;
      }
    }

    console.log('[EMAIL PROCESSOR] Complete: ' + created + ' created, ' + duplicates + ' duplicates prevented, ' + skipped + ' skipped');
    
    return { created, duplicates, skipped };
  }
}