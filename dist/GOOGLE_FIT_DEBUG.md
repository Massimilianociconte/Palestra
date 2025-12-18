# Debug Google Fit Connection

## Problemi Identificati

### 1. Errore 403 Forbidden
L'errore 403 sulle chiamate API di Google Fit indica che l'access token non ha i permessi corretti o è scaduto.

**Possibili cause:**
- Il token non è stato salvato correttamente dopo lo scambio del codice OAuth
- Il token è scaduto e il refresh non funziona
- Gli scope OAuth non sono corretti
- La configurazione Firebase Functions non è corretta

### 2. UI non si aggiorna
Il bottone "Connetti Google Fit" rimane visibile anche dopo la connessione.

**Causa:**
- Il metodo `getStatus()` veniva chiamato prima che i token fossero caricati da Firestore
- L'autenticazione Firebase non era completa quando veniva chiamato `updateStatus()`

## Correzioni Applicate

### 1. Health Connect Service (`js/health-connect-service.js`)

#### a) Costruttore
- **Rimosso** il caricamento automatico dei token nel costruttore
- Aggiunto `tokenLoadPromise` per gestire il caricamento asincrono

#### b) Metodo `getStatus()`
- **Cambiato da sincrono ad asincrono**
- Ora carica i token se non sono già stati caricati
- Aspetta il completamento del caricamento prima di restituire lo stato

#### c) Metodo `loadSavedToken()`
- Aggiunto supporto per `expiryDate` (usato dalla Firebase Function)
- Verifica se il token è scaduto
- Migliore logging

#### d) Metodo `handleAuthCode()`
- Aggiunto delay di 1 secondo dopo lo scambio del codice per assicurarsi che Firestore sia aggiornato
- Verifica che il token sia stato caricato correttamente
- Migliore logging

#### e) Metodo `fetchGoogleFitData()`
- Aggiunto retry automatico in caso di errore 403
- Tenta il refresh del token e riprova la richiesta
- Migliore logging degli errori

#### f) Metodo `syncAllData()`
- Aggiunto logging dettagliato per ogni fase
- Log degli errori per ogni tipo di dato

### 2. User Interface (`user.html`)

#### a) Funzione `updateStatus()`
- **Cambiata per usare `await`** con `getStatus()`
- Aggiunto stato per token scaduto
- Migliore gestione degli errori
- Logging dello stato

#### b) Inizializzazione
- Aggiunto delay di 500ms prima di chiamare `updateStatus()`
- Aggiunto listener per i cambiamenti di autenticazione
- Aggiornamento automatico dello stato quando l'utente si autentica

## Verifica della Configurazione Firebase Functions

### 1. Verifica che le variabili di configurazione siano impostate

```bash
firebase functions:config:get
```

Dovresti vedere:
```json
{
  "google": {
    "client_id": "254296220548-ucevne2u3r2t8pga65b4jbcdj91jneec.apps.googleusercontent.com",
    "client_secret": "YOUR_CLIENT_SECRET",
    "redirect_uri": "https://atomiksnip3r04.github.io/Palestra/auth-callback.html"
  }
}
```

### 2. Se mancano, impostale:

```bash
firebase functions:config:set google.client_id="254296220548-ucevne2u3r2t8pga65b4jbcdj91jneec.apps.googleusercontent.com"
firebase functions:config:set google.client_secret="YOUR_CLIENT_SECRET"
firebase functions:config:set google.redirect_uri="https://atomiksnip3r04.github.io/Palestra/auth-callback.html"
```

### 3. Rideploy delle Functions

```bash
cd functions
npm install googleapis
cd ..
firebase deploy --only functions
```

## Test della Connessione

### 1. Apri la Console del Browser
- Vai su `user.html`
- Apri DevTools (F12)
- Vai alla tab Console

### 2. Clicca su "Connetti Google Fit"
- Dovresti vedere i log:
  - "Auth code exchanged successfully"
  - "Health token loaded successfully, expires: [data]"
  - "Health Connect is now connected"
  - "Starting health data sync for last 7 days"

### 3. Verifica lo Stato
Nella console, esegui:
```javascript
import('./js/health-connect-service.js').then(({ healthConnectService }) => {
  healthConnectService.getStatus().then(status => console.log('Status:', status));
});
```

Dovresti vedere:
```javascript
{
  isConnected: true,
  hasToken: true,
  tokenExpiry: [timestamp],
  tokenValid: true
}
```

### 4. Verifica i Token in Firestore
- Vai su Firebase Console > Firestore
- Naviga a: `users/{userId}/private/healthToken`
- Verifica che ci siano:
  - `accessToken`
  - `refreshToken`
  - `expiryDate`
  - `scope`

## Risoluzione Problemi Comuni

### Problema: Errore 403 persiste
**Soluzione:**
1. Verifica che gli scope OAuth siano corretti nella Google Cloud Console
2. Revoca l'accesso e riconnetti: https://myaccount.google.com/permissions
3. Verifica che il Client Secret sia corretto nelle Firebase Functions config

### Problema: Token non viene salvato
**Soluzione:**
1. Verifica i log delle Firebase Functions:
   ```bash
   firebase functions:log
   ```
2. Verifica le regole Firestore per la collezione `private`

### Problema: UI non si aggiorna
**Soluzione:**
1. Forza un refresh della pagina (Ctrl+F5)
2. Verifica nella console che `updateStatus()` venga chiamato
3. Verifica che l'utente sia autenticato

## Regole Firestore Necessarie

Assicurati che le regole Firestore permettano l'accesso alla collezione `private`:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      
      match /private/{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
      
      match /health/{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

## Prossimi Passi

1. **Testa la connessione** seguendo i passi sopra
2. **Verifica i log** nella console del browser
3. **Verifica i log** delle Firebase Functions
4. **Verifica Firestore** che i token siano salvati
5. **Se l'errore 403 persiste**, verifica la configurazione OAuth nella Google Cloud Console

## Note Importanti

- Il token di accesso scade dopo 1 ora
- Il refresh token dovrebbe essere permanente (fino a revoca)
- La sincronizzazione automatica avviene ogni 6 ore tramite Cloud Scheduler
- I dati vengono salvati in formato TOON per compatibilità con l'AI
