# Health Auto Export - Integrazione Apple Health

## Panoramica

Questa integrazione permette agli utenti iOS di sincronizzare automaticamente i dati di Apple Health con la webapp tramite l'app **Health Auto Export**.

### Costi
- **App**: €2.99 (acquisto una tantum) o €4.99/anno per Premium
- **Backend**: Gratuito (usa Firebase Functions esistenti)

### Dati supportati
- Steps (passi)
- Heart Rate (frequenza cardiaca)
- Sleep (sonno)
- Active Calories (calorie attive)
- Distance (distanza)
- Workouts (allenamenti)
- HRV (variabilità cardiaca)
- Resting Heart Rate
- Blood Oxygen (SpO2)
- Weight (peso)

---

## Setup per gli Utenti

### 1. Scarica l'app
[Health Auto Export - App Store](https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069)

### 2. Configura nell'app
1. Apri l'app e concedi accesso a Apple Health
2. Vai su **Automations** → **Create new**
3. Seleziona i dati da esportare
4. Imposta **Destination**: `REST API`
5. Configura:
   - **URL**: `https://us-central1-<PROJECT_ID>.cloudfunctions.net/healthAutoExportWebhook`
   - **Method**: `POST`
   - **Headers**:
     - `x-user-id`: Il tuo Firebase User ID
     - `x-api-key`: La chiave API fornita dalla webapp
6. Imposta frequenza: ogni ora o ogni giorno
7. Salva e attiva

### 3. Verifica
Nella webapp, vai su Impostazioni → Apple Health → Verifica Connessione

---

## Setup Tecnico (Sviluppatori)

### Firebase Functions

L'endpoint webhook è già configurato in `functions/index.js`:

```javascript
exports.healthAutoExportWebhook = functions.https.onRequest(...)
```

### Deploy

```bash
cd functions
npm install
firebase deploy --only functions:healthAutoExportWebhook,functions:getHealthAutoExportSetup
```

### Configurazione API Key

L'API key viene generata automaticamente e salvata in Firestore:
- Collection: `config`
- Document: `healthAutoExport`
- Field: `apiKey`

### Frontend Service

Includi il servizio nella pagina:

```html
<script src="js/health-auto-export-service.js"></script>
```

Uso:

```javascript
// Mostra modal di setup
await healthAutoExportService.showSetupModal();

// Verifica connessione
await healthAutoExportService.verifyConnection();

// Ottieni dati
const data = await healthAutoExportService.getLatestHealthData(7);
```

---

## Formato Dati

I dati vengono salvati in Firestore con questo formato:

```
users/{userId}/health/{date}
```

Esempio documento:

```json
{
  "steps": "S|8234|20251125|steps",
  "stepsRaw": 8234,
  "heartRate": "HR|72|58|120|20251125|bpm",
  "heartRateRaw": { "avg": 72, "min": 58, "max": 120 },
  "sleep": "SL|7.5|90|45|20251125|hours",
  "sleepRaw": { "totalHours": 7.5, "deepMinutes": 90, "remMinutes": 45 },
  "source": "apple_health_auto_export",
  "appleHealthLastUpdate": "2025-11-25T14:30:00Z"
}
```

---

## Troubleshooting

### Dati non arrivano
1. Verifica che l'automazione sia attiva nell'app
2. Controlla URL e headers
3. Verifica i log in Firebase Console → Functions

### Errore 401 Unauthorized
- API key non corretta
- Rigenera la chiave dalla webapp

### Errore 404 User not found
- User ID non valido
- L'utente deve essere registrato nella webapp

---

## Vantaggi rispetto a Terra API

| Feature | Health Auto Export | Terra API |
|---------|-------------------|-----------|
| Costo | €2.99 una tantum | $400/mese |
| Setup | Semplice | Complesso |
| Dati iOS | ✅ Completi | ✅ Completi |
| Dati Android | ❌ | ✅ |
| Webhook | ✅ | ✅ |
| Free tier | ✅ (app a pagamento) | ❌ |
