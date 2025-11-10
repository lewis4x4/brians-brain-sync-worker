import supabaseService from '../services/supabase.service';

class CalendarProcessor {
  async processEvents(events: any[]) {
    let created = 0;
    let updated = 0;

    console.log(`Processing ${events.length} calendar events...`);

    for (const graphEvent of events) {
      try {
        const event = {
          event_type: 'meeting',
          external_id: graphEvent.id,
          created_at_ts: graphEvent.start?.dateTime || new Date().toISOString(),
          subject: graphEvent.subject || '(No Subject)',
          body_text: graphEvent.body?.content || '',
          metadata: {
            start_time: graphEvent.start?.dateTime,
            end_time: graphEvent.end?.dateTime,
            location: graphEvent.location?.displayName
          }
        };

        await supabaseService.upsertEvent(event);
        created++;
      } catch (error) {
        console.error('Error processing calendar event:', error);
      }
    }

    console.log(`Processed calendar events: ${created} created`);
    return { created, updated };
  }
}

export { CalendarProcessor };
export default new CalendarProcessor();
