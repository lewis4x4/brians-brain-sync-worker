#!/usr/bin/env node
/**
 * Token Verification Script
 * Checks if Microsoft OAuth tokens are valid and properly stored
 */

const https = require('https');
const crypto = require('crypto');
require('dotenv').config();

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONNECTION_ID = 'ad01063e-97f2-4e79-826f-30222bb7247e';

// Encryption key derivation (matches your worker)
const ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update(SUPABASE_SERVICE_KEY.slice(0, 32))
  .digest();

function decrypt(encryptedText) {
  try {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedData = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error('Decryption error:', error.message);
    return null;
  }
}

async function fetchConnection() {
  return new Promise((resolve, reject) => {
    const url = `${SUPABASE_URL}/rest/v1/integration_connections?id=eq.${CONNECTION_ID}&select=*`;
    const options = {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

async function testAccessToken(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'graph.microsoft.com',
      path: '/v1.0/me',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          valid: res.statusCode === 200,
          status: res.statusCode,
          response: data
        });
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('🔍 Verifying Microsoft OAuth Tokens...\n');
  
  try {
    // Fetch connection
    console.log('📡 Fetching connection from Supabase...');
    const connections = await fetchConnection();
    
    if (!connections || connections.length === 0) {
      console.error('❌ Connection not found!');
      return;
    }

    const connection = connections[0];
    console.log('✅ Connection found:', connection.name);
    console.log('   Status:', connection.status);
    console.log('   Provider:', connection.provider_key);
    console.log('   Last sync:', connection.last_sync_finished_at || 'never');
    console.log();

    // Check if we have encrypted tokens
    if (!connection.encrypted_access_token) {
      console.error('❌ No encrypted_access_token found!');
      console.log('   Has secret_ref:', !!connection.secret_ref);
      console.log('   Has config:', !!connection.config);
      
      // Check if tokens are in config
      if (connection.config?.access_token) {
        console.log('   ℹ️  Tokens found in config (unencrypted)');
        const accessToken = connection.config.access_token;
        console.log('   Testing access token...');
        const result = await testAccessToken(accessToken);
        console.log('   Token valid:', result.valid);
        console.log('   Token expires at:', connection.token_expires_at);
        console.log('   Is expired:', new Date(connection.token_expires_at) < new Date());
      } else {
        console.log('   ❌ No tokens found anywhere!');
        console.log('   → You need to reconnect Microsoft 365 in Lovable');
      }
      return;
    }

    console.log('🔐 Decrypting tokens...');
    const accessToken = decrypt(connection.encrypted_access_token);
    const refreshToken = connection.encrypted_refresh_token 
      ? decrypt(connection.encrypted_refresh_token) 
      : null;

    if (!accessToken) {
      console.error('❌ Failed to decrypt access token!');
      console.log('   → Check that ENCRYPTION_KEY is correct');
      return;
    }

    console.log('✅ Access token decrypted');
    console.log('✅ Refresh token', refreshToken ? 'present' : 'missing');
    console.log('   Token expiry:', connection.token_expires_at);
    console.log('   Is expired:', new Date(connection.token_expires_at) < new Date());
    console.log();

    // Test access token
    console.log('🧪 Testing access token with Microsoft Graph...');
    const result = await testAccessToken(accessToken);
    
    if (result.valid) {
      console.log('✅ Token is VALID!');
      console.log('   User:', JSON.parse(result.response).mail);
    } else {
      console.log('❌ Token is INVALID');
      console.log('   Status:', result.status);
      console.log('   Response:', result.response);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main();
