const pdf = require('pdf-parse');
import mammoth from 'mammoth';

class ExtractionService {
  async extractText(buffer: Buffer, mimeType: string, filename: string): Promise<string | null> {
    try {
      // PDF extraction
      if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
        const data = await pdf(buffer);
        return data.text;
      }

      // Word document extraction
      if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        filename.endsWith('.docx')
      ) {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      }

      // Plain text files
      if (mimeType?.startsWith('text/') || filename.endsWith('.txt')) {
        return buffer.toString('utf-8');
      }

      // For other types, return null (no extraction)
      return null;
    } catch (error: any) {
      console.error(`Failed to extract text from ${filename}:`, error.message);
      return null;
    }
  }
}

export class ExtractionServiceClass extends ExtractionService {}
export default new ExtractionService();