// ================================================================
// OAuth Callback Handler - Add to sync-worker
// Location: ~/Desktop/sync-worker/src/routes/oauth.ts
// ================================================================

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// Microsoft OAuth config from environment
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID!;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET!;
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID!;
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Encryption key (same as token.service.ts)
const ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update(SUPABASE_SERVICE_KEY.slice(0, 32))
  .digest();

/**
 * Encrypt a token using AES-256-CBC
 */
function encryptToken(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * POST /oauth/microsoft/exchange
 * 
 * Exchanges authorization code for access/refresh tokens
 * Called by frontend after user completes OAuth flow
 */
router.post('/microsoft/exchange', async (req: Request, res: Response) => {
  try {
    const { code, connectionName, userId } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }

    if (!connectionName) {
      return res.status(400).json({ error: 'Connection name required' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    console.log('🔐 Exchanging OAuth code for tokens...');
    console.log(`   Connection name: ${connectionName}`);
    console.log(`   User ID: ${userId}`);

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: MICROSOFT_CLIENT_ID,
          client_secret: MICROSOFT_CLIENT_SECRET,
          code: code,
          redirect_uri: MICROSOFT_REDIRECT_URI,
          grant_type: 'authorization_code',
          scope: 'offline_access User.Read Mail.Read Calendars.Read',
        }),
      }
    );

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('❌ Token exchange failed:', errorData);
      return res.status(400).json({ 
        error: 'Token exchange failed', 
        details: errorData 
      });
    }

    const tokens: any = await tokenResponse.json();

    console.log('✅ Tokens received successfully');

    // Calculate token expiration
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Encrypt tokens
    const encryptedAccessToken = encryptToken(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token 
      ? encryptToken(tokens.refresh_token) 
      : null;

    console.log('🔒 Tokens encrypted');

    // Create connection in database
    const { data, error: dbError } = await supabase
      .from('integration_connections')
      .insert({
        provider_key: 'microsoft_365',
        name: connectionName,
        status: 'connected',
        encrypted_access_token: encryptedAccessToken,
        encrypted_refresh_token: encryptedRefreshToken,
        token_expires_at: expiresAt,
        config: {
          scopes: ['User.Read', 'Mail.Read', 'Calendars.Read']
        }
      })
      .select()
      .single();

    if (dbError || !data) {
      console.error('❌ Database error:', dbError);
      throw new Error('Failed to create connection in database: ' + (dbError?.message || 'Unknown error'));
    }

    console.log('✅ Connection created:', data.id);

    // Return success with connection ID
    res.json({
      success: true,
      connection_id: data.id,
      connection_name: data.name,
      expires_at: expiresAt
    });

  } catch (error: any) {
    console.error('❌ OAuth exchange error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

/**
 * GET /oauth/microsoft/authorize-url
 * 
 * Returns the Microsoft OAuth authorization URL
 * Frontend redirects user to this URL
 */
router.get('/microsoft/authorize-url', (req: Request, res: Response) => {
  const authUrl = new URL(`https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`);
  
  authUrl.searchParams.append('client_id', MICROSOFT_CLIENT_ID);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('redirect_uri', MICROSOFT_REDIRECT_URI);
  authUrl.searchParams.append('response_mode', 'query');
  authUrl.searchParams.append('scope', 'offline_access User.Read Mail.Read Calendars.Read');
  authUrl.searchParams.append('state', crypto.randomBytes(16).toString('hex')); // CSRF protection

  res.json({
    url: authUrl.toString()
  });
});

export default router;
