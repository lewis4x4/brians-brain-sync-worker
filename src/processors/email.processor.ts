cd ~/Desktop/sync-worker/src/processors

cat > email.processor.ts << 'EOF'
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default class EmailProcessor {
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
        return null;
      }

      return data;
    } catch (err) {
      console.error('[DUPLICATE CHECK EXCEPTION]', err);
      return null;
    }
  }

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
      console.error('[DUPLICATE LOG ERROR]', err);
    }
  }

  private static extractBodyText(message: any): string {
    if (!message.body) return '';

    if (message.body.contentType === 'text') {
      return message.body.content || '';
    } else if (message.body.contentType === 'html') {
      return (message.body.content || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return message.body.content || '';
  }

  static async processMessages(
    messages: any[],
    connectionId: string,
    connectionEmail: string
  ): Promise<{ inserted: number; duplicates: number; skipped: number }> {
    console.log(\`[EMAIL PROCESSOR] Processing \${messages.length} messages for \${connectionEmail}\`);
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    let inserted = 0;
    let skipped = 0;
    let duplicates = 0;

    for (const message of messages) {
      try {
        const messageId = message.internetMessageId || message.id;
        
        if (!messageId) {
          console.warn('[EMAIL PROCESSOR] Message missing ID, skipping:', message.subject);
          skipped++;
          continue;
        }

        const existing = await this.checkForDuplicateEmail(supabase, messageId, message.subject);
        
        if (existing) {
          console.log('[DUPLICATE SKIP] Email already exists:', {
            messageId,
            subject: message.subject,
            existingEventId: existing.id,
            firstSeen: existing.created_at_ts
          });
          
          await this.logDuplicatePrevented(supabase, messageId, message.subject, existing.id);
          
          duplicates++;
          continue;
        }

        const eventData = {
          user_id: '3ccb8364-da19-482e-b3fa-6ee4ed40820b',
          event_type: 'email',
          source: 'microsoft_graph',
          external_id: messageId,
          subject: message.subject || '(No Subject)',
          body_text: this.extractBodyText(message),
          created_at_ts: message.receivedDateTime || message.sentDateTime || new Date().toISOString(),
          metadata: {
            from: message.from?.emailAddress?.address,
            from_name: message.from?.emailAddress?.name,
            to: message.toRecipients?.map((r: any) => r.emailAddress?.address),
            cc: message.ccRecipients?.map((r: any) => r.emailAddress?.address),
            bcc: message.bccRecipients?.map((r: any) => r.emailAddress?.address),
            hasAttachments: message.hasAttachments,
            importance: message.importance,
            conversationId: message.conversationId,
            internetMessageId: message.internetMessageId,
            isRead: message.isRead,
            isDraft: message.isDraft
          },
          raw: message
        };

        const { error } = await supabase
          .from('events')
          .insert(eventData);

        if (error) {
          console.error('[EMAIL INSERT ERROR]', {
            messageId,
            subject: message.subject,
            error
          });
          skipped++;
        } else {
          inserted++;
        }

      } catch (err) {
        console.error('[EMAIL PROCESSING ERROR]', {
          messageId: message?.internetMessageId || message?.id,
          error: err
        });
        skipped++;
      }
    }

    console.log(\`[EMAIL PROCESSOR] Complete: \${inserted} inserted, \${duplicates} duplicates prevented, \${skipped} skipped\`);
    
    return { inserted, duplicates, skipped };
  }
}
EOF

echo "email.processor.ts created!"