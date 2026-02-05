# 🔧 Setup Google Fit API per IronFlow

## Guida Passo-Passo

### 1. Crea Progetto Google Cloud

1. Vai su [Google Cloud Console](https://console.cloud.google.com)
2. Click su "Select a project" → "New Project"
3. Nome progetto: `IronFlow Health`
4. Click "Create"

### 2. Abilita Google Fit API

1. Nel menu laterale, vai su "APIs & Services" → "Library"
2. Cerca "Fitness API"
3. Click su "Fitness API"
4. Click "Enable"

### 3. Configura OAuth Consent Screen

1. Vai su "APIs & Services" → "OAuth consent screen"
2. Seleziona "External" (per app pubblica)
3. Click "Create"

**Informazioni App:**
- App name: `IronFlow`
- User support email: `tua-email@example.com`
- App logo: (opzionale) carica logo IronFlow
- Application home page: `https://tuodominio.com`
- Application privacy policy: `https://tuodominio.com/privacy`
- Application terms of service: `https://tuodominio.com/terms`
- Authorized domains: `tuodominio.com`
- Developer contact: `tua-email@example.com`

4. Click "Save and Continue"

**Scopes:**
1. Click "Add or Remove Scopes"
2. Aggiungi questi scopes:
   - `https://www.googleapis.com/auth/fitness.activity.read`
   - `https://www.googleapis.com/auth/fitness.body.read`
   - `https://www.googleapis.com/auth/fitness.heart_rate.read`
   - `https://www.googleapis.com/auth/fitness.sleep.read`
   - `https://www.googleapis.com/auth/fitness.nutrition.read`
3. Click "Update"
4. Click "Save and Continue"

**Test Users (per sviluppo):**
1. Aggiungi il tuo email come test user
2. Click "Save and Continue"

### 4. Crea Credenziali OAuth 2.0

1. Vai su "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Application type: "Web application"
4. Name: `IronFlow Web Client`

**Authorized JavaScript origins:**
```
https://tuodominio.com
http://localhost:5000
http://localhost:8080
http://127.0.0.1:5000
```

**Authorized redirect URIs:**
```
https://tuodominio.com/auth-callback.html
http://localhost:5000/auth-callback.html
http://localhost:8080/auth-callback.html
```

5. Click "Create"
6. **IMPORTANTE**: Copia il Client ID e Client Secret

### 5. Configura IronFlow

Apri `js/health-connect-service.js` e aggiorna:

```javascript
this.clientId = 'TUO_CLIENT_ID_QUI';
```

**NOTA SICUREZZA**: Il Client Secret NON deve essere nel codice client-side!
Opzioni:
1. **Opzione A (Semplice ma meno sicura)**: Usa solo Client ID senza secret per app pubblica
2. **Opzione B (Raccomandata)**: Implementa backend proxy con Firebase Functions

### 6. Implementa Backend Proxy (Opzione Raccomandata)

#### Setup Firebase Functions

```bash
# Installa Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Inizializza Functions
firebase init functions

# Seleziona JavaScript
# Installa dipendenze
cd functions
npm install googleapis
```

#### Crea Function per OAuth

`functions/index.js`:
```javascript
const functions = require('firebase-functions');
const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  functions.config().google.client_id,
  functions.config().google.client_secret,
  'https://tuodominio.com/auth-callback.html'
);

// Exchange code for tokens
exports.exchangeOAuthCode = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  
  try {
    const { code } = data;
    const { tokens } = await oauth2Client.getToken(code);
    
    // Salva tokens in Firestore (encrypted)
    const admin = require('firebase-admin');
    await admin.firestore()
      .collection('users')
      .doc(context.auth.uid)
      .collection('private')
      .doc('healthToken')
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    
    return { success: true };
  } catch (error) {
    console.error('Error exchanging code:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// Refresh token
exports.refreshHealthToken = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  
  try {
    const admin = require('firebase-admin');
    const tokenDoc = await admin.firestore()
      .collection('users')
      .doc(context.auth.uid)
      .collection('private')
      .doc('healthToken')
      .get();
    
    if (!tokenDoc.exists) {
      throw new Error('No token found');
    }
    
    const { refreshToken } = tokenDoc.data();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    await tokenDoc.ref.update({
      accessToken: credentials.access_token,
      expiryDate: credentials.expiry_date,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
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

// Sync automatica schedulata
exports.syncHealthData = functions.pubsub
  .schedule('every 6 hours')
  .onRun(async (context) => {
    const admin = require('firebase-admin');
    const fitness = google.fitness('v1');
    
    // Get tutti gli utenti con health connect abilitato
    const usersSnapshot = await admin.firestore()
      .collection('users')
      .where('healthConnectEnabled', '==', true)
      .get();
    
    for (const userDoc of usersSnapshot.docs) {
      try {
        const tokenDoc = await userDoc.ref
          .collection('private')
          .doc('healthToken')
          .get();
        
        if (!tokenDoc.exists) continue;
        
        const { accessToken, refreshToken } = tokenDoc.data();
        oauth2Client.setCredentials({
          access_token: accessToken,
          refresh_token: refreshToken
        });
        
        // Fetch dati ultimi 7 giorni
        const endTime = Date.now() * 1000000; // nanoseconds
        const startTime = (Date.now() - 7 * 24 * 60 * 60 * 1000) * 1000000;
        
        // Fetch steps
        const stepsResponse = await fitness.users.dataSources.datasets.get({
          auth: oauth2Client,
          userId: 'me',
          dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps',
          datasetId: `${startTime}-${endTime}`
        });
        
        // Process e salva dati...
        // (implementazione completa nel servizio)
        
        console.log(`Synced health data for user ${userDoc.id}`);
      } catch (error) {
        console.error(`Error syncing user ${userDoc.id}:`, error);
      }
    }
    
    return null;
  });
```

#### Configura Secrets

```bash
# Set client ID e secret
firebase functions:config:set google.client_id="TUO_CLIENT_ID"
firebase functions:config:set google.client_secret="TUO_CLIENT_SECRET"

# Deploy functions
firebase deploy --only functions
```

### 7. Aggiorna Firestore Rules

`firestore.rules`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Health data rules
    match /users/{userId}/health/{healthId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Private health tokens
    match /users/{userId}/private/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Deploy rules:
```bash
firebase deploy --only firestore:rules
```

### 8. Test Integrazione

1. Apri IronFlow in locale: `http://localhost:5000`
2. Vai su Profilo → Impostazioni
3. Click "Connetti Google Fit"
4. Autorizza l'app
5. Verifica che i dati vengano sincronizzati

### 9. Pubblicazione (Verifica Google)

Prima di pubblicare in produzione:

1. **Completa OAuth Consent Screen**:
   - Aggiungi privacy policy completa
   - Aggiungi terms of service
   - Spiega chiaramente perché usi i dati fitness

2. **Richiedi Verifica**:
   - Vai su OAuth consent screen
   - Click "Publish App"
   - Compila il questionario di verifica
   - Attendi approvazione Google (1-2 settimane)

3. **Durante la verifica**, l'app funziona solo per:
   - Test users aggiunti manualmente
   - Massimo 100 utenti

4. **Dopo la verifica**:
   - App disponibile per tutti
   - Nessun limite utenti

### 10. Monitoraggio

#### Dashboard Google Cloud

Monitora:
- Quota API usage
- Errori
- Latenza

#### Firebase Console

Monitora:
- Function invocations
- Errors
- Logs

### Troubleshooting

#### Errore: "Access blocked: This app's request is invalid"
- Verifica che gli Authorized redirect URIs siano corretti
- Controlla che il dominio sia autorizzato

#### Errore: "Invalid grant"
- Token scaduto, implementa refresh token logic
- Verifica che il refresh token sia salvato correttamente

#### Errore: "Insufficient permissions"
- Verifica che tutti gli scopes siano richiesti
- Controlla OAuth consent screen configuration

#### Dati non sincronizzati
- Verifica che l'utente abbia dati in Google Fit
- Controlla i logs delle Firebase Functions
- Verifica che i data source IDs siano corretti

### Costi Stimati

**Google Fit API**: Gratuito
- Quota: 1M richieste/giorno
- Nessun costo per uso normale

**Firebase Functions**:
- Free tier: 2M invocazioni/mese
- Stima: 120K invocazioni/mese per 1000 utenti
- Costo: $0 (dentro free tier)

**Firestore**:
- Reads: ~1M/mese per 1000 utenti
- Writes: ~120K/mese
- Storage: ~150MB
- Costo totale: ~$1-2/mese

**Totale: Praticamente gratuito fino a migliaia di utenti**

### Risorse

- [Google Fit API Documentation](https://developers.google.com/fit)
- [OAuth 2.0 for Web Apps](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Firebase Functions](https://firebase.google.com/docs/functions)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
