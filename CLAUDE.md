# CLAUDE.md - Brian's Brain Sync Worker

## Project Overview

This is a **sync worker service** for "Brian's AI Brain" - a personal productivity platform that syncs Microsoft 365 data (emails and calendar events) to Supabase and generates AI-powered daily brief emails.

**Core functionality:**
- Syncs emails and calendar events from Microsoft Graph API using delta queries (incremental sync)
- Stores data in Supabase database with duplicate prevention
- Generates and sends daily brief emails with AI (OpenAI GPT-4o-mini) summaries
- Handles OAuth authentication flow for Microsoft 365
- Runs scheduled background sync jobs every 5 minutes

## Tech Stack

- **Runtime:** Node.js with TypeScript
- **Framework:** Express.js
- **Database:** Supabase (PostgreSQL)
- **External APIs:** Microsoft Graph API, OpenAI API, Resend (email)
- **Scheduling:** node-cron
- **Logging:** Winston
- **Document Processing:** pdf-parse, mammoth (Word docs)

## Project Structure

```
src/
├── index.ts              # Express app entry point, starts server and schedulers
├── routes/
│   ├── oauth.ts          # Microsoft OAuth token exchange
│   ├── health.ts         # Health check endpoints
│   └── sync.ts           # Manual sync trigger endpoint
├── services/
│   ├── microsoft.service.ts   # Microsoft Graph API client (delta sync)
│   ├── supabase.service.ts    # Database operations
│   ├── token.service.ts       # OAuth token management and refresh
│   ├── brief.service.ts       # Daily brief generation and email
│   ├── storage.service.ts     # Supabase storage for attachments
│   └── extraction.service.ts  # PDF/Word text extraction
├── processors/
│   ├── email.processor.ts     # Email message processing
│   └── calendar.processor.ts  # Calendar event processing
└── utils/
    ├── scheduler.ts      # Cron job for automatic sync
    └── logger.ts         # Winston logger configuration
```

## Quick Commands

```bash
# Development (hot reload)
npm run dev

# Build TypeScript
npm run build

# Production start
npm start
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info and available endpoints |
| GET | `/health` | Health check with uptime |
| POST | `/sync/:connectionId` | Trigger manual sync for a connection |
| POST | `/brief/send/:userId` | Manually trigger daily brief email |
| GET | `/brief/preview/:userId` | Preview brief (not fully implemented) |
| GET | `/oauth/microsoft/authorize-url` | Get Microsoft OAuth URL |
| POST | `/oauth/microsoft/exchange` | Exchange auth code for tokens |

## Database Schema (Supabase Tables)

### Core Tables

- **`integration_connections`** - OAuth connections to Microsoft 365
  - `id`, `provider_key`, `name`, `status`, `secret_ref` (JSON with tokens), `config` (JSON with email, scopes)

- **`events`** - Synced emails and calendar events
  - `id`, `user_id`, `event_type` ('email' | 'meeting'), `source`, `external_id`, `subject`, `body_text`, `created_at_ts`, `metadata` (JSON), `raw` (JSON)

- **`sync_state`** - Delta sync state tracking
  - `user_id`, `service`, `account_email`, `resource_type`, `delta_link`, `last_sync_at`
  - Composite key: `(user_id, service, account_email, resource_type)`

- **`ingestion_runs`** - Sync job tracking
  - `id`, `connection_id`, `status`, `started_at`, `finished_at`, `error_message`

- **`attachments`** - Email attachment metadata
  - `id`, `event_id`, `filename`, `mime_type`, `byte_size`, `storage_url`, `text_extract`

- **`daily_brief_settings`** - User brief preferences
  - `user_id`, `is_enabled`, `delivery_time`, `include_email`, `include_calendar`, `include_telegram`, `include_tasks`, `max_items`, `summary_length`, `email_address`

- **`duplicate_prevention_log`** - Tracks prevented duplicates

- **`action_items`** - Tasks extracted from content

## Environment Variables

Required in `.env`:

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Microsoft OAuth
MICROSOFT_CLIENT_ID=xxx
MICROSOFT_CLIENT_SECRET=xxx
MICROSOFT_TENANT_ID=xxx
MICROSOFT_REDIRECT_URI=https://your-app/oauth/callback

# OpenAI (for daily brief summaries)
OPENAI_API_KEY=sk-xxx

# Resend (email delivery)
RESEND_API_KEY=re_xxx
BRIEF_FROM_EMAIL=brief@yourdomain.com

# Optional
PORT=3000
SYNC_INTERVAL_MINUTES=5
```

## Key Architecture Patterns

### Delta Sync (Incremental Sync)

The Microsoft service uses **delta queries** for efficient syncing:
1. First sync: Fetches all data with date filter, stores delta link
2. Subsequent syncs: Uses stored delta link to fetch only changes
3. Delta links stored in `sync_state` table per account/resource type
4. Invalid delta links (HTTP 410) trigger automatic reset

Location: `src/services/microsoft.service.ts`

### Duplicate Prevention

Both email and calendar processors check for duplicates before insertion:
- **Emails:** Check by `external_id` (internetMessageId)
- **Calendar:** Check by `iCalUId` in the `raw` JSON field
- Duplicates are logged to `duplicate_prevention_log` table

### Token Management

- Tokens stored as JSON in `secret_ref` column (not encrypted columns)
- `TokenService.ensureValidToken()` checks expiry and auto-refreshes
- Tokens refreshed when within 5 minutes of expiry

### Scheduled Jobs

1. **Microsoft 365 Sync:** Every 5 minutes (configurable via `SYNC_INTERVAL_MINUTES`)
2. **Daily Brief Check:** Hourly, sends briefs matching current time

## Important Code Conventions

### Static Processor Methods

Processors use **static methods**, not instance methods:
```typescript
// Correct
await EmailProcessor.processMessages(messages, connectionId);
await CalendarProcessor.processEvents(events);

// Incorrect (would fail)
const processor = new EmailProcessor();
await processor.processMessages(...);
```

### Connection Config Structure

Connection email is stored in `config.email`, not `account_email`:
```typescript
// Correct
const email = connection.config?.email;

// Incorrect
const email = connection.account_email;  // Does not exist
```

### User ID

The system currently uses a hardcoded user ID in several places:
```typescript
const USER_ID = '3ccb8364-da19-482e-b3fa-6ee4ed40820b';
```

## Common Development Tasks

### Adding a New Sync Source

1. Create processor in `src/processors/`
2. Add fetch method to `microsoft.service.ts` (or new service)
3. Update `scheduler.ts` to call the new sync
4. Add delta link handling in `sync_state` table

### Modifying Daily Brief

- Content gathering: `brief.service.ts` → `gatherBriefContent()`
- AI prompt: `brief.service.ts` → `generateAISummary()`
- Email HTML: `brief.service.ts` → `generateBriefEmail()`

### Adding New API Endpoint

1. Create route file in `src/routes/`
2. Register in `src/index.ts` with `app.use()`

## Deployment

Configured for **Render** deployment (see `render.yaml`):
- Build: `npm install && npm run build`
- Start: `npm start`
- Environment variables configured in Render dashboard

## Troubleshooting

### Delta sync errors
If delta link becomes invalid (error 410 or delta-related error), the service automatically deletes the stored delta link to trigger a fresh sync.

### Token refresh failures
Check that `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` are correct. The refresh endpoint uses `/common/` tenant, not a specific tenant ID.

### Emails not syncing
1. Verify `integration_connections` has `status: 'connected'`
2. Check `config.email` field exists
3. Review `ingestion_runs` for error messages

## File Reference

| File | Purpose |
|------|---------|
| `src/index.ts` | Express app setup, route registration, scheduler start |
| `src/services/microsoft.service.ts` | Microsoft Graph API delta sync |
| `src/services/token.service.ts` | OAuth token storage/refresh |
| `src/services/brief.service.ts` | Daily brief with AI summary |
| `src/processors/email.processor.ts` | Email deduplication and storage |
| `src/processors/calendar.processor.ts` | Calendar event deduplication and storage |
| `src/utils/scheduler.ts` | Cron job configuration |
