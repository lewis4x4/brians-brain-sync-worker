// =====================================================
// Daily Brief Service - Resend Email + AI Summary
// =====================================================
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import OpenAI from 'openai';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const resend = new Resend(process.env.RESEND_API_KEY!);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

interface BriefSettings {
  id: string;
  user_id: string;
  is_enabled: boolean;
  delivery_time: string;
  include_email: boolean;
  include_calendar: boolean;
  include_telegram: boolean;
  include_tasks: boolean;
  max_items: number;
  summary_length: string;
  email_address: string;
}

interface BriefContent {
  emails: any[];
  calendarEvents: any[];
  telegramMessages: any[];
  tasks: any[];
}

export class BriefService {
  /**
   * Send daily brief for a specific user
   */
  async sendBrief(userId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      console.log(`📧 Generating daily brief for user ${userId}...`);

      // 1. Fetch user's daily brief settings
      const settings = await this.fetchBriefSettings(userId);

      if (!settings || !settings.is_enabled) {
        console.log('Daily brief is disabled or not configured');
        return { ok: false, error: settings ? 'disabled' : 'no_settings' };
      }

      // 2. Gather content based on settings
      const content = await this.gatherBriefContent(settings);

      // 3. Generate AI summary (NEW!)
      console.log('🤖 Generating AI summary...');
      const aiSummary = await this.generateAISummary(content, settings);

      // 4. Generate HTML email with AI summary
      const emailHtml = this.generateBriefEmail(content, settings, aiSummary);

      // 5. Send email via Resend
      await this.sendEmail(settings.email_address, emailHtml);

      // 6. Log that we sent it
      await this.logBriefSent(userId);

      console.log(`✅ Brief sent to ${settings.email_address}`);
      return { ok: true };
    } catch (error: any) {
      console.error('Error sending brief:', error);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Check all users and send briefs if it's time
   */
  async checkAndSendBriefs(): Promise<void> {
    const currentTime = new Date().toTimeString().slice(0, 5); // "HH:MM"
    console.log(`⏰ Checking for briefs to send at ${currentTime}...`);

    // Fetch all enabled settings that match current time
    const { data: settingsToSend } = await supabase
      .from('daily_brief_settings')
      .select('*')
      .eq('is_enabled', true)
      .eq('delivery_time', currentTime);

    if (settingsToSend && settingsToSend.length > 0) {
      console.log(`📬 Found ${settingsToSend.length} brief(s) to send`);

      for (const settings of settingsToSend) {
        await this.sendBrief(settings.user_id);
      }
    } else {
      console.log('No briefs scheduled for this time');
    }
  }

  /**
   * Fetch user's brief settings
   */
  private async fetchBriefSettings(userId: string): Promise<BriefSettings | null> {
    const { data, error } = await supabase
      .from('daily_brief_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Error fetching brief settings:', error);
      return null;
    }

    return data;
  }

  /**
   * Gather content for the brief
   */
  private async gatherBriefContent(settings: BriefSettings): Promise<BriefContent> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const content: BriefContent = {
      emails: [],
      calendarEvents: [],
      telegramMessages: [],
      tasks: [],
    };

    // Build event types filter
    const eventTypes: string[] = [];
    if (settings.include_email) eventTypes.push('email');
    if (settings.include_calendar) eventTypes.push('calendar');
    if (settings.include_telegram) eventTypes.push('telegram');

    if (eventTypes.length === 0) {
      return content;
    }

    // Fetch events from last 24 hours
    const { data: events, error } = await supabase
      .from('events')
      .select(`
        id,
        event_type,
        subject,
        body_text,
        created_at_ts,
        metadata,
        importance,
        projects
      `)
      .in('event_type', eventTypes)
      .gte('created_at_ts', twentyFourHoursAgo)
      .order('created_at_ts', { ascending: false })
      .limit(settings.max_items);

    if (error) {
      console.error('Error fetching events:', error);
    } else if (events) {
      // Separate by type
      content.emails = events.filter(e => e.event_type === 'email');
      content.calendarEvents = events.filter(e => e.event_type === 'calendar');
      content.telegramMessages = events.filter(e => e.event_type === 'telegram');
    }

    // Fetch open action items if enabled
    if (settings.include_tasks) {
      const { data: tasks } = await supabase
        .from('action_items')
        .select('*')
        .eq('status', 'open')
        .gte('created_at', twentyFourHoursAgo)
        .limit(10);

      if (tasks) content.tasks = tasks;
    }

    return content;
  }

  /**
   * Generate AI summary using OpenAI (NEW!)
   */
  private async generateAISummary(
    content: BriefContent, 
    settings: BriefSettings
  ): Promise<string> {
    try {
      // Prepare data for AI
      const summaryData = {
        date: new Date().toLocaleDateString(),
        totalItems: content.emails.length + content.calendarEvents.length + 
                    content.telegramMessages.length + content.tasks.length,
        emails: content.emails.map(e => ({
          subject: e.subject,
          from: e.metadata?.from,
          importance: e.importance,
          projects: e.projects,
          snippet: this.truncate(e.body_text, 200)
        })),
        calendarEvents: content.calendarEvents.map(e => ({
          title: e.subject,
          time: e.created_at_ts
        })),
        telegramMessages: content.telegramMessages.map(m => ({
          text: this.truncate(m.body_text, 150),
          time: m.created_at_ts
        })),
        tasks: content.tasks.map(t => ({
          text: t.text,
          owner: t.owner,
          due: t.due_date
        }))
      };

      // Determine detail level based on summary_length setting
      let detailInstruction = '';
      switch (settings.summary_length) {
        case 'short':
          detailInstruction = 'Keep it very concise - 3-4 bullet points maximum.';
          break;
        case 'long':
          detailInstruction = 'Provide comprehensive analysis with specific details.';
          break;
        default: // medium
          detailInstruction = 'Provide balanced detail - not too brief, not too long.';
      }

      // Call OpenAI
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // More cost-effective, still great quality
        messages: [
          {
            role: 'system',
            content: `You are an executive assistant creating daily briefs for a busy professional. 
Your job is to analyze their recent activity and provide an intelligent summary that highlights:
1. Top Priorities (most important/urgent items)
2. Key Themes (what they focused on)
3. Action Items (things needing attention)
4. Notable Highlights (important conversations or updates)

${detailInstruction}

Format your response as clean HTML with appropriate sections using <h3>, <ul>, <li>, <p> tags.
Use a professional but friendly tone. Be specific and actionable.`
          },
          {
            role: 'user',
            content: `Create an executive summary from this data:\n\n${JSON.stringify(summaryData, null, 2)}`
          }
        ],
        temperature: 0.7,
        max_tokens: settings.summary_length === 'short' ? 500 : 
                   settings.summary_length === 'long' ? 1500 : 1000
      });

      return completion.choices[0].message.content || 'Unable to generate summary.';
    } catch (error) {
      console.error('Error generating AI summary:', error);
      return '<p><em>AI summary unavailable. See detailed items below.</em></p>';
    }
  }

  /**
   * Generate HTML email with AI summary
   */
  private generateBriefEmail(
    content: BriefContent, 
    settings: BriefSettings,
    aiSummary: string
  ): string {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const totalItems = 
      content.emails.length + 
      content.calendarEvents.length + 
      content.telegramMessages.length + 
      content.tasks.length;

    let html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }
    .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; margin-top: 0; }
    h2 { color: #34495e; margin-top: 30px; font-size: 1.3em; }
    h3 { color: #2c3e50; margin-top: 20px; font-size: 1.1em; }
    .ai-summary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .ai-summary h3 { color: white; margin-top: 0; }
    .ai-summary ul { margin: 10px 0; padding-left: 20px; }
    .ai-summary li { margin: 8px 0; }
    .summary { background: #e8f4f8; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .event { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #3498db; }
    .email-event { border-left-color: #3498db; }
    .calendar-event { border-left-color: #9b59b6; }
    .telegram-event { border-left-color: #1abc9c; }
    .task-event { border-left-color: #e74c3c; }
    .subject { font-weight: bold; color: #2c3e50; font-size: 1.1em; }
    .meta { color: #7f8c8d; font-size: 0.9em; margin-top: 5px; }
    .snippet { margin-top: 10px; color: #555; }
    .importance { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 0.85em; font-weight: bold; }
    .importance-5 { background: #e74c3c; color: white; }
    .importance-4 { background: #f39c12; color: white; }
    .importance-3 { background: #3498db; color: white; }
    .projects { display: inline-block; padding: 2px 8px; background: #ecf0f1; color: #2c3e50; border-radius: 3px; font-size: 0.85em; margin-left: 5px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #7f8c8d; font-size: 0.9em; text-align: center; }
    .footer a { color: #3498db; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>☀️ Your Daily Brief</h1>
    <p style="font-size: 1.1em; color: #7f8c8d;"><strong>${today}</strong></p>
    
    <!-- AI EXECUTIVE SUMMARY (NEW!) -->
    <div class="ai-summary">
      <h3>🤖 AI Executive Summary</h3>
      ${aiSummary}
    </div>
    
    <div class="summary">
      <strong>📊 Activity Overview:</strong> ${totalItems} items from the last 24 hours
      ${content.emails.length > 0 ? `<br>📧 ${content.emails.length} emails` : ''}
      ${content.calendarEvents.length > 0 ? `<br>📅 ${content.calendarEvents.length} calendar events` : ''}
      ${content.telegramMessages.length > 0 ? `<br>💬 ${content.telegramMessages.length} messages` : ''}
      ${content.tasks.length > 0 ? `<br>✓ ${content.tasks.length} open tasks` : ''}
    </div>
`;

// Emails
    if (content.emails.length > 0) {
      html += '<h2>📧 Recent Emails</h2>';
      content.emails.forEach(email => {
        const importance = email.importance || 0;
        const projects = email.projects || [];
        
        let projectsHtml = '';
        if (projects.length > 0) {
          projectsHtml = projects.map((p: string) => '<span class="projects">' + this.escapeHtml(p) + '</span>').join('');
        }
        
        html += `
        <div class="event email-event">
          <div class="subject">${this.escapeHtml(email.subject || 'No Subject')}</div>
          <div class="meta">
            From: ${this.escapeHtml(email.metadata?.from || 'Unknown')} | 
            ${new Date(email.created_at_ts).toLocaleString()}
            ${importance > 0 ? '<span class="importance importance-' + importance + '">Priority ' + importance + '</span>' : ''}
            ${projectsHtml}
          </div>
          <div class="snippet">${this.truncate(this.escapeHtml(email.body_text), 150)}</div>
        </div>`;
      });
    }

    // Calendar Events
    if (content.calendarEvents.length > 0) {
      html += '<h2>📅 Calendar Events</h2>';
      content.calendarEvents.forEach(event => {
        html += `
        <div class="event calendar-event">
          <div class="subject">${this.escapeHtml(event.subject || 'No Title')}</div>
          <div class="meta">${new Date(event.created_at_ts).toLocaleString()}</div>
        </div>`;
      });
    }

    // Telegram Messages
    if (content.telegramMessages.length > 0) {
      html += '<h2>💬 Telegram Messages</h2>';
      content.telegramMessages.forEach(msg => {
        html += `
        <div class="event telegram-event">
          <div class="snippet">${this.truncate(this.escapeHtml(msg.body_text), 200)}</div>
          <div class="meta">${new Date(msg.created_at_ts).toLocaleString()}</div>
        </div>`;
      });
    }

    // Tasks
    if (content.tasks.length > 0) {
      html += '<h2>✓ Open Action Items</h2>';
      content.tasks.forEach(task => {
        html += `
        <div class="event task-event">
          <div class="subject">${this.escapeHtml(task.text)}</div>
          <div class="meta">Owner: ${this.escapeHtml(task.owner || 'Unassigned')} | Due: ${task.due_date || 'No date'}</div>
        </div>`;
      });
    }

    html += `
    <div class="footer">
      <p>You received this because you enabled Daily Brief in your AI Brain.</p>
      <p><a href="https://preview--brians-brain-nexus.lovable.app/daily-brief">Manage preferences</a></p>
      <p style="font-size: 0.85em; color: #95a5a6; margin-top: 10px;">
        Powered by AI | Summary generated by ChatGPT
      </p>
    </div>
  </div>
</body>
</html>`;

    return html;
  }

  /**
   * Send email via Resend
   */
  private async sendEmail(toEmail: string, htmlContent: string): Promise<void> {
    const subject = `Daily Brief - ${new Date().toLocaleDateString()}`;
    const fromEmail = process.env.BRIEF_FROM_EMAIL || 'onboarding@resend.dev';

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: subject,
      html: htmlContent,
    });

    if (error) {
      throw new Error(`Failed to send email: ${error.message}`);
    }

    console.log(`✅ Email sent via Resend:`, data);
  }

  /**
   * Log that brief was sent
   */
  private async logBriefSent(userId: string): Promise<void> {
    // Optional: Create a brief_logs table to track sends
    // For now, just log to console
    console.log(`📝 Brief logged for user ${userId} at ${new Date().toISOString()}`);
  }

  /**
   * Helper functions
   */
  private escapeHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private truncate(text: string, length: number): string {
    if (!text) return '';
    return text.length > length ? text.slice(0, length) + '...' : text;
  }
}

export default new BriefService();oHello. 
