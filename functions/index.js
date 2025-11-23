// Carica variabili d'ambiente dal file .env
require('dotenv').config();

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { google } = require('googleapis');

// Inizializza Firebase Admin
admin.initializeApp();

// Configurazione OAuth2 (supporta sia .env che functions.config per retrocompatibilità)
const getOAuth2Client = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID || functions.config().google?.client_id;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || functions.config().google?.client_secret;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || functions.config().google?.redirect_uri;
  
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing OAuth2 configuration. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI');
  }
  
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

/**
 * Scambia authorization code per access token e refresh token
 */
exports.exchangeHealthCode = functions.https.onCall(async (data, context) => {
  // Verifica autenticazione
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const { code } = data;
    
    if (!code) {
      throw new functions.https.HttpsError('invalid-argument', 'Code is required');
    }

    // Crea OAuth2 client
    const oauth2Client = getOAuth2Client();

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
