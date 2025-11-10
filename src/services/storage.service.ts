import { createClient } from '@supabase/supabase-js';

class StorageService {
  private supabase;
  private bucketName = 'brain-attachments';

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  async uploadAttachment(
    eventId: string,
    filename: string,
    content: Buffer,
    mimeType: string
  ): Promise<string> {
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `${eventId}/${sanitizedFilename}`;

    const { error } = await this.supabase.storage
      .from(this.bucketName)
      .upload(storagePath, content, {
        contentType: mimeType,
        upsert: true
      });

    if (error) {
      throw new Error(`Failed to upload attachment: ${error.message}`);
    }

    return storagePath;
  }

  async getSignedUrl(storagePath: string, expiresIn = 3600): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(this.bucketName)
      .createSignedUrl(storagePath, expiresIn);

    if (error) {
      throw new Error(`Failed to get signed URL: ${error.message}`);
    }

    return data.signedUrl;
  }

  async deleteAttachment(storagePath: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucketName)
      .remove([storagePath]);

    if (error) {
      throw new Error(`Failed to delete attachment: ${error.message}`);
    }
  }
}

export class StorageServiceClass extends StorageService {}
export default new StorageService();
