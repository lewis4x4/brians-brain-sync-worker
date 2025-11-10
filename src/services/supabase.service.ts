import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

class SupabaseService {
  private supabase = supabase;

  async getConnection(id: string) {
    const { data, error } = await supabase
      .from('integration_connections')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) console.error('Error getting connection:', error);
    return data;
  }

  async getActiveConnections() {
    const { data, error } = await supabase
      .from('integration_connections')
      .select('*')
      .eq('status', 'connected')
      .eq('provider_key', 'microsoft_365');
    
    if (error) console.error('Error getting connections:', error);
    return data || [];
  }

  async updateConnectionTokens(id: string, tokens: any) {
    const { error } = await supabase
      .from('integration_connections')
      .update({ secret_ref: tokens })
      .eq('id', id);
    
    if (error) console.error('Error updating tokens:', error);
  }

  async createIngestionRun(connectionId: string) {
    const { data, error } = await supabase
      .from('ingestion_runs')
      .insert({
        connection_id: connectionId,
        status: 'running',
        started_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating ingestion run:', error);
      throw new Error('Failed to create ingestion run: ' + error.message);
    }
    
    if (!data || !data.id) {
      throw new Error('No data returned from ingestion run insert');
    }
    
    return data.id;
  }

  async completeIngestionRun(runId: string, stats: any) {
    const { error } = await supabase
      .from('ingestion_runs')
      .update({
        status: 'success',
        finished_at: new Date().toISOString()
      })
      .eq('id', runId);
    
    if (error) console.error('Error completing ingestion run:', error);
  }

  async failIngestionRun(runId: string, errorMessage: string) {
    const { error } = await supabase
      .from('ingestion_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: errorMessage
      })
      .eq('id', runId);
    
    if (error) console.error('Error failing ingestion run:', error);
  }

  async upsertEvent(event: any) {
    // First, try to find existing event by external_id
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('external_id', event.external_id)
      .maybeSingle();
    
    if (existing) {
      // Update existing event
      const { data, error } = await supabase
        .from('events')
        .update(event)
        .eq('id', existing.id)
        .select('id')
        .single();
      
      if (error) {
        console.error('Error updating event:', error);
        throw error;
      }
      
      return data.id;
    } else {
      // Insert new event
      const { data, error } = await supabase
        .from('events')
        .insert(event)
        .select('id')
        .single();
      
      if (error) {
        console.error('Error inserting event:', error);
        throw error;
      }
      
      return data.id;
    }
  }

  async checkAttachmentExists(eventId: string, filename: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('attachments')
      .select('id')
      .eq('event_id', eventId)
      .eq('filename', filename)
      .maybeSingle();

    if (error) {
      console.error('Error checking attachment:', error);
      return false;
    }

    return !!data;
  }

  async createAttachment(attachment: {
    event_id: string;
    filename: string;
    mime_type: string;
    byte_size: number;
    storage_url: string;
    text_extract?: string;
  }): Promise<void> {
    const { error } = await this.supabase
      .from('attachments')
      .insert(attachment);

    if (error) {
      throw new Error(`Failed to create attachment: ${error.message}`);
    }
  }
}

export { SupabaseService };
export default new SupabaseService();