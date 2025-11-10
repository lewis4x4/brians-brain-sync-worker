#!/bin/bash

# This script creates all the TypeScript source files

echo "Creating source files..."

# Types
cat > src/types/index.ts << 'ENDOFFILE'
export interface Connection {
  id: string;
  provider_key: string;
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  config: any;
  secret_ref: {
    access_token: string;
    refresh_token: string;
    expires_at: string;
    email: string;
  };
}

export interface GraphMessage {
  id: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  receivedDateTime?: string;
  sentDateTime?: string;
  conversationId?: string;
  internetMessageId?: string;
}

export interface GraphEvent {
  id: string;
  subject?: string;
  body?: { content?: string };
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  iCalUId?: string;
}
ENDOFFILE

echo "✓ Created types"
echo "All basic files created!"
echo "Now run: npm install"
