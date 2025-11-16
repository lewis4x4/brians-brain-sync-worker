import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default class CalendarProcessor {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  /**
   * Check if a calendar event already exists based on iCalUId
   * @returns existing event if found, null otherwise
   */
  private async checkForDuplicateEvent(
    iCalUId: string,
    subject: string
  ): Promise<{ id: string; subject: string; created_at_ts: string } | null> {
    try {
      const { data, error } = await this.supabase
        .from('events')
        .select('id, subject, created_at_ts')
        .eq('event_type', 'meeting')
        .filter('raw->>iCalUId', 'eq', iCalUId)
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
  private async logDuplicatePrevented(
    iCalUId: string,
    subject: string,
    existingEventId: string
  ): Promise<void> {
    try {
      await this.supabase.from('duplicate_prevention_log').insert({
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
      // Don't fail the sync if logging fails
      console.error('[DUPLICATE LOG ERROR]', err);
    }
  }

  /**
   * Extract plain text from event body
   */
  private extractBodyText(body: any): string {
    if (!body) return '';

    // Prefer plain text, fall back to HTML
    if (body.contentType === 'text') {
      return body.content || '';
    } else if (body.contentType === 'html') {
      // Basic HTML stripping
      return (body.content || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return body.content || '';
  }

  /**
   * Process calendar events from Microsoft Graph API
   */
  async processCalendarEvents(
    events: any[],
    connectionId: string,
    connectionEmail: string
  ): Promise<{ inserted: number; duplicates: number; skipped: number }> {
    console.log(`[CALENDAR PROCESSOR] Processing ${events.length} events for ${connectionEmail}`);
    
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

        // ===== DUPLICATE CHECK =====
        const existing = await this.checkForDuplicateEvent(iCalUId, event.subject);
        
        if (existing) {
          console.log('[DUPLICATE SKIP] Calendar event already exists:', {
            iCalUId,
            subject: event.subject,
            existingEventId: existing.id,
            firstSeen: existing.created_at_ts
          });
          
          // Log the prevented duplicate
          await this.logDuplicatePrevented(iCalUId, event.subject, existing.id);
          
          duplicates++;
          continue; // Skip to next event
        }
        // ===== END DUPLICATE CHECK =====

        // If we get here, it's not a duplicate - proceed with insert
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
          raw: event // CRITICAL: Store complete event with iCalUId
        };

        const { error } = await this.supabase
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

    console.log(`[CALENDAR PROCESSOR] Complete: ${inserted} inserted, ${duplicates} duplicates prevented, ${skipped} skipped`);
    
    return { inserted, duplicates, skipped };
  }
}