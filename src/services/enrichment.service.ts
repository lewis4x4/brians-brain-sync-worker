// =====================================================
// Enrichment Service - Auto-Tagging & Categorization
// =====================================================
// Automatically enriches events with semantic tags for
// better AI search and retrieval.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =====================================================
// Configuration
// =====================================================

const VIP_DOMAINS = [
  'goredex.com',
  'lewisinsurance.com'
];

// Patterns for content type detection
const CONTENT_TYPE_PATTERNS = {
  newsletter: {
    from: ['newsletter', 'digest', 'weekly', 'daily', 'noreply', 'no-reply', 'marketing', 'news@', 'updates@'],
    subject: ['newsletter', 'digest', 'weekly update', 'daily briefing', 'this week in'],
    body: ['unsubscribe', 'view in browser', 'email preferences', 'opt out']
  },
  receipt: {
    subject: ['receipt', 'order confirmation', 'payment confirmation', 'invoice #', 'your order', 'purchase confirmation'],
    body: ['total:', 'amount charged', 'order number', 'transaction id', 'billing']
  },
  shipping: {
    subject: ['shipped', 'delivery', 'tracking', 'out for delivery', 'delivered', 'package'],
    body: ['tracking number', 'estimated delivery', 'carrier:', 'shipment']
  },
  alert: {
    from: ['alert', 'notification', 'system', 'security', 'admin'],
    subject: ['alert:', 'warning:', 'action required', 'security notice', 'important:'],
    body: ['suspicious activity', 'password reset', 'verify your']
  },
  'meeting-invite': {
    subject: ['invitation:', 'invite:', 'meeting request', 'calendar invite'],
    body: ['join meeting', 'dial-in', 'conference', 'zoom.us', 'teams.microsoft', 'meet.google']
  },
  'meeting-notes': {
    subject: ['meeting notes', 'meeting summary', 'recap:', 'follow-up:', 'action items from'],
    body: ['action items', 'next steps', 'attendees:', 'discussed:']
  }
};

// Patterns for topic classification
const TOPIC_PATTERNS = {
  finance: {
    keywords: ['invoice', 'payment', 'budget', 'expense', 'revenue', 'cost', 'price', 'quote',
               'proposal', 'billing', 'payroll', 'tax', 'accounting', 'financial', '$', 'dollars']
  },
  travel: {
    keywords: ['flight', 'hotel', 'reservation', 'itinerary', 'booking', 'airport', 'travel',
               'airline', 'boarding pass', 'check-in', 'rental car', 'trip']
  },
  legal: {
    keywords: ['contract', 'agreement', 'terms', 'nda', 'legal', 'compliance', 'policy',
               'signature required', 'docusign', 'liability', 'confidential']
  },
  health: {
    keywords: ['appointment', 'doctor', 'medical', 'health', 'prescription', 'pharmacy',
               'insurance claim', 'wellness', 'healthcare']
  },
  scheduling: {
    keywords: ['reschedule', 'availability', 'calendar', 'schedule', 'meeting time',
               'when are you', 'free to meet', 'book a time', 'slot']
  },
  support: {
    keywords: ['ticket #', 'case #', 'support request', 'help desk', 'customer service',
               'issue resolved', 'we received your', 'thank you for contacting']
  }
};

// Patterns for action detection
const ACTION_PATTERNS = {
  'reply-needed': {
    keywords: ['please reply', 'let me know', 'get back to me', 'your thoughts?', 'what do you think',
               'can you confirm', 'please respond', 'awaiting your', 'need your input', 'rsvp',
               'please advise', 'your feedback', '?']
  },
  'review-needed': {
    keywords: ['please review', 'for your review', 'take a look', 'need approval', 'sign off',
               'approve this', 'review attached', 'feedback needed', 'comments welcome']
  },
  deadline: {
    keywords: ['deadline', 'due by', 'due date', 'by eod', 'by end of day', 'asap', 'urgent',
               'time sensitive', 'expires', 'last chance', 'final notice', 'immediately']
  }
};

// =====================================================
// Types
// =====================================================

interface EnrichmentResult {
  tags: string[];
  entities: {
    people: string[];
    companies: string[];
    amounts: string[];
    dates: string[];
  };
  category: string | null;
  topics: string[];
  actions: string[];
  senderType: string;
  isVip: boolean;
}

interface EventData {
  id: string;
  event_type: string;
  subject?: string;
  body_text?: string;
  metadata?: {
    from?: string;
    from_name?: string;
    to?: string[];
    organizer?: string;
    attendees?: any[];
  };
}

// =====================================================
// Main Service
// =====================================================

export class EnrichmentService {

  /**
   * Enrich a single event with auto-generated tags and metadata
   */
  async enrichEvent(eventId: string): Promise<EnrichmentResult | null> {
    try {
      // Fetch the event
      const { data: event, error } = await supabase
        .from('events')
        .select('id, event_type, subject, body_text, metadata')
        .eq('id', eventId)
        .single();

      if (error || !event) {
        console.error('[ENRICHMENT] Failed to fetch event:', error);
        return null;
      }

      // Run enrichment
      const result = this.analyzeEvent(event);

      // Apply tags to event
      await this.applyEnrichment(eventId, result);

      console.log(`[ENRICHMENT] Enriched event ${eventId}:`, {
        category: result.category,
        topics: result.topics,
        actions: result.actions,
        isVip: result.isVip,
        tagCount: result.tags.length
      });

      return result;

    } catch (err) {
      console.error('[ENRICHMENT] Error enriching event:', err);
      return null;
    }
  }

  /**
   * Analyze event and generate enrichment data
   */
  private analyzeEvent(event: EventData): EnrichmentResult {
    const subject = (event.subject || '').toLowerCase();
    const body = (event.body_text || '').toLowerCase();
    const from = (event.metadata?.from || event.metadata?.organizer || '').toLowerCase();
    const combinedText = `${subject} ${body}`;

    const tags: string[] = [];
    const topics: string[] = [];
    const actions: string[] = [];

    // 1. Detect content category
    const category = this.detectCategory(from, subject, body, event.event_type);
    if (category) {
      tags.push(`category:${category}`);
    }

    // 2. Detect topics
    for (const [topic, patterns] of Object.entries(TOPIC_PATTERNS)) {
      if (this.matchesKeywords(combinedText, patterns.keywords)) {
        topics.push(topic);
        tags.push(`topic:${topic}`);
      }
    }

    // 3. Detect required actions
    for (const [action, patterns] of Object.entries(ACTION_PATTERNS)) {
      if (this.matchesKeywords(combinedText, patterns.keywords)) {
        actions.push(action);
        tags.push(`action:${action}`);
      }
    }

    // If no actions detected, mark as no action needed
    if (actions.length === 0 && category !== 'meeting-invite') {
      tags.push('action:none');
    }

    // 4. Detect sender type
    const { senderType, isVip } = this.analyzeSender(from);
    tags.push(`sender:${senderType}`);
    if (isVip) {
      tags.push('sender:vip');
    }

    // 5. Extract entities
    const entities = this.extractEntities(event.subject || '', event.body_text || '');

    return {
      tags,
      entities,
      category,
      topics,
      actions,
      senderType,
      isVip
    };
  }

  /**
   * Detect content category based on patterns
   */
  private detectCategory(from: string, subject: string, body: string, eventType: string): string | null {
    // Calendar events are meetings by default
    if (eventType === 'meeting') {
      return 'meeting';
    }

    // Check each category's patterns
    for (const [category, patterns] of Object.entries(CONTENT_TYPE_PATTERNS)) {
      let score = 0;

      if (patterns.from && this.matchesKeywords(from, patterns.from)) {
        score += 2;
      }
      if (patterns.subject && this.matchesKeywords(subject, patterns.subject)) {
        score += 2;
      }
      if (patterns.body && this.matchesKeywords(body, patterns.body)) {
        score += 1;
      }

      if (score >= 2) {
        return category;
      }
    }

    // Default categories based on simple heuristics
    if (this.looksLikeActionItem(subject, body)) {
      return 'action-item';
    }

    return 'fyi'; // Default to informational
  }

  /**
   * Check if content looks like it requires action
   */
  private looksLikeActionItem(subject: string, body: string): boolean {
    const actionIndicators = [
      'action required', 'action needed', 'please', 'could you', 'can you',
      'need you to', 'would you', 'your turn', 'assigned to you'
    ];
    const combined = `${subject} ${body}`.toLowerCase();
    return actionIndicators.some(indicator => combined.includes(indicator));
  }

  /**
   * Analyze sender to determine type and VIP status
   */
  private analyzeSender(from: string): { senderType: string; isVip: boolean } {
    // Check VIP domains
    const isVip = VIP_DOMAINS.some(domain => from.includes(domain.toLowerCase()));

    // Detect automated senders
    const automatedPatterns = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon',
                               'notifications@', 'alerts@', 'system@', 'auto@'];
    if (automatedPatterns.some(p => from.includes(p))) {
      return { senderType: 'automated', isVip: false };
    }

    // Could add internal domain detection here if configured
    // For now, mark as external by default
    return { senderType: 'external', isVip };
  }

  /**
   * Check if text matches any keywords
   */
  private matchesKeywords(text: string, keywords: string[]): boolean {
    return keywords.some(keyword => text.includes(keyword.toLowerCase()));
  }

  /**
   * Extract named entities from text
   */
  private extractEntities(subject: string, body: string): EnrichmentResult['entities'] {
    const fullText = `${subject} ${body}`;

    return {
      people: this.extractPeople(fullText),
      companies: this.extractCompanies(fullText),
      amounts: this.extractAmounts(fullText),
      dates: this.extractDates(fullText)
    };
  }

  /**
   * Extract potential person names (basic heuristic)
   */
  private extractPeople(text: string): string[] {
    const people: string[] = [];

    // Look for common name patterns
    // "Hi [Name]", "Dear [Name]", "Thanks, [Name]", "From: [Name]"
    const greetingPatterns = [
      /(?:hi|hello|dear|hey)\s+([A-Z][a-z]+)/gi,
      /(?:thanks|regards|best),?\s*\n?\s*([A-Z][a-z]+)/gi,
      /(?:from|to|cc):\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/gi
    ];

    for (const pattern of greetingPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 2) {
          people.push(match[1].trim());
        }
      }
    }

    return [...new Set(people)].slice(0, 10); // Dedupe and limit
  }

  /**
   * Extract company names (basic heuristic)
   */
  private extractCompanies(text: string): string[] {
    const companies: string[] = [];

    // Look for common company indicators
    const companyPatterns = [
      /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(?:Inc|LLC|Corp|Ltd|Company|Co\.|Group|Holdings)/gi,
      /(?:at|from|with)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g
    ];

    for (const pattern of companyPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 2) {
          companies.push(match[1].trim());
        }
      }
    }

    // Also check for known VIP companies
    if (text.toLowerCase().includes('goredex') || text.toLowerCase().includes('redex')) {
      companies.push('GoRedex');
    }
    if (text.toLowerCase().includes('lewis insurance')) {
      companies.push('Lewis Insurance');
    }

    return [...new Set(companies)].slice(0, 10);
  }

  /**
   * Extract monetary amounts
   */
  private extractAmounts(text: string): string[] {
    const amounts: string[] = [];

    // Match currency patterns
    const amountPattern = /\$[\d,]+(?:\.\d{2})?|\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:dollars|USD)/gi;
    const matches = text.matchAll(amountPattern);

    for (const match of matches) {
      amounts.push(match[0]);
    }

    return [...new Set(amounts)].slice(0, 10);
  }

  /**
   * Extract date references
   */
  private extractDates(text: string): string[] {
    const dates: string[] = [];

    // Match various date patterns
    const datePatterns = [
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?\b/gi,
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
      /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi,
      /\b(?:today|tomorrow|next week|this week|end of day|eod|asap)\b/gi
    ];

    for (const pattern of datePatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        dates.push(match[0]);
      }
    }

    return [...new Set(dates)].slice(0, 10);
  }

  /**
   * Apply enrichment results to the event in the database
   */
  private async applyEnrichment(eventId: string, result: EnrichmentResult): Promise<void> {
    try {
      // Get existing event data
      const { data: event } = await supabase
        .from('events')
        .select('metadata')
        .eq('id', eventId)
        .single();

      // Merge enrichment into metadata
      const enrichedMetadata = {
        ...event?.metadata,
        enrichment: {
          category: result.category,
          topics: result.topics,
          actions: result.actions,
          senderType: result.senderType,
          isVip: result.isVip,
          entities: result.entities,
          enrichedAt: new Date().toISOString()
        }
      };

      // Update event metadata
      await supabase
        .from('events')
        .update({ metadata: enrichedMetadata })
        .eq('id', eventId);

      // Add tags via event_tags junction table
      for (const tagName of result.tags) {
        await this.ensureTagExists(tagName, eventId);
      }

    } catch (err) {
      console.error('[ENRICHMENT] Failed to apply enrichment:', err);
    }
  }

  /**
   * Ensure a tag exists and is linked to the event
   */
  private async ensureTagExists(tagName: string, eventId: string): Promise<void> {
    try {
      // Get or create tag
      let { data: tag } = await supabase
        .from('tags')
        .select('id')
        .eq('name', tagName)
        .single();

      if (!tag) {
        const { data: newTag, error } = await supabase
          .from('tags')
          .insert({ name: tagName })
          .select('id')
          .single();

        if (error) {
          // Tag might already exist due to race condition
          const { data: existingTag } = await supabase
            .from('tags')
            .select('id')
            .eq('name', tagName)
            .single();
          tag = existingTag;
        } else {
          tag = newTag;
        }
      }

      if (!tag) return;

      // Link tag to event (ignore duplicates)
      await supabase
        .from('event_tags')
        .insert({ event_id: eventId, tag_id: tag.id })
        .select()
        .single();

    } catch (err) {
      // Ignore duplicate key errors
      if (!(err as any)?.message?.includes('duplicate')) {
        console.error('[ENRICHMENT] Tag error:', err);
      }
    }
  }

  /**
   * Bulk enrich multiple events (useful for backfilling)
   */
  async enrichMultipleEvents(eventIds: string[]): Promise<void> {
    console.log(`[ENRICHMENT] Enriching ${eventIds.length} events...`);

    for (const eventId of eventIds) {
      await this.enrichEvent(eventId);
    }

    console.log('[ENRICHMENT] Bulk enrichment complete');
  }

  /**
   * Backfill enrichment for all events without enrichment data
   */
  async backfillEnrichment(limit: number = 100): Promise<number> {
    console.log(`[ENRICHMENT] Starting backfill (limit: ${limit})...`);

    // Find events without enrichment
    const { data: events, error } = await supabase
      .from('events')
      .select('id')
      .is('metadata->enrichment', null)
      .limit(limit);

    if (error || !events) {
      console.error('[ENRICHMENT] Backfill query failed:', error);
      return 0;
    }

    console.log(`[ENRICHMENT] Found ${events.length} events to enrich`);

    for (const event of events) {
      await this.enrichEvent(event.id);
    }

    console.log(`[ENRICHMENT] Backfill complete: ${events.length} events enriched`);
    return events.length;
  }
}

export default EnrichmentService;
