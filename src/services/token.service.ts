import { createClient } from '@supabase/supabase-js';
import logger from '../utils/logger';
import crypto from 'crypto';

interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
}

export class TokenService {
  private encryptionKey: Buffer;

  constructor() {
    // Derive encryption key from service role key (same as verify-tokens.js)
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    this.encryptionKey = crypto
      .createHash('sha256')
      .update(serviceKey.slice(0, 32))
      .digest();
  }

  async getTokens(connectionId: string): Promise<Tokens> {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: connection, error } = await supabase
      .from('integration_connections')
      .select('*')
      .eq('id', connectionId)
      .single();

    if (error || !connection) {
      throw new Error('Connection not found');
    }
    
    // Try to parse tokens from secret_ref (JSON string)
    if (connection.secret_ref && typeof connection.secret_ref === 'string') {
      try {
        const tokens = JSON.parse(connection.secret_ref);
        logger.info('✅ Tokens found in secret_ref');
        return {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expires_at
        };
      } catch (e) {
        logger.error('Failed to parse secret_ref:', e);
      }
    }
    
    // Fall back to encrypted fields
    if (!connection.encrypted_access_token) {
      throw new Error('No access token found in connection');
    }

    logger.info('Decrypting tokens from encrypted fields');
    const accessToken = this.decrypt(connection.encrypted_access_token);
    const refreshToken = connection.encrypted_refresh_token
      ? this.decrypt(connection.encrypted_refresh_token)
      : null;

    if (!accessToken) {
      throw new Error('Failed to decrypt access token');
    }

    return {
      accessToken,
      refreshToken,
      expiresAt: connection.token_expires_at,
    };
  }

  async saveTokens(connectionId: string, tokens: Tokens): Promise<void> {
    const tokenData = {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
    };

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error } = await supabase
      .from('integration_connections')
      .update({
        secret_ref: JSON.stringify(tokenData),
        last_error: null
      })
      .eq('id', connectionId);

    if (error) {
      throw new Error(`Failed to save tokens: ${error.message}`);
    }

    logger.info('✅ Tokens saved successfully');
  }

  async refreshAccessToken(connectionId: string): Promise<Tokens> {
    logger.info('Refreshing token...');
    
    const tokens = await this.getTokens(connectionId);
    
    if (!tokens.refreshToken) {
      throw new Error('No refresh token available');
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Microsoft OAuth credentials not configured');
    }

    const response = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokens.refreshToken,
          grant_type: 'refresh_token',
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const newTokens: Tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokens.refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };

    await this.saveTokens(connectionId, newTokens);
    logger.info('✅ Token refreshed successfully');

    return newTokens;
  }

  async ensureValidToken(connectionId: string): Promise<string> {
    const tokens = await this.getTokens(connectionId);
    
    // Check if token is expired or about to expire (within 5 minutes)
    const expiresAt = new Date(tokens.expiresAt);
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
    
    if (expiresAt < fiveMinutesFromNow) {
      logger.info('Token expired or expiring soon, refreshing...');
      const newTokens = await this.refreshAccessToken(connectionId);
      return newTokens.accessToken;
    }
    
    logger.info('✅ Token is valid');
    return tokens.accessToken;
  }

  private decrypt(encryptedText: string): string | null {
    try {
      const parts = encryptedText.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const encryptedData = Buffer.from(parts[1], 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
      let decrypted = decipher.update(encryptedData);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return decrypted.toString();
    } catch (error) {
      logger.error('Decryption failed:', error);
      return null;
    }
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }
}

const tokenService = new TokenService();
export default tokenService;