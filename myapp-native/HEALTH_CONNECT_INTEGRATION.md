# 🏥 Integrazione Health Connect / Google Fit per IronFlow

## Panoramica

Integrazione completa dei dati salute da Google Fit/Health Connect in IronFlow per arricchire l'analisi AI con metriche biometriche e di attività fisica.

## Architettura

### Problema: PWA vs Native
- **IronFlow** è una Progressive Web App (PWA)
- **Health Connect** richiede app Android nativa (Kotlin/Java)
- **Soluzione**: Usare Google Fit REST API per web + OAuth 2.0

### Stack Tecnologico
1. **Google Fit REST API** - Accesso web ai dati fitness
2. **OAuth 2.0** - Autenticazione sicura
3. **Firebase Functions** - Sincronizzazione automatica server-side
4. **TOON Format** - Encoding compatto dei dati health
5. **Firestore** - Storage dati sincronizzati

## Google Fit REST API

### Scopes Necessari (Gratuiti)
```
https://www.googleapis.com/auth/fitness.activity.read
https://www.googleapis.com/auth/fitness.body.read
https://www.googleapis.com/auth/fitness.heart_rate.read
https://www.googleapis.com/auth/fitness.sleep.read
https://www.googleapis.com/auth/fitness.nutrition.read
```

### Dati Disponibili
- **Attività**: Passi, distanza, calorie, tipo attività
- **Corpo**: Peso, altezza, BMI, grasso corporeo
- **Cardio**: Frequenza cardiaca, HRV
- **Sonno**: Durata, qualità, fasi
- **Nutrizione**: Calorie, macro (se tracciato)

## Formato TOON per Dati Health

### Struttura TOON Health Data
```javascript
{
  "healthData": {
    // Formato TOON: tipo|valore|timestamp|unità
    "steps": "S|8543|20231123|steps",
    "heartRate": "HR|72|20231123T14:30|bpm",
    "weight": "W|75.5|20231123|kg",
    "sleep": "SL|7.5|20231123|hours",
    "calories": "C|2340|20231123|kcal",
    "distance": "D|6.2|20231123|km",
    "activeMinutes": "AM|45|20231123|min"
  },
  "syncTimestamp": 1700745600000,
  "source": "google_fit"
}
```

### Encoding TOON Compatto
```
Formato: [tipo][valore][timestamp][unità]
Separatore: |

Tipi:
S = Steps (Passi)
HR = Heart Rate (Frequenza cardiaca)
W = Weight (Peso)
SL = Sleep (Sonno)
C = Calories (Calorie)
D = Distance (Distanza)
AM = Active Minutes (Minuti attivi)
HRV = Heart Rate Variability
BF = Body Fat % (Grasso corporeo)
BMI = Body Mass Index
```

## Implementazione

### 1. Setup Google Cloud Project

```bash
# 1. Vai su https://console.cloud.google.com
# 2. Crea nuovo progetto "IronFlow Health"
# 3. Abilita Google Fit API
# 4. Crea credenziali OAuth 2.0 per Web Application
# 5. Aggiungi Authorized JavaScript origins:
#    - https://tuodominio.com
#    - http://localhost:5000 (per sviluppo)
# 6. Aggiungi Authorized redirect URIs:
#    - https://tuodominio.com/auth/callback
```

### 2. File: `js/health-connect-service.js`

Servizio per gestire l'integrazione con Google Fit.

### 3. File: `js/health-toon-encoder.js`

Encoder/decoder per formato TOON dei dati health.

### 4. Firebase Functions per Sync Automatica

```javascript
// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { google } = require('googleapis');

// Sync automatica ogni 6 ore
exports.syncHealthData = functions.pubsub
  .schedule('every 6 hours')
  .onRun(async (context) => {
    const users = await admin.firestore()
      .collection('users')
      .where('healthConnectEnabled', '==', true)
      .get();
    
    for (const userDoc of users.docs) {
      await syncUserHealthData(userDoc.id);
    }
  });
```

## Flusso Utente

### Prima Configurazione
```
1. Utente va su Profilo → Impostazioni
   ↓
2. Click "Connetti Google Fit"
   ↓
3. OAuth flow → Autorizzazione Google
   ↓
4. Token salvato in Firestore (encrypted)
   ↓
5. Prima sincronizzazione immediata
   ↓
6. Sync automatica ogni 6 ore
```

### Utilizzo Dati nell'AI

I dati health vengono automaticamente inclusi nei report AI:

```javascript
// Esempio context AI arricchito
const aiContext = {
  workouts: toonWorkouts,
  prs: toonPRs,
  health: {
    avgSteps: "S|8234|7d|steps",
    avgHR: "HR|68|7d|bpm",
    sleep: "SL|7.2|7d|hours",
    weight: "W|75.5|latest|kg",
    calories: "C|2400|7d|kcal"
  }
};
```

### Prompt AI Migliorato
```
Analizza l'atleta considerando:
- Workout: {toonWorkouts}
- Salute: Passi medi 8234/giorno, FC riposo 68bpm, Sonno 7.2h/notte
- Peso: 75.5kg stabile
- Calorie: 2400kcal/giorno

Fornisci raccomandazioni olistiche su allenamento, recupero e nutrizione.
```

## Privacy e Sicurezza

### Conformità GDPR
- ✅ Consenso esplicito richiesto
- ✅ Dati criptati at-rest
- ✅ Token OAuth refresh automatico
- ✅ Revoca accesso in qualsiasi momento
- ✅ Export dati completo disponibile
- ✅ Cancellazione dati su richiesta

### Security Best Practices
```javascript
// Token storage (encrypted)
const encryptedToken = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv: iv },
  key,
  encoder.encode(accessToken)
);

// Firestore rules
match /users/{userId}/healthTokens/{tokenId} {
  allow read, write: if request.auth.uid == userId;
}
```

## Metriche Sincronizzate

### Dati Giornalieri
- Passi totali
- Distanza percorsa
- Calorie bruciate
- Minuti attivi
- Frequenza cardiaca (min/max/avg)
- Ore di sonno
- Peso corporeo

### Dati Settimanali (Aggregati)
- Media passi/giorno
- Media sonno/notte
- Trend peso
- Variabilità FC
- Calorie medie

### Dati Mensili
- Progressi peso
- Trend attività
- Pattern sonno
- Evoluzione FC riposo

## Benefici per l'AI

### Analisi Olistica
```
Prima (solo workout):
"Hai fatto 12 workout questo mese, volume 45,000kg"

Dopo (con health data):
"Hai fatto 12 workout con volume 45,000kg. 
I tuoi 9,200 passi/giorno e 7.5h sonno/notte indicano 
buon recupero. FC riposo 65bpm suggerisce ottima forma 
cardiovascolare. Considera aumentare intensità."
```

### Rilevamento Overtraining
```javascript
// AI può rilevare segnali di overtraining
if (health.avgHR > baseline + 10 && 
    health.sleep < 7 && 
    workout.volume > avgVolume * 1.3) {
  warning: "Possibile overtraining - considera deload week"
}
```

### Raccomandazioni Personalizzate
- Suggerimenti recupero basati su sonno
- Timing workout basato su energia (passi/attività)
- Nutrizione basata su calorie bruciate
- Intensità basata su FC riposo

## Limitazioni e Fallback

### Limitazioni Google Fit API
- **Rate Limit**: 25,000 richieste/giorno (più che sufficiente)
- **Quota**: Gratuita fino a 1M richieste/giorno
- **Latenza**: Dati possono avere ritardo 15-30 minuti
- **Storico**: Accesso illimitato allo storico

### Fallback Manuale
Se l'utente non vuole connettere Google Fit:
```javascript
// Input manuale dati health
{
  manualHealthEntry: {
    weight: 75.5,
    sleep: 7.5,
    steps: 8000,
    date: "2023-11-23"
  }
}
```

## Roadmap Implementazione

### Fase 1: Setup Base (Settimana 1)
- [ ] Setup Google Cloud Project
- [ ] Implementare OAuth flow
- [ ] Creare health-connect-service.js
- [ ] Creare health-toon-encoder.js
- [ ] UI per connessione in user.html

### Fase 2: Sincronizzazione (Settimana 2)
- [ ] Implementare sync manuale
- [ ] Firebase Function per sync automatica
- [ ] Storage Firestore per dati health
- [ ] Gestione errori e retry

### Fase 3: Integrazione AI (Settimana 3)
- [ ] Includere dati health in AI context
- [ ] Aggiornare prompt AI
- [ ] Dashboard visualizzazione dati health
- [ ] Grafici trend health

### Fase 4: Features Avanzate (Settimana 4)
- [ ] Rilevamento anomalie
- [ ] Alert overtraining
- [ ] Raccomandazioni personalizzate
- [ ] Export dati completo

## Costi

### Google Fit API
- **Costo**: $0 (completamente gratuito)
- **Quota**: 1M richieste/giorno
- **Stima utilizzo**: ~100 richieste/utente/giorno
- **Capacità**: 10,000 utenti attivi senza costi

### Firebase Functions
- **Free tier**: 2M invocazioni/mese
- **Stima**: 4 sync/giorno × 30 giorni × 1000 utenti = 120K invocazioni
- **Costo**: $0 (dentro free tier)

### Storage Firestore
- **Dati health**: ~5KB/utente/giorno
- **Costo**: ~$0.18/GB/mese
- **1000 utenti**: ~150MB/mese = $0.03/mese

**Totale: Praticamente gratuito per migliaia di utenti**

## Conclusione

L'integrazione Health Connect/Google Fit trasforma IronFlow da semplice tracker workout a **piattaforma olistica di fitness e salute**, fornendo all'AI un quadro completo dell'atleta per raccomandazioni veramente personalizzate e scientificamente fondate.

Il formato TOON garantisce efficienza nella trasmissione e storage dei dati, mentre la sincronizzazione automatica assicura che l'AI abbia sempre i dati più aggiornati per analisi accurate.
