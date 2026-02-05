// Carica variabili d'ambiente dal file .env
require('dotenv').config();

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Inizializza Firebase Admin
admin.initializeApp();

// ============================================
// SECURITY: Rate Limiting Implementation
// ============================================

/**
 * Simple in-memory rate limiter for Cloud Functions
 * In production, consider using Firebase Realtime Database or Redis for distributed rate limiting
 */
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMITS = {
  generateContent: { maxCalls: 10, windowMs: 60000 },  // 10 calls per minute
  exchangeHealthCode: { maxCalls: 5, windowMs: 60000 }, // 5 calls per minute
  default: { maxCalls: 30, windowMs: 60000 }            // 30 calls per minute
};

function checkRateLimit(uid, functionName) {
  const key = `${uid}:${functionName}`;
  const now = Date.now();
  const limits = RATE_LIMITS[functionName] || RATE_LIMITS.default;

  let record = rateLimitStore.get(key);

  // Clean old entries periodically
  if (!record || now - record.windowStart > limits.windowMs) {
    record = { windowStart: now, count: 0 };
  }

  record.count++;
  rateLimitStore.set(key, record);

  if (record.count > limits.maxCalls) {
    return false; // Rate limit exceeded
  }

  return true;
}

// ============================================
// SECURITY: Input Validation Helpers
// ============================================

function validateCode(code) {
  if (!code || typeof code !== 'string') return false;
  if (code.length > 500 || code.length < 10) return false;
  // OAuth codes are typically alphanumeric with some special chars
  if (!/^[a-zA-Z0-9\/_\-\.]+$/.test(code)) return false;
  return true;
}

function validateRedirectUri(uri) {
  if (!uri || typeof uri !== 'string') return false;
  if (uri.length > 500) return false;
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

// Configurazione OAuth2 (supporta sia .env che functions.config per retrocompatibilità)
const getOAuth2Client = (overrideRedirectUri = null) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || functions.config().google?.client_id;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || functions.config().google?.client_secret;
  // Usa l'URI passato dal client se presente, altrimenti fallback alle variabili d'ambiente
  const redirectUri = overrideRedirectUri || process.env.GOOGLE_REDIRECT_URI || functions.config().google?.redirect_uri;

  // SECURITY FIX: Remove credential logging in production
  // Only log config status, never actual values
  console.log('OAuth Config Status:', {
    clientIdConfigured: !!clientId,
    clientSecretConfigured: !!clientSecret,
    redirectUriConfigured: !!redirectUri,
    source: overrideRedirectUri ? 'client-dynamic' : (process.env.GOOGLE_CLIENT_ID ? '.env' : 'functions.config()')
  });

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing OAuth2 configuration. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

/**
 * Scambia authorization code per access token e refresh token
 * Updated: 2025-11-23 - Fixed OAuth credentials
 * Updated: 2026-01-08 - Added input validation and rate limiting
 */
exports.exchangeHealthCode = functions.https.onCall(async (data, context) => {
  // Verifica autenticazione
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  // SECURITY: Rate limiting
  if (!checkRateLimit(context.auth.uid, 'exchangeHealthCode')) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many requests. Please try again later.');
  }

  try {
    const { code, redirectUri, redirect_uri } = data;

    // SECURITY FIX: Validate input format and length
    if (!validateCode(code)) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid code format');
    }

    // Usa l'URI inviato dal client (supporta camelCase e snake_case)
    const dynamicUri = redirectUri || redirect_uri;

    // SECURITY FIX: Validate redirect URI
    if (dynamicUri && !validateRedirectUri(dynamicUri)) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid redirect URI format');
    }

    console.log('Processing OAuth exchange for user:', context.auth.uid);

    // Crea OAuth2 client con URI dinamico
    const oauth2Client = getOAuth2Client(dynamicUri);

    // Scambia code per tokens
    const { tokens } = await oauth2Client.getToken(code);

    // Salva tokens in Firestore (nella collezione private dell'utente)
    await admin.firestore()
      .collection('users')
      .doc(context.auth.uid)
      .collection('private')
      .doc('healthToken')
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date,
        scope: tokens.scope,
        tokenType: tokens.token_type,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    // Abilita health connect per l'utente
    await admin.firestore()
      .collection('users')
      .doc(context.auth.uid)
      .set({
        healthConnectEnabled: true,
        healthConnectConnectedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    console.log(`Health Connect enabled for user ${context.auth.uid}`);

    return {
      success: true,
      message: 'Tokens saved successfully'
    };
  } catch (error) {
    console.error('Error exchanging code:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Refresh access token usando refresh token
 */
exports.refreshHealthToken = functions.https.onCall(async (data, context) => {
  // Verifica autenticazione
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    // Recupera refresh token da Firestore
    const tokenDoc = await admin.firestore()
      .collection('users')
      .doc(context.auth.uid)
      .collection('private')
      .doc('healthToken')
      .get();

    if (!tokenDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'No health token found');
    }

    const { refreshToken } = tokenDoc.data();

    if (!refreshToken) {
      throw new functions.https.HttpsError('failed-precondition', 'No refresh token available');
    }

    // Crea OAuth2 client e imposta refresh token
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    // Refresh access token
    const { credentials } = await oauth2Client.refreshAccessToken();

    // Aggiorna token in Firestore
    await tokenDoc.ref.update({
      accessToken: credentials.access_token,
      expiryDate: credentials.expiry_date,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`Token refreshed for user ${context.auth.uid}`);

    return {
      success: true,
      accessToken: credentials.access_token,
      expiryDate: credentials.expiry_date
    };
  } catch (error) {
    console.error('Error refreshing token:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Sincronizzazione automatica schedulata (ogni 6 ore)
 */
exports.syncHealthData = functions.pubsub
  .schedule('every 6 hours')
  .onRun(async (context) => {
    console.log('Starting scheduled health data sync');

    try {
      // Get tutti gli utenti con health connect abilitato
      const usersSnapshot = await admin.firestore()
        .collection('users')
        .where('healthConnectEnabled', '==', true)
        .get();

      console.log(`Found ${usersSnapshot.size} users with Health Connect enabled`);

      const syncPromises = [];

      for (const userDoc of usersSnapshot.docs) {
        syncPromises.push(syncUserHealthData(userDoc.id));
      }

      await Promise.allSettled(syncPromises);

      console.log('Scheduled health data sync completed');
      return null;
    } catch (error) {
      console.error('Error in scheduled sync:', error);
      return null;
    }
  });

/**
 * Sincronizza dati health per un singolo utente
 */
async function syncUserHealthData(userId) {
  try {
    // Recupera token
    const tokenDoc = await admin.firestore()
      .collection('users')
      .doc(userId)
      .collection('private')
      .doc('healthToken')
      .get();

    if (!tokenDoc.exists) {
      console.log(`No token found for user ${userId}`);
      return;
    }

    const { accessToken, refreshToken, expiryDate } = tokenDoc.data();

    // Crea OAuth2 client
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: expiryDate
    });

    // Se il token è scaduto, refresh
    if (expiryDate && expiryDate < Date.now()) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      // Aggiorna token in Firestore
      await tokenDoc.ref.update({
        accessToken: credentials.access_token,
        expiryDate: credentials.expiry_date,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Fetch dati Google Fit (ultimi 7 giorni)
    const fitness = google.fitness({ version: 'v1', auth: oauth2Client });
    const endTime = Date.now() * 1000000; // nanoseconds
    const startTime = (Date.now() - 7 * 24 * 60 * 60 * 1000) * 1000000;

    // Fetch steps
    const stepsResponse = await fitness.users.dataSources.datasets.get({
      userId: 'me',
      dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps',
      datasetId: `${startTime}-${endTime}`
    });

    // Processa e salva dati (implementazione semplificata)
    const totalSteps = stepsResponse.data.point?.reduce((sum, point) => {
      return sum + (point.value?.[0]?.intVal || 0);
    }, 0) || 0;

    // Salva in Firestore
    const today = new Date().toISOString().split('T')[0];
    await admin.firestore()
      .collection('users')
      .doc(userId)
      .collection('health')
      .doc(today)
      .set({
        steps: `S|${totalSteps}|${today.replace(/-/g, '')}|steps`,
        syncTimestamp: Date.now(),
        source: 'google_fit_auto',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    console.log(`Synced health data for user ${userId}: ${totalSteps} steps`);
  } catch (error) {
    console.error(`Error syncing user ${userId}:`, error);
  }
}

// ============================================
// TERRA API INTEGRATION (Apple Health / iOS)
// ============================================

/**
 * Get Terra API credentials from config
 */
const getTerraCredentials = async () => {
  // Try environment variables first
  let devId = process.env.TERRA_DEV_ID;
  let apiKey = process.env.TERRA_API_KEY;

  // Fallback to Firestore config
  if (!devId || !apiKey) {
    const configDoc = await admin.firestore().collection('config').doc('terra').get();
    if (configDoc.exists) {
      const config = configDoc.data();
      devId = devId || config.devId;
      apiKey = apiKey || config.apiKey;
    }
  }

  if (!devId || !apiKey) {
    throw new Error('Terra API credentials not configured');
  }

  return { devId, apiKey };
};

/**
 * Generate Terra Widget Session for user authentication
 * This creates a session URL that the user opens to connect their health provider
 */
exports.generateTerraWidgetSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const { referenceId, providers } = data;
    const { devId, apiKey } = await getTerraCredentials();

    // Call Terra API to generate widget session
    const fetch = (await import('node-fetch')).default;

    const response = await fetch('https://api.tryterra.co/v2/auth/generateWidgetSession', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'dev-id': devId,
        'x-api-key': apiKey
      },
      body: JSON.stringify({
        reference_id: referenceId,
        providers: providers || ['APPLE'], // Default to Apple Health
        language: 'it', // Italian
        auth_success_redirect_url: `${process.env.APP_URL || 'https://nicolo2000.github.io/Palestra'}/user.html?terra=success`,
        auth_failure_redirect_url: `${process.env.APP_URL || 'https://nicolo2000.github.io/Palestra'}/user.html?terra=error`
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Terra API error:', result);
      throw new Error(result.message || 'Failed to generate widget session');
    }

    console.log(`Terra widget session generated for user ${context.auth.uid}`);

    return {
      success: true,
      url: result.url,
      sessionId: result.session_id
    };
  } catch (error) {
    console.error('Error generating Terra widget session:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Verify Terra connection after user completes widget flow
 */
exports.verifyTerraConnection = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const { referenceId } = data;
    const { devId, apiKey } = await getTerraCredentials();

    // Get user by reference ID from Terra
    const fetch = (await import('node-fetch')).default;

    const response = await fetch(`https://api.tryterra.co/v2/userInfo?reference_id=${referenceId}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'dev-id': devId,
        'x-api-key': apiKey
      }
    });

    const result = await response.json();

    if (!response.ok || !result.users || result.users.length === 0) {
      return {
        success: true,
        connected: false,
        message: 'User not yet connected'
      };
    }

    // Find user with matching reference_id
    const terraUser = result.users.find(u => u.reference_id === referenceId);

    if (!terraUser) {
      return {
        success: true,
        connected: false,
        message: 'User not found'
      };
    }

    console.log(`Terra user verified: ${terraUser.user_id} (${terraUser.provider})`);

    return {
      success: true,
      connected: true,
      userId: terraUser.user_id,
      provider: terraUser.provider
    };
  } catch (error) {
    console.error('Error verifying Terra connection:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Fetch health data from Terra API
 */
exports.fetchTerraHealthData = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const { userId, days = 7 } = data;
    const { devId, apiKey } = await getTerraCredentials();

    if (!userId) {
      throw new Error('Terra user ID is required');
    }

    const fetch = (await import('node-fetch')).default;

    // Calculate date range
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Fetch all data types in parallel
    const [dailyRes, bodyRes, sleepRes, activityRes] = await Promise.allSettled([
      // Daily summary (steps, calories, distance, etc.)
      fetch(`https://api.tryterra.co/v2/daily?user_id=${userId}&start_date=${startDate}&end_date=${endDate}`, {
        headers: { 'Accept': 'application/json', 'dev-id': devId, 'x-api-key': apiKey }
      }),
      // Body metrics (weight, body fat, etc.)
      fetch(`https://api.tryterra.co/v2/body?user_id=${userId}&start_date=${startDate}&end_date=${endDate}`, {
        headers: { 'Accept': 'application/json', 'dev-id': devId, 'x-api-key': apiKey }
      }),
      // Sleep data
      fetch(`https://api.tryterra.co/v2/sleep?user_id=${userId}&start_date=${startDate}&end_date=${endDate}`, {
        headers: { 'Accept': 'application/json', 'dev-id': devId, 'x-api-key': apiKey }
      }),
      // Activity/workout data
      fetch(`https://api.tryterra.co/v2/activity?user_id=${userId}&start_date=${startDate}&end_date=${endDate}`, {
        headers: { 'Accept': 'application/json', 'dev-id': devId, 'x-api-key': apiKey }
      })
    ]);

    // Process responses
    const processResponse = async (res) => {
      if (res.status === 'fulfilled' && res.value.ok) {
        return await res.value.json();
      }
      return null;
    };

    const [daily, body, sleep, activity] = await Promise.all([
      processResponse(dailyRes),
      processResponse(bodyRes),
      processResponse(sleepRes),
      processResponse(activityRes)
    ]);

    console.log(`Terra data fetched for user ${userId}:`, {
      daily: daily?.data?.length || 0,
      body: body?.data?.length || 0,
      sleep: sleep?.data?.length || 0,
      activity: activity?.data?.length || 0
    });

    return {
      success: true,
      data: {
        daily: daily?.data || [],
        body: body?.data || [],
        sleep: sleep?.data || [],
        activity: activity?.data || []
      }
    };
  } catch (error) {
    console.error('Error fetching Terra health data:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Deauthenticate Terra user (disconnect)
 */
exports.deauthTerraUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const { userId } = data;
    const { devId, apiKey } = await getTerraCredentials();

    if (!userId) {
      throw new Error('Terra user ID is required');
    }

    const fetch = (await import('node-fetch')).default;

    const response = await fetch(`https://api.tryterra.co/v2/auth/deauthenticateUser?user_id=${userId}`, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        'dev-id': devId,
        'x-api-key': apiKey
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to deauthenticate user');
    }

    console.log(`Terra user ${userId} deauthenticated`);

    return { success: true };
  } catch (error) {
    console.error('Error deauthenticating Terra user:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// ============================================
// HEALTH AUTO EXPORT INTEGRATION (iOS)
// ============================================

/**
 * SECURITY: Verify webhook signature using HMAC-SHA256
 */
function verifyWebhookSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSig, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Webhook endpoint for Health Auto Export app
 * Receives health data from iOS devices via the Health Auto Export app
 * 
 * Setup in Health Auto Export app:
 * 1. Go to Automations > Create new
 * 2. Set destination: REST API
 * 3. URL: https://<region>-<project>.cloudfunctions.net/healthAutoExportWebhook
 * 4. Method: POST
 * 5. Headers: x-user-id: <firebase_user_id>, x-api-key: <your_secret_key>, x-signature: <hmac_signature>
 * 6. Format: JSON
 * 
 * SECURITY: Signature verification is MANDATORY when webhookSecret is configured
 */
exports.healthAutoExportWebhook = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-user-id, x-api-key, x-signature');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    // Get user ID from header or body
    const userId = req.headers['x-user-id'] || req.body?.userId;
    const apiKey = req.headers['x-api-key'];
    const signature = req.headers['x-signature'];

    // SECURITY FIX: Load config and enforce validation
    const configDoc = await admin.firestore().collection('config').doc('healthAutoExport').get();
    const config = configDoc.exists ? configDoc.data() : {};

    // SECURITY FIX: Mandatory API key verification (no longer optional)
    if (!config.apiKey) {
      console.error('Health Auto Export: API key not configured in Firestore');
      res.status(500).send('Webhook not configured');
      return;
    }

    if (apiKey !== config.apiKey) {
      console.warn('Health Auto Export: Invalid API key attempt');
      res.status(401).send('Unauthorized');
      return;
    }

    // SECURITY FIX: Verify webhook signature if secret is configured
    if (config.webhookSecret) {
      if (!verifyWebhookSignature(req.rawBody || req.body, signature, config.webhookSecret)) {
        console.warn('Health Auto Export: Invalid webhook signature');
        res.status(401).send('Invalid signature');
        return;
      }
    }

    // SECURITY FIX: Validate userId format (Firebase UIDs are alphanumeric, 28 chars)
    if (!userId || typeof userId !== 'string' || userId.length > 128 || !/^[a-zA-Z0-9]+$/.test(userId)) {
      console.warn('Health Auto Export: Invalid user ID format');
      res.status(400).send('Invalid user ID format');
      return;
    }

    // Verify user exists
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.warn(`Health Auto Export: User ${userId} not found`);
      res.status(404).send('User not found');
      return;
    }

    const payload = req.body;
    console.log('Health Auto Export webhook received:', {
      userId: userId.substring(0, 8) + '...', // Don't log full userId
      dataKeys: Object.keys(payload?.data || payload?.metrics || payload || {}),
      timestamp: new Date().toISOString()
    });

    // Process the health data
    const healthData = await processHealthAutoExportData(payload);

    // Save to Firestore
    const today = new Date().toISOString().split('T')[0];
    await admin.firestore()
      .collection('users')
      .doc(userId)
      .collection('health')
      .doc(today)
      .set({
        ...healthData,
        appleHealthLastUpdate: admin.firestore.FieldValue.serverTimestamp(),
        source: 'apple_health_auto_export'
      }, { merge: true });

    // Update user's health connect status
    await admin.firestore()
      .collection('users')
      .doc(userId)
      .set({
        appleHealthEnabled: true,
        appleHealthLastSync: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    console.log(`Health Auto Export: Data saved for user ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Health data received and saved',
      processed: Object.keys(healthData)
    });
  } catch (error) {
    console.error('Health Auto Export webhook error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Process Health Auto Export data into standardized format
 * Supports various export formats from the app
 */
async function processHealthAutoExportData(payload) {
  const result = {};
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');

  // Health Auto Export can send data in different formats
  const data = payload?.data || payload?.metrics || payload;

  // Process Steps
  if (data?.steps || data?.stepCount) {
    const steps = Array.isArray(data.steps) ? data.steps : [data.steps || data.stepCount];
    const totalSteps = steps.reduce((sum, s) => {
      const value = typeof s === 'object' ? (s.value || s.qty || s.count || 0) : s;
      return sum + (parseInt(value) || 0);
    }, 0);
    result.steps = `S|${totalSteps}|${today}|steps`;
    result.stepsRaw = totalSteps;
  }

  // Process Heart Rate
  if (data?.heartRate || data?.heart_rate) {
    const hrData = data.heartRate || data.heart_rate;
    const hrArray = Array.isArray(hrData) ? hrData : [hrData];
    const hrValues = hrArray.map(hr => ({
      value: typeof hr === 'object' ? (hr.value || hr.avg || hr.bpm) : hr,
      date: hr?.date || hr?.startDate || new Date().toISOString()
    })).filter(hr => hr.value);

    if (hrValues.length > 0) {
      const avgHr = Math.round(hrValues.reduce((sum, hr) => sum + hr.value, 0) / hrValues.length);
      const minHr = Math.min(...hrValues.map(hr => hr.value));
      const maxHr = Math.max(...hrValues.map(hr => hr.value));
      result.heartRate = `HR|${avgHr}|${minHr}|${maxHr}|${today}|bpm`;
      result.heartRateRaw = { avg: avgHr, min: minHr, max: maxHr, samples: hrValues.length };
    }
  }

  // Process Sleep
  if (data?.sleep || data?.sleepAnalysis) {
    const sleepData = data.sleep || data.sleepAnalysis;
    const sleepArray = Array.isArray(sleepData) ? sleepData : [sleepData];

    let totalSleepMinutes = 0;
    let deepSleepMinutes = 0;
    let remSleepMinutes = 0;

    sleepArray.forEach(s => {
      if (typeof s === 'object') {
        // Duration in hours or minutes
        const duration = s.value || s.duration || s.hours || 0;
        const durationMinutes = duration > 24 ? duration : duration * 60; // Assume hours if < 24

        if (s.type === 'deep' || s.sleepType === 'deep') {
          deepSleepMinutes += durationMinutes;
        } else if (s.type === 'rem' || s.sleepType === 'rem') {
          remSleepMinutes += durationMinutes;
        }
        totalSleepMinutes += durationMinutes;
      } else {
        totalSleepMinutes += (s > 24 ? s : s * 60);
      }
    });

    if (totalSleepMinutes > 0) {
      const sleepHours = (totalSleepMinutes / 60).toFixed(1);
      result.sleep = `SL|${sleepHours}|${Math.round(deepSleepMinutes)}|${Math.round(remSleepMinutes)}|${today}|hours`;
      result.sleepRaw = {
        totalHours: parseFloat(sleepHours),
        deepMinutes: Math.round(deepSleepMinutes),
        remMinutes: Math.round(remSleepMinutes)
      };
    }
  }

  // Process Active Energy / Calories
  if (data?.activeEnergy || data?.activeEnergyBurned || data?.calories) {
    const calories = data.activeEnergy || data.activeEnergyBurned || data.calories;
    const calArray = Array.isArray(calories) ? calories : [calories];
    const totalCal = calArray.reduce((sum, c) => {
      const value = typeof c === 'object' ? (c.value || c.qty || 0) : c;
      return sum + (parseFloat(value) || 0);
    }, 0);
    result.activeCalories = `AC|${Math.round(totalCal)}|${today}|kcal`;
    result.activeCaloriesRaw = Math.round(totalCal);
  }

  // Process Distance
  if (data?.distance || data?.distanceWalkingRunning) {
    const distance = data.distance || data.distanceWalkingRunning;
    const distArray = Array.isArray(distance) ? distance : [distance];
    const totalDist = distArray.reduce((sum, d) => {
      const value = typeof d === 'object' ? (d.value || d.qty || 0) : d;
      return sum + (parseFloat(value) || 0);
    }, 0);
    // Assume km, convert if needed
    const distKm = totalDist > 100 ? totalDist / 1000 : totalDist;
    result.distance = `D|${distKm.toFixed(2)}|${today}|km`;
    result.distanceRaw = distKm;
  }

  // Process Workouts
  if (data?.workouts || data?.workout) {
    const workouts = data.workouts || data.workout;
    const workoutArray = Array.isArray(workouts) ? workouts : [workouts];
    result.workouts = workoutArray.map(w => ({
      type: w.type || w.workoutType || w.activityType || 'unknown',
      duration: w.duration || w.totalTime || 0,
      calories: w.calories || w.activeEnergy || w.energyBurned || 0,
      distance: w.distance || 0,
      startDate: w.startDate || w.start || null,
      endDate: w.endDate || w.end || null
    }));
  }

  // Process HRV (Heart Rate Variability)
  if (data?.hrv || data?.heartRateVariability) {
    const hrvData = data.hrv || data.heartRateVariability;
    const hrvArray = Array.isArray(hrvData) ? hrvData : [hrvData];
    const avgHrv = hrvArray.reduce((sum, h) => {
      const value = typeof h === 'object' ? (h.value || h.sdnn || 0) : h;
      return sum + (parseFloat(value) || 0);
    }, 0) / hrvArray.length;
    result.hrv = `HRV|${avgHrv.toFixed(1)}|${today}|ms`;
    result.hrvRaw = avgHrv;
  }

  // Process Resting Heart Rate
  if (data?.restingHeartRate || data?.resting_heart_rate) {
    const rhr = data.restingHeartRate || data.resting_heart_rate;
    const rhrValue = typeof rhr === 'object' ? (rhr.value || rhr.avg) : rhr;
    result.restingHeartRate = `RHR|${Math.round(rhrValue)}|${today}|bpm`;
    result.restingHeartRateRaw = Math.round(rhrValue);
  }

  // Process Blood Oxygen (SpO2)
  if (data?.bloodOxygen || data?.oxygenSaturation) {
    const spo2 = data.bloodOxygen || data.oxygenSaturation;
    const spo2Array = Array.isArray(spo2) ? spo2 : [spo2];
    const avgSpo2 = spo2Array.reduce((sum, s) => {
      const value = typeof s === 'object' ? (s.value || s.avg || 0) : s;
      return sum + (parseFloat(value) || 0);
    }, 0) / spo2Array.length;
    result.bloodOxygen = `SPO2|${avgSpo2.toFixed(1)}|${today}|%`;
    result.bloodOxygenRaw = avgSpo2;
  }

  // Process Weight
  if (data?.weight || data?.bodyMass) {
    const weight = data.weight || data.bodyMass;
    const weightValue = typeof weight === 'object' ? (weight.value || weight.qty) : weight;
    if (weightValue) {
      result.weight = `W|${parseFloat(weightValue).toFixed(1)}|${today}|kg`;
      result.weightRaw = parseFloat(weightValue);
    }
  }

  // Store raw payload for debugging
  result.rawPayloadKeys = Object.keys(data || {});

  return result;
}

/**
 * Get Health Auto Export setup instructions for a user
 */
exports.getHealthAutoExportSetup = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'your-project-id';
  const region = 'us-central1'; // Adjust if using different region

  // Generate a simple API key for this user (or use a shared one)
  const configDoc = await admin.firestore().collection('config').doc('healthAutoExport').get();
  let apiKey = configDoc.exists ? configDoc.data().apiKey : null;

  if (!apiKey) {
    // Generate a random API key
    apiKey = require('crypto').randomBytes(32).toString('hex');
    await admin.firestore().collection('config').doc('healthAutoExport').set({ apiKey });
  }

  return {
    success: true,
    setup: {
      webhookUrl: `https://${region}-${projectId}.cloudfunctions.net/healthAutoExportWebhook`,
      userId: context.auth.uid,
      apiKey: apiKey,
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': context.auth.uid,
        'x-api-key': apiKey
      },
      instructions: [
        '1. Scarica "Health Auto Export" dall\'App Store (€2.99)',
        '2. Apri l\'app e concedi accesso a Apple Health',
        '3. Vai su "Automations" > "Create new"',
        '4. Seleziona i dati da esportare (steps, heart rate, sleep, etc.)',
        '5. Imposta "Destination": REST API',
        '6. Inserisci l\'URL del webhook',
        '7. Aggiungi gli headers x-user-id e x-api-key',
        '8. Imposta la frequenza (consigliato: ogni ora o ogni giorno)',
        '9. Salva e attiva l\'automazione'
      ]
    }
  };
});

/**
 * Terra Webhook handler - receives data updates from Terra
 * This is called by Terra when new data is available
 */
exports.terraWebhook = functions.https.onRequest(async (req, res) => {
  try {
    // Verify webhook signature (optional but recommended)
    const terraSignature = req.headers['terra-signature'];

    // Log webhook for debugging
    console.log('Terra webhook received:', {
      type: req.body?.type,
      user: req.body?.user?.user_id,
      provider: req.body?.user?.provider
    });

    const { type, user, data } = req.body;

    if (!user || !user.reference_id) {
      console.log('Webhook without reference_id, ignoring');
      res.status(200).send('OK');
      return;
    }

    // Extract Firebase UID from reference_id (format: ironflow_<uid>_<timestamp>)
    const refParts = user.reference_id.split('_');
    if (refParts.length < 2 || refParts[0] !== 'ironflow') {
      console.log('Invalid reference_id format:', user.reference_id);
      res.status(200).send('OK');
      return;
    }

    const firebaseUid = refParts[1];

    // Handle different webhook types
    switch (type) {
      case 'auth':
        // User authenticated - save connection info
        await admin.firestore()
          .collection('users')
          .doc(firebaseUid)
          .collection('private')
          .doc('terraConnection')
          .set({
            userId: user.user_id,
            provider: user.provider,
            referenceId: user.reference_id,
            connectedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        console.log(`Terra auth webhook: User ${firebaseUid} connected via ${user.provider}`);
        break;

      case 'deauth':
        // User deauthenticated - remove connection
        await admin.firestore()
          .collection('users')
          .doc(firebaseUid)
          .collection('private')
          .doc('terraConnection')
          .delete();
        console.log(`Terra deauth webhook: User ${firebaseUid} disconnected`);
        break;

      case 'daily':
      case 'body':
      case 'sleep':
      case 'activity':
        // Data update - save to health collection
        if (data && data.length > 0) {
          const today = new Date().toISOString().split('T')[0];
          await admin.firestore()
            .collection('users')
            .doc(firebaseUid)
            .collection('health')
            .doc(today)
            .set({
              [`terra_${type}`]: data,
              terraLastUpdate: admin.firestore.FieldValue.serverTimestamp(),
              source: `terra_${user.provider?.toLowerCase() || 'unknown'}`
            }, { merge: true });
          console.log(`Terra ${type} webhook: Saved ${data.length} records for user ${firebaseUid}`);
        }
        break;

      default:
        console.log(`Unknown Terra webhook type: ${type}`);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing Terra webhook:', error);
    res.status(500).send('Error');
  }
});



// ============================================
// GEMINI AI INTEGRATION (Secure Backend)
// ============================================

/**
 * Generate content using Gemini AI safely from the backend.
 * This prevents exposing the API key to the client.
 * 
 * SECURITY: Includes rate limiting and input validation
 */
exports.generateContentWithGemini = functions
  .runWith({
    secrets: ['GEMINI_API_KEY'],
    timeoutSeconds: 60,
    memory: '256MB'
  })
  .https.onCall(async (data, context) => {
    // 1. Authentication Check
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to use AI features.');
    }

    // SECURITY: Rate limiting - 10 calls per minute per user
    if (!checkRateLimit(context.auth.uid, 'generateContent')) {
      throw new functions.https.HttpsError('resource-exhausted', 'Rate limit exceeded. Please wait before making more AI requests.');
    }

    try {
      const { prompt, config, modelName } = data;

      // SECURITY: Validate prompt
      if (!prompt || typeof prompt !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Prompt is required and must be a string.');
      }

      // SECURITY: Limit prompt length to prevent abuse (100KB max)
      if (prompt.length > 100000) {
        throw new functions.https.HttpsError('invalid-argument', 'Prompt exceeds maximum length.');
      }

      // 2. Secure API Key Retrieval from secret
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        // SECURITY: Don't expose internal details
        console.error('[INTERNAL] Gemini API Key missing in backend configuration.');
        throw new functions.https.HttpsError('internal', 'AI service temporarily unavailable.');
      }

      // 3. Initialize Gemini
      const genAI = new GoogleGenerativeAI(apiKey);

      // 4. Generate Content
      let text = '';
      const promptText = prompt || '';

      if (data.contents && Array.isArray(data.contents) && data.contents.length > 0) {
        // Chat mode (multi-turn)
        // Compatibility check: systemInstruction can be string or object { parts: [...] } or { role: 'system', parts: [...] }
        let systemInst = undefined;
        if (data.systemInstruction) {
          if (typeof data.systemInstruction === 'string') {
            systemInst = { parts: [{ text: data.systemInstruction }] };
          } else if (data.systemInstruction.parts) {
            systemInst = { parts: data.systemInstruction.parts };
          } else {
            systemInst = data.systemInstruction;
          }
        }

        const model = genAI.getGenerativeModel({
          model: modelName || "gemini-3-flash-preview",
          systemInstruction: systemInst
        });

        const chat = model.startChat({
          history: data.contents,
          generationConfig: config || {}
        });

        const result = await chat.sendMessage(promptText);
        const response = await result.response;
        text = response.text();
      } else {
        // Standard generation (single-turn)
        let systemInst = undefined;
        if (data.systemInstruction) {
          if (typeof data.systemInstruction === 'string') {
            systemInst = { parts: [{ text: data.systemInstruction }] };
          } else if (data.systemInstruction.parts) {
            systemInst = { parts: data.systemInstruction.parts };
          } else {
            systemInst = data.systemInstruction;
          }
        }

        const model = genAI.getGenerativeModel({
          model: modelName || "gemini-3-flash-preview",
          systemInstruction: systemInst,
          generationConfig: config || {}
        });

        const result = await model.generateContent(promptText);
        const response = await result.response;
        text = response.text();
      }

      return { success: true, text: text };

    } catch (error) {
      console.error("Gemini Generation Error:", error);
      // Temporarily return real error for debugging
      throw new functions.https.HttpsError('internal', `AI Error: ${error.message || 'Unknown'}`);
    }
  });

// ============================================
// GYMBRO PROXIMITY DETECTION (Social Layer)
// ============================================

/**
 * Rate limits for proximity functions
 */
RATE_LIMITS.proximityDiscovery = { maxCalls: 30, windowMs: 60000 }; // 30/min (device scans)
RATE_LIMITS.findNearbyUsers = { maxCalls: 10, windowMs: 60000 };   // 10/min (web geohash)

/**
 * Helper: Get adjacent geohash cells for edge coverage
 */
function getAdjacentGeohashes(geohash) {
  const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

  // Decode geohash to bounding box
  const decode = (hash) => {
    let latMin = -90, latMax = 90;
    let lngMin = -180, lngMax = 180;
    let isLon = true;

    for (const c of hash.toLowerCase()) {
      const idx = GEOHASH_BASE32.indexOf(c);
      if (idx === -1) continue;

      for (let bit = 4; bit >= 0; bit--) {
        const mask = 1 << bit;

        if (isLon) {
          const mid = (lngMin + lngMax) / 2;
          if (idx & mask) lngMin = mid;
          else lngMax = mid;
        } else {
          const mid = (latMin + latMax) / 2;
          if (idx & mask) latMin = mid;
          else latMax = mid;
        }
        isLon = !isLon;
      }
    }
    return { minLat: latMin, maxLat: latMax, minLng: lngMin, maxLng: lngMax };
  };

  // Encode lat/lng to geohash
  const encode = (lat, lng, precision) => {
    let latMin = -90, latMax = 90;
    let lngMin = -180, lngMax = 180;
    let hash = '', isLon = true, bit = 0, ch = 0;

    while (hash.length < precision) {
      if (isLon) {
        const mid = (lngMin + lngMax) / 2;
        if (lng >= mid) { ch |= (1 << (4 - bit)); lngMin = mid; }
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (lat >= mid) { ch |= (1 << (4 - bit)); latMin = mid; }
        else latMax = mid;
      }
      isLon = !isLon;
      bit++;
      if (bit === 5) { hash += GEOHASH_BASE32[ch]; bit = 0; ch = 0; }
    }
    return hash;
  };

  const bounds = decode(geohash);
  const lat = (bounds.minLat + bounds.maxLat) / 2;
  const lng = (bounds.minLng + bounds.maxLng) / 2;
  const latDelta = bounds.maxLat - bounds.minLat;
  const lngDelta = bounds.maxLng - bounds.minLng;

  const neighbors = [];
  const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  for (const [dLat, dLng] of directions) {
    let newLat = Math.max(-89.9, Math.min(89.9, lat + dLat * latDelta));
    let newLng = lng + dLng * lngDelta;
    if (newLng > 180) newLng -= 360;
    if (newLng < -180) newLng += 360;
    neighbors.push(encode(newLat, newLng, geohash.length));
  }

  return neighbors;
}

/**
 * Helper: Check debounce and send notification
 */
async function checkAndNotifyProximity(myUid, otherUid) {
  // Generate deterministic pair hash
  const pairHash = crypto.createHash('sha256')
    .update([myUid, otherUid].sort().join('_'))
    .digest('hex');

  const logRef = admin.firestore().collection('proximity_logs').doc(pairHash);
  const logDoc = await logRef.get();

  const DEBOUNCE_MS = 3600000; // 1 hour

  if (logDoc.exists) {
    const lastNotified = logDoc.data().last_notified?.toDate?.() || logDoc.data().last_notified;
    if (lastNotified && (Date.now() - new Date(lastNotified).getTime()) < DEBOUNCE_MS) {
      return { notified: false, reason: 'debounced' };
    }
  }

  // Get both users' display names for notifications
  const [myUserDoc, otherUserDoc] = await Promise.all([
    admin.firestore().collection('users').doc(myUid).get(),
    admin.firestore().collection('users').doc(otherUid).get()
  ]);

  const myName = myUserDoc.data()?.displayName || 'Un utente';
  const otherName = otherUserDoc.data()?.displayName || 'Un utente';

  // Get FCM tokens (if available)
  const myToken = myUserDoc.data()?.fcmToken;
  const otherToken = otherUserDoc.data()?.fcmToken;

  const notifications = [];

  // Notify first user
  if (otherToken) {
    notifications.push(
      admin.messaging().send({
        token: otherToken,
        notification: {
          title: '🏋️ GymBro Nearby!',
          body: `${myName} sta allenandosi vicino a te!`
        },
        data: {
          type: 'proximity',
          senderUid: myUid,
          senderName: myName
        }
      }).catch(e => console.warn('FCM send error:', e.message))
    );
  }

  // Notify second user
  if (myToken) {
    notifications.push(
      admin.messaging().send({
        token: myToken,
        notification: {
          title: '🏋️ GymBro Nearby!',
          body: `${otherName} sta allenandosi vicino a te!`
        },
        data: {
          type: 'proximity',
          senderUid: otherUid,
          senderName: otherName
        }
      }).catch(e => console.warn('FCM send error:', e.message))
    );
  }

  await Promise.all(notifications);

  // Update debounce log
  await logRef.set({
    user_a: [myUid, otherUid].sort()[0],
    user_b: [myUid, otherUid].sort()[1],
    last_notified: admin.firestore.FieldValue.serverTimestamp(),
    notification_count: admin.firestore.FieldValue.increment(1)
  }, { merge: true });

  console.log(`Proximity notification sent: ${myUid} <-> ${otherUid}`);
  return { notified: true };
}

/**
 * Called by native app when Bluetooth discovers a proximity_id
 * Reports the discovery to match users and send notifications
 */
exports.reportProximityDiscovery = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  // Rate limiting
  if (!checkRateLimit(context.auth.uid, 'proximityDiscovery')) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many requests');
  }

  try {
    const { discoveredProximityId } = data;
    const myUid = context.auth.uid;

    // Validate input
    if (!discoveredProximityId || typeof discoveredProximityId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid proximity ID');
    }

    // UUID format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(discoveredProximityId)) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid proximity ID format');
    }

    // Find user by proximity_id
    const usersSnap = await admin.firestore()
      .collection('users')
      .where('proximity_id', '==', discoveredProximityId)
      .where('proximity_status', '==', 'training')
      .limit(1)
      .get();

    if (usersSnap.empty) {
      return { found: false };
    }

    const otherUid = usersSnap.docs[0].id;

    // Don't match with self
    if (otherUid === myUid) {
      return { found: false };
    }

    // Check debounce and notify
    const result = await checkAndNotifyProximity(myUid, otherUid);

    return { found: true, ...result };

  } catch (error) {
    console.error('reportProximityDiscovery error:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Called by web app with geohash for geofencing-based discovery
 * Queries users in the same or adjacent geohash cells
 */
exports.findNearbyUsers = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  // Rate limiting
  if (!checkRateLimit(context.auth.uid, 'findNearbyUsers')) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many requests');
  }

  try {
    const { geohash } = data;
    const myUid = context.auth.uid;

    // Validate geohash
    if (!geohash || typeof geohash !== 'string' || geohash.length < 4 || geohash.length > 12) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid geohash');
    }

    // Geohash character validation
    const geohashRegex = /^[0-9bcdefghjkmnpqrstuvwxyz]+$/i;
    if (!geohashRegex.test(geohash)) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid geohash characters');
    }

    // Get adjacent cells for edge coverage
    const searchHashes = [geohash, ...getAdjacentGeohashes(geohash)];

    // Query users in same area (Firestore 'in' supports up to 10 values)
    const usersSnap = await admin.firestore()
      .collection('users')
      .where('last_geohash', 'in', searchHashes.slice(0, 10))
      .where('proximity_status', '==', 'training')
      .get();

    let checkedCount = 0;
    let notifiedCount = 0;

    for (const userDoc of usersSnap.docs) {
      if (userDoc.id === myUid) continue;

      checkedCount++;
      const result = await checkAndNotifyProximity(myUid, userDoc.id);
      if (result.notified) notifiedCount++;
    }

    console.log(`findNearbyUsers: checked ${checkedCount}, notified ${notifiedCount}`);
    return { checked: checkedCount, notified: notifiedCount };

  } catch (error) {
    console.error('findNearbyUsers error:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});


// ============================================
// USER DATA MIGRATION: Add root-level email field
// ============================================

/**
 * Migrate user documents to add root-level email field
 * This is needed for efficient email search queries
 * Can be called by admin to migrate existing users
 */
exports.migrateUserEmails = functions.https.onCall(async (data, context) => {
  // Only allow authenticated users (in production, add admin check)
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const db = admin.firestore();
  const usersRef = db.collection('users');
  
  try {
    const snapshot = await usersRef.get();
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    const batch = db.batch();
    let batchCount = 0;
    const MAX_BATCH_SIZE = 500;

    for (const doc of snapshot.docs) {
      const userData = doc.data();
      
      // Skip if already has root-level email
      if (userData.email && typeof userData.email === 'string' && userData.email.length > 0) {
        skippedCount++;
        continue;
      }

      // Get email from profile.email or from Auth
      let email = userData.profile?.email;
      
      if (!email) {
        // Try to get from Firebase Auth
        try {
          const authUser = await admin.auth().getUser(doc.id);
          email = authUser.email;
        } catch (authError) {
          console.warn(`Could not get auth user for ${doc.id}:`, authError.message);
        }
      }

      if (email) {
        batch.update(doc.ref, { 
          email: email.toLowerCase().trim() 
        });
        migratedCount++;
        batchCount++;

        // Commit batch if it reaches max size
        if (batchCount >= MAX_BATCH_SIZE) {
          await batch.commit();
          batchCount = 0;
        }
      } else {
        errorCount++;
        console.warn(`No email found for user ${doc.id}`);
      }
    }

    // Commit remaining batch
    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(`Migration complete: ${migratedCount} migrated, ${skippedCount} skipped, ${errorCount} errors`);
    
    return {
      success: true,
      migrated: migratedCount,
      skipped: skippedCount,
      errors: errorCount,
      total: snapshot.size
    };

  } catch (error) {
    console.error('Migration error:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Ensure user document has root-level email on login/signup
 * Triggered when a user document is created or updated
 */
exports.ensureUserEmail = functions.firestore
  .document('users/{userId}')
  .onWrite(async (change, context) => {
    const userId = context.params.userId;
    const after = change.after.exists ? change.after.data() : null;
    
    if (!after) return null; // Document deleted
    
    // Check if email already exists at root level
    if (after.email && typeof after.email === 'string' && after.email.length > 0) {
      return null; // Already has email
    }
    
    // Try to get email from profile or Auth
    let email = after.profile?.email;
    
    if (!email) {
      try {
        const authUser = await admin.auth().getUser(userId);
        email = authUser.email;
      } catch (error) {
        console.warn(`ensureUserEmail: Could not get auth for ${userId}`);
        return null;
      }
    }
    
    if (email) {
      await change.after.ref.update({
        email: email.toLowerCase().trim()
      });
      console.log(`ensureUserEmail: Added email for ${userId}`);
    }
    
    return null;
  });


// ============================================
// FRIEND SEARCH: Search user by email via Cloud Function
// ============================================

/**
 * Search for a user by email address
 * This bypasses client-side permission issues by using Admin SDK
 */
exports.searchUserByEmail = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { email } = data;
  const myUid = context.auth.uid;

  if (!email || typeof email !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Email is required');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const db = admin.firestore();

  try {
    // Try root-level email first
    let snapshot = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    // Fallback to profile.email
    if (snapshot.empty) {
      snapshot = await db.collection('users')
        .where('profile.email', '==', normalizedEmail)
        .limit(1)
        .get();
    }

    if (snapshot.empty) {
      return { success: false, error: 'Nessun utente trovato con questa email', code: 'not-found' };
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    // Don't return self
    if (userDoc.id === myUid) {
      return { success: false, error: 'Non puoi cercare te stesso', code: 'invalid-argument' };
    }

    // Check friendship status
    const friendshipId = [myUid, userDoc.id].sort().join('_');
    const friendshipDoc = await db.collection('friendships').doc(friendshipId).get();
    
    let friendshipStatus = 'none';
    if (friendshipDoc.exists) {
      const friendshipData = friendshipDoc.data();
      if (friendshipData.status === 'accepted') {
        friendshipStatus = 'accepted';
      } else if (friendshipData.status === 'pending_from_a' || friendshipData.status === 'pending_from_b') {
        friendshipStatus = friendshipData.createdBy === myUid ? 'pending_sent' : 'pending_received';
      }
    }

    return {
      success: true,
      data: {
        uid: userDoc.id,
        displayName: userData.profile?.name || 'Utente',
        photoURL: userData.profile?.photoUrl || '',
        email: normalizedEmail,
        friendshipStatus
      }
    };

  } catch (error) {
    console.error('searchUserByEmail error:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});
