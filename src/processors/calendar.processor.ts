import supabaseService from '../services/supabase.service';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

class CalendarProcessor {
  /**
   * Check if a calendar event with this iCalUId already exists
   */
  private async isDuplicate(iCalUId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('id')
        .eq('event_type', 'meeting')
        .eq('raw->>iCalUId', iCalUId)
        .maybeSingle();

      if (error) {
        console.error('Error checking for duplicate:', error);
        return false; // If check fails, allow insert (safer)
      }

      return !!data; // Returns true if event exists
    } catch (error) {
      console.error('Exception checking duplicate:', error);
      return false; // If check fails, allow insert (safer)
    }
  }

  async processEvents(events: any[]) {
    let created = 0;
    let updated = 0;
    let skipped = 0;

    console.log(`Processing ${events.length} calendar events...`);

    for (const graphEvent of events) {
      try {
        // Check for duplicate BEFORE creating event object
        if (graphEvent.iCalUId) {
          const isDupe = await this.isDuplicate(graphEvent.iCalUId);
          if (isDupe) {
            console.log(`⏭️  Skipping duplicate: ${graphEvent.subject} (iCalUId: ${graphEvent.iCalUId.substring(0, 20)}...)`);
            skipped++;
            continue;
          }
        }

        const event = {
          user_id: '3ccb8364-da19-782e-b3fa-6ee4ed40820b',
          event_type: 'meeting',
          source: 'microsoft_graph',
          external_id: graphEvent.id,
          created_at_ts: graphEvent.start?.dateTime || new Date().toISOString(),
          subject: graphEvent.subject || '(No Subject)',
          body_text: graphEvent.body?.content || '',
          metadata: {
            start_time: graphEvent.start?.dateTime,
            end_time: graphEvent.end?.dateTime,
            location: graphEvent.location?.displayName
          },
          raw: graphEvent
        };

        await supabaseService.upsertEvent(event);
        created++;
      } catch (error) {
        console.error('Error processing calendar event:', error);
      }
    }

    console.log(`Processed calendar events: ${created} created, ${skipped} skipped (duplicates)`);
    return { created, updated, skipped };
  }
}

export default new CalendarProcessor();