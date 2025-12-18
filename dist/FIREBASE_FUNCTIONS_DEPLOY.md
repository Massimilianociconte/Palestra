# 🚀 Deploy Firebase Functions per Health Connect

## Setup Iniziale (Una Volta Sola)

### 1. Installa Firebase CLI

```bash
npm install -g firebase-tools
```

### 2. Login Firebase

```bash
firebase login
```

### 3. Inizializza Progetto (se non già fatto)

```bash
firebase init
```

Seleziona:
- ✅ Functions
- ✅ Firestore (se non già fatto)
- Progetto: `ironflow-a9bc9`
- Linguaggio: JavaScript
- ESLint: No (opzionale)
- Installa dipendenze: Yes

### 4. Configura Secrets

Imposta il Client ID e Client Secret di Google:

```bash
firebase functions:config:set google.client_id="254296220548-ucevne2u3r2t8pga65b4jbcdj91jneec.apps.googleusercontent.com"

firebase functions:config:set google.client_secret="IL_TUO_CLIENT_SECRET_QUI"

firebase functions:config:set google.redirect_uri="https://atomiksnip3r04.github.io/Palestra/auth-callback.html"
```

**IMPORTANTE**: Sostituisci `IL_TUO_CLIENT_SECRET_QUI` con il tuo vero Client Secret dalla Google Cloud Console.

### 5. Installa Dipendenze

```bash
cd functions
npm install
cd ..
```

## Deploy Functions

### Deploy Tutte le Functions

```bash
firebase deploy --only functions
```

### Deploy Singola Function

```bash
firebase deploy --only functions:exchangeHealthCode
firebase deploy --only functions:refreshHealthToken
firebase deploy --only functions:syncHealthData
```

## Verifica Deploy

Dopo il deploy, dovresti vedere:

```
✔  functions[exchangeHealthCode(us-central1)] Successful create operation.
✔  functions[refreshHealthToken(us-central1)] Successful create operation.
✔  functions[syncHealthData(us-central1)] Successful create operation.
```

## Test Functions

### Test Locale (Emulator)

```bash
firebase emulators:start --only functions
```

### Test in Produzione

1. Vai su https://atomiksnip3r04.github.io/Palestra/user.html
2. Click "Connetti Google Fit"
3. Autorizza l'app
4. Verifica che appaia "✅ Connesso"

## Monitoring

### Visualizza Logs

```bash
firebase functions:log
```

### Logs Specifici

```bash
firebase functions:log --only exchangeHealthCode
```

### Dashboard Firebase Console

Vai su: https://console.firebase.google.com/project/ironflow-a9bc9/functions

Qui puoi vedere:
- Invocazioni
- Errori
- Tempo di esecuzione
- Logs in tempo reale

## Costi

### Free Tier (Spark Plan)
- ❌ Non supporta chiamate esterne (Google APIs)
- ❌ Non puoi usare googleapis

### Blaze Plan (Pay as you go)
- ✅ Necessario per chiamare Google Fit API
- ✅ Free tier incluso:
  - 2M invocazioni/mese
  - 400K GB-secondi
  - 200K CPU-secondi
  - 5GB rete in uscita

**Costo stimato per IronFlow**:
- 1000 utenti attivi
- 4 sync/giorno automatiche
- ~120K invocazioni/mese
- **Costo: $0** (dentro free tier)

### Upgrade a Blaze Plan

```bash
# Vai su Firebase Console
https://console.firebase.google.com/project/ironflow-a9bc9/usage

# Click "Modify plan" → "Blaze"
# Aggiungi carta di credito (non verrà addebitato nulla se resti nel free tier)
```

## Troubleshooting

### Errore: "Missing required config"

```bash
# Verifica config
firebase functions:config:get

# Dovrebbe mostrare:
{
  "google": {
    "client_id": "...",
    "client_secret": "...",
    "redirect_uri": "..."
  }
}
```

### Errore: "Billing account not configured"

Devi abilitare Blaze Plan (vedi sopra).

### Errore: "Permission denied"

Verifica Firestore Rules:

```javascript
// firestore.rules
match /users/{userId}/private/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

### Function Timeout

Se la sync impiega troppo tempo:

```javascript
// In functions/index.js
exports.syncHealthData = functions
  .runWith({ timeoutSeconds: 540 }) // 9 minuti max
  .pubsub.schedule('every 6 hours')
  .onRun(async (context) => {
    // ...
  });
```

## Aggiornamenti

### Aggiorna Dipendenze

```bash
cd functions
npm update
cd ..
```

### Redeploy Dopo Modifiche

```bash
firebase deploy --only functions
```

## Sicurezza

### Best Practices

1. ✅ **Mai committare secrets** - Usa `functions:config:set`
2. ✅ **Verifica auth** - Tutte le functions controllano `context.auth`
3. ✅ **Firestore Rules** - Proteggi la collezione `private`
4. ✅ **Rate limiting** - Firebase lo gestisce automaticamente
5. ✅ **Logs** - Non loggare dati sensibili

### Firestore Rules Sicure

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Health tokens (privati)
    match /users/{userId}/private/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Health data
    match /users/{userId}/health/{healthId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // User settings
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Deploy rules:

```bash
firebase deploy --only firestore:rules
```

## Conclusione

Dopo il deploy, l'integrazione Health Connect funzionerà con:
- ✅ Token che non scadono mai (refresh automatico)
- ✅ Sincronizzazione automatica ogni 6 ore
- ✅ Completamente gratuito (fino a migliaia di utenti)
- ✅ Sicuro (Client Secret server-side)

Buon deploy! 🚀
