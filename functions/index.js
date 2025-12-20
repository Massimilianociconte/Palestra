// Carica variabili d'ambiente dal file .env
require('dotenv').config();

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Inizializza Firebase Admin
admin.initializeApp();

// Configurazione OAuth2 (supporta sia .env che functions.config per retrocompatibilità)
const getOAuth2Client = (overrideRedirectUri = null) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || functions.config().google?.client_id;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || functions.config().google?.client_secret;
  // Usa l'URI passato dal client se presente, altrimenti fallback alle variabili d'ambiente
  const redirectUri = overrideRedirectUri || process.env.GOOGLE_REDIRECT_URI || functions.config().google?.redirect_uri;

  // Log per debug (rimuovi in produzione)
  console.log('OAuth Config:', {
    clientId: clientId ? `${clientId.substring(0, 20)}...` : 'MISSING',
    clientSecret: clientSecret ? `${clientSecret.substring(0, 10)}...` : 'MISSING',
    redirectUri: redirectUri || 'MISSING',
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
 */
exports.exchangeHealthCode = functions.https.onCall(async (data, context) => {
  // Verifica autenticazione
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const { code, redirectUri, redirect_uri } = data;

    if (!code) {
      throw new functions.https.HttpsError('invalid-argument', 'Code is required');
    }

    // Usa l'URI inviato dal client (supporta camelCase e snake_case)
    const dynamicUri = redirectUri || redirect_uri;
    console.log('Using dynamic redirect URI from client:', dynamicUri);

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
 * Webhook endpoint for Health Auto Export app
 * Receives health data from iOS devices via the Health Auto Export app
 * 
 * Setup in Health Auto Export app:
 * 1. Go to Automations > Create new
 * 2. Set destination: REST API
 * 3. URL: https://<region>-<project>.cloudfunctions.net/healthAutoExportWebhook
 * 4. Method: POST
 * 5. Headers: x-user-id: <firebase_user_id>, x-api-key: <your_secret_key>
 * 6. Format: JSON
 */
exports.healthAutoExportWebhook = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-user-id, x-api-key');

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

    // Validate API key (optional - configure in Firestore config/healthAutoExport)
    const configDoc = await admin.firestore().collection('config').doc('healthAutoExport').get();
    const config = configDoc.exists ? configDoc.data() : {};

    if (config.apiKey && apiKey !== config.apiKey) {
      console.warn('Health Auto Export: Invalid API key');
      res.status(401).send('Unauthorized');
      return;
    }

    if (!userId) {
      console.warn('Health Auto Export: Missing user ID');
      res.status(400).send('Missing x-user-id header or userId in body');
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
      userId,
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

    try {
      const { prompt, config, modelName } = data;

      if (!prompt) {
        throw new functions.https.HttpsError('invalid-argument', 'Prompt is required.');
      }

      // 2. Secure API Key Retrieval from secret
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        console.error('Gemini API Key missing in backend configuration.');
        throw new functions.https.HttpsError('internal', 'AI service not configured correctly.');
      }

      // 3. Initialize Gemini
      const genAI = new GoogleGenerativeAI(apiKey);

      // Use specified model or default to Flash for speed/cost
      const model = genAI.getGenerativeModel({
        model: modelName || "gemini-1.5-flash",
        generationConfig: config || {}
      });

      // 4. Generate Content
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      return { success: true, text: text };

    } catch (error) {
      console.error('Gemini Backend Error:', error);
      // Return a generic error to client to avoid leaking internal details, strictly log the real error
      throw new functions.https.HttpsError('internal', 'AI generation failed. Please try again later.');
    }
  });
