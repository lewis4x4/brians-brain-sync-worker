// =====================================================
// Rule Service - Final Working Version
// =====================================================
// This version works with your actual schema:
// - tags table: (id, name) - simple!
// - events.projects: ARRAY column
// - events.importance: smallint column
// - NO user_id in events (phantom column avoided)

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface Rule {
  id: string;
  name: string;
  match_field: string;
  match_operator: string;
  match_values: string[];
  add_tags: string[];
  add_projects: string[];
  set_importance?: number;
  priority: number;
}

interface Event {
  id: string;
  subject?: string;
  body_text?: string;
  metadata?: any;
  projects?: string[];
  importance?: number;
}

export class RuleService {
  /**
   * Apply all active rules to a newly ingested event
   */
  async applyRulesToEvent(eventId: string, userId: string): Promise<void> {
    try {
      // 1. Fetch the event (without user_id - phantom column issue)
      const { data: event, error: eventError } = await supabase
        .from('events')
        .select('id, subject, body_text, metadata, projects, importance')
        .eq('id', eventId)
        .single();

      if (eventError || !event) {
        console.error('Failed to fetch event:', eventError);
        return;
      }

      // 2. Fetch active rules for this user (ordered by priority)
      const { data: rules, error: rulesError } = await supabase
        .from('rules')
        .select('*')
        .eq('user_id', userId)
        .eq('is_enabled', true)
        .order('priority', { ascending: false });

      if (rulesError) {
        console.error('Failed to fetch rules:', rulesError);
        return;
      }

      if (!rules || rules.length === 0) {
        console.log('No active rules to apply');
        return;
      }

      console.log(`Found ${rules.length} active rules to check`);

      // 3. Process each rule
      for (const rule of rules) {
        const matches = this.evaluateRule(rule, event);
        
        if (matches) {
          console.log(`✓ Rule "${rule.name}" matched event ${eventId}`);
          await this.executeRuleAction(rule, event, userId);
        }
      }
    } catch (error) {
      console.error('Error applying rules:', error);
    }
  }

  /**
   * Evaluate if a rule matches an event
   */
  private evaluateRule(rule: Rule, event: Event): boolean {
    let fieldValue: string;

    switch (rule.match_field) {
      case 'subject':
        fieldValue = event.subject || '';
        break;
      case 'body_text':
        fieldValue = event.body_text || '';
        break;
      case 'from':
        fieldValue = event.metadata?.from || '';
        break;
      case 'to':
        fieldValue = event.metadata?.to || '';
        break;
      case 'any':
        fieldValue = [
          event.subject || '',
          event.body_text || '',
          event.metadata?.from || '',
          event.metadata?.to || ''
        ].join(' ');
        break;
      default:
        return false;
    }

    fieldValue = fieldValue.toLowerCase();
    const matchValues = rule.match_values.map(v => v.toLowerCase());

    switch (rule.match_operator) {
      case 'contains_any':
        return matchValues.some(value => fieldValue.includes(value));
      case 'contains':
        return matchValues.every(value => fieldValue.includes(value));
      case 'equals':
        return matchValues.some(value => fieldValue === value);
      case 'starts_with':
        return matchValues.some(value => fieldValue.startsWith(value));
      case 'ends_with':
        return matchValues.some(value => fieldValue.endsWith(value));
      case 'from_domain':
        return matchValues.some(domain => fieldValue.includes(domain));
      default:
        return false;
    }
  }

  /**
   * Execute the action defined by the rule
   */
  private async executeRuleAction(rule: Rule, event: Event, userId: string): Promise<void> {
    try {
      // Add all tags
      if (rule.add_tags && rule.add_tags.length > 0) {
        for (const tagName of rule.add_tags) {
          await this.addTagToEvent(event.id, userId, tagName);
        }
      }

      // Add all projects to the projects array
      if (rule.add_projects && rule.add_projects.length > 0) {
        await this.addProjectsToEvent(event.id, event.projects || [], rule.add_projects);
      }

      // Set importance
      if (rule.set_importance && rule.set_importance !== event.importance) {
        await this.setEventImportance(event.id, rule.set_importance);
      }

      // Increment match count on the rule
      await supabase
        .from('rules')
        .update({ 
          match_count: supabase.raw('COALESCE(match_count, 0) + 1'),
          last_matched_at: new Date().toISOString()
        })
        .eq('id', rule.id);

    } catch (error) {
      console.error(`Failed to execute action for rule ${rule.id}:`, error);
    }
  }

  /**
   * Add a tag to an event
   * Works with simple tags table: (id, name)
   */
  private async addTagToEvent(eventId: string, userId: string, tagName: string): Promise<void> {
    try {
      // Get or create the tag
      let tagId: string;

      const { data: existingTag } = await supabase
        .from('tags')
        .select('id')
        .eq('name', tagName)
        .single();

      if (existingTag) {
        tagId = existingTag.id;
      } else {
        // Create new tag (just name - your table has no color or user_id)
        const { data: newTag, error } = await supabase
          .from('tags')
          .insert({ name: tagName })
          .select('id')
          .single();

        if (error || !newTag) {
          console.error('Failed to create tag:', error);
          return;
        }
        tagId = newTag.id;
      }

      // Link tag to event via event_tags junction table
      const { error } = await supabase
        .from('event_tags')
        .insert({ event_id: eventId, tag_id: tagId })
        .select()
        .single();

      if (error && !error.message.includes('duplicate')) {
        console.error('Failed to link tag to event:', error);
      } else if (!error) {
        console.log(`  → Added tag "${tagName}"`);
      }
    } catch (error) {
      console.error('Error adding tag:', error);
    }
  }

  /**
   * Add projects to the events.projects array
   * Works with your existing ARRAY column
   */
  private async addProjectsToEvent(
    eventId: string, 
    existingProjects: string[], 
    newProjects: string[]
  ): Promise<void> {
    try {
      // Merge projects (avoid duplicates)
      const mergedProjects = Array.from(new Set([...existingProjects, ...newProjects]));

      const { error } = await supabase
        .from('events')
        .update({ projects: mergedProjects })
        .eq('id', eventId);

      if (error) {
        console.error('Failed to add projects to event:', error);
      } else {
        console.log(`  → Added projects: ${newProjects.join(', ')}`);
      }
    } catch (error) {
      console.error('Error adding projects:', error);
    }
  }

  /**
   * Set importance level on an event
   * Works with your existing importance column
   */
  private async setEventImportance(eventId: string, importance: number): Promise<void> {
    try {
      const { error } = await supabase
        .from('events')
        .update({ importance })
        .eq('id', eventId);

      if (error) {
        console.error('Failed to set event importance:', error);
      } else {
        console.log(`  → Set importance: ${importance}`);
      }
    } catch (error) {
      console.error('Error setting importance:', error);
    }
  }

  /**
   * Bulk apply rules to multiple events (useful for backfilling)
   */
  async applyRulesToMultipleEvents(eventIds: string[], userId: string): Promise<void> {
    console.log(`Applying rules to ${eventIds.length} events...`);
    
    for (const eventId of eventIds) {
      await this.applyRulesToEvent(eventId, userId);
    }
    
    console.log('✓ Bulk rule application complete');
  }
}

export default RuleService;
