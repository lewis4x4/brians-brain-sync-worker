import supabaseService from '../services/supabase.service';
import storageService from '../services/storage.service';
import extractionService from '../services/extraction.service';
import microsoftService from '../services/microsoft.service';
import RuleService from '../services/rule.service';

class EmailProcessor {
  private ruleService: RuleService;

  constructor() {
    this.ruleService = new RuleService();
  }

  async processMessages(messages: any[], accessToken: string) {
    let created = 0;
    let updated = 0;

    console.log(`Processing ${messages.length} emails...`);

    for (const message of messages) {
      try {
        const event = {
          user_id: '3ccb8364-da19-782e-b3fa-6ee4ed40820b',
          event_type: 'email',
          source: 'microsoft_graph',
          external_id: message.id,
          created_at_ts: message.receivedDateTime || new Date().toISOString(),
          subject: message.subject || '(No Subject)',
          body_text: message.bodyPreview || '',
          metadata: {
            from: message.from?.emailAddress?.address,
            is_read: message.isRead
          },
          raw: message
        };

        const eventId = await supabaseService.upsertEvent(event);
        created++;

        try {
          console.log(`  🎯 Applying rules to event ${eventId}...`);
          await this.ruleService.applyRulesToEvent(
            eventId,
            '3ccb8364-da19-782e-b3fa-6ee4ed40820b'
          );
          console.log(`  ✓ Rules applied`);
        } catch (ruleError: any) {
          console.error(`  ⚠️  Failed to apply rules:`, ruleError.message);
        }

        if (message.hasAttachments) {
          try {
            await this.processAttachments(message.id, eventId, accessToken);
          } catch (error: any) {
            console.error(`  ⚠️  Failed to process attachments for ${message.id}:`, error.message);
          }
        }
      } catch (error) {
        console.error('Error processing email:', error);
      }
    }

    console.log(`Processed emails: ${created} created`);
    return { created, updated };
  }

  private async processAttachments(messageId: string, eventId: string, accessToken: string): Promise<void> {
    const attachments = await microsoftService.fetchAttachments(messageId, accessToken);

    for (const attachment of attachments) {
      if (attachment.isInline) continue;

      try {
        const existingAttachment = await supabaseService.checkAttachmentExists(
          eventId,
          attachment.name
        );

        if (existingAttachment) {
          console.log(`  ⏭️  Skipping existing attachment: ${attachment.name}`);
          continue;
        }

        const content = await microsoftService.downloadAttachment(
          messageId,
          attachment.id,
          accessToken
        );

        const storagePath = await storageService.uploadAttachment(
          eventId,
          attachment.name,
          content,
          attachment.contentType
        );

        const extractedText = await extractionService.extractText(
          content,
          attachment.contentType,
          attachment.name
        );

        await supabaseService.createAttachment({
          event_id: eventId,
          filename: attachment.name,
          mime_type: attachment.contentType,
          byte_size: attachment.size,
          storage_url: storagePath,
          text_extract: extractedText || undefined
        });

        console.log(`  📎 Processed attachment: ${attachment.name} (${this.formatBytes(attachment.size)})`);
      } catch (error: any) {
        console.error(`  ⚠️  Failed to process attachment ${attachment.name}:`, error.message);
      }
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

export default new EmailProcessor();