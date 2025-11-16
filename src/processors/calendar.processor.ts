cat > calendar.processor.ts << 'EOF'
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default class CalendarProcessor {
  private static async checkForDuplicateEvent(
    supabase: SupabaseClient,
    iCalUId: string,
    subject: string
  ): Promise<{ id: string; subject: string; created_at_ts: string } | null> {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('id, subject, created_at_ts')
        .eq('event_type', 'meeting')
        .filter('raw->>iCalUId', 'eq', iCalUId)
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
    iCalUId: string,
    subject: string,
    existingEventId: string
  ): Promise<void> {
    try {
      await supabase.from('duplicate_prevention_log').insert({
        event_type: 'meeting',
        identifier: iCalUId,
        subject: subject,
        existing_event_id: existingEventId,
        source: 'calendar_processor',
        metadata: {
          sync_timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      console.error('[DUPLICATE LOG ERROR]', err);
    }
  }

  private static extractBodyText(body: any): string {
    if (!body) return '';

    if (body.contentType === 'text') {
      return body.content || '';
    } else if (body.contentType === 'html') {
      return (body.content || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return body.content || '';
  }

  static async processEvents(
    events: any[],
    connectionId: string,
    connectionEmail: string
  ): Promise<{ inserted: number; duplicates: number; skipped: number }> {
    console.log(\`[CALENDAR PROCESSOR] Processing \${events.length} events for \${connectionEmail}\`);
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    let inserted = 0;
    let skipped = 0;
    let duplicates = 0;

    for (const event of events) {
      try {
        const iCalUId = event.iCalUId;
        
        if (!iCalUId) {
          console.warn('[CALENDAR PROCESSOR] Event missing iCalUId, skipping:', event.subject);
          skipped++;
          continue;
        }

        const existing = await this.checkForDuplicateEvent(supabase, iCalUId, event.subject);
        
        if (existing) {
          console.log('[DUPLICATE SKIP] Calendar event already exists:', {
            iCalUId,
            subject: event.subject,
            existingEventId: existing.id,
            firstSeen: existing.created_at_ts
          });
          
          await this.logDuplicatePrevented(supabase, iCalUId, event.subject, existing.id);
          
          duplicates++;
          continue;
        }

        const eventData = {
          user_id: '3ccb8364-da19-482e-b3fa-6ee4ed40820b',
          event_type: 'meeting',
          source: 'microsoft_graph',
          external_id: event.id,
          subject: event.subject || '(No Subject)',
          body_text: this.extractBodyText(event.body),
          created_at_ts: event.start?.dateTime || event.createdDateTime || new Date().toISOString(),
          metadata: {
            organizer: event.organizer?.emailAddress?.address,
            organizer_name: event.organizer?.emailAddress?.name,
            attendees: event.attendees?.map((a: any) => ({
              email: a.emailAddress?.address,
              name: a.emailAddress?.name,
              status: a.status?.response,
              type: a.type
            })),
            location: event.location?.displayName,
            location_full: event.location,
            start: event.start?.dateTime,
            end: event.end?.dateTime,
            timezone: event.start?.timeZone,
            isAllDay: event.isAllDay,
            isCancelled: event.isCancelled,
            isOrganizer: event.isOrganizer,
            showAs: event.showAs,
            responseStatus: event.responseStatus?.response,
            sensitivity: event.sensitivity,
            webLink: event.webLink
          },
          raw: event
        };

        const { error } = await supabase
          .from('events')
          .insert(eventData);

        if (error) {
          console.error('[CALENDAR INSERT ERROR]', {
            iCalUId,
            subject: event.subject,
            error
          });
          skipped++;
        } else {
          inserted++;
        }

      } catch (err) {
        console.error('[CALENDAR PROCESSING ERROR]', {
          iCalUId: event?.iCalUId,
          error: err
        });
        skipped++;
      }
    }

    console.log(\`[CALENDAR PROCESSOR] Complete: \${inserted} inserted, \${duplicates} duplicates prevented, \${skipped} skipped\`);
    
    return { inserted, duplicates, skipped };
  }
}
EOF

echo "calendar.processor.ts created!"