# Terra API Setup Guide (Apple Health Integration)

## Overview

Terra API permette di integrare Apple Health (iOS) nella tua app web. Questo è necessario perché Apple Health non ha API web native - richiede un'app bridge.

## Free Tier Limits

- **10 utenti connessi** gratuitamente
- Perfetto per progetti universitari, demo, o MVP

## Setup Steps

### 1. Crea Account Terra

1. Vai su [https://dashboard.tryterra.co](https://dashboard.tryterra.co)
2. Registrati con email
3. Crea un nuovo progetto

### 2. Ottieni Credenziali

Dal dashboard Terra:
- **Dev ID**: Visibile nella sezione "API Keys"
- **API Key**: Genera una nuova API key

### 3. Configura Webhook (Opzionale ma Consigliato)

Nel dashboard Terra, configura il webhook URL:
```
https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/terraWebhook
```

Questo permette a Terra di inviare automaticamente i dati quando disponibili.

### 4. Salva Credenziali in Firestore

Opzione A - Via Console Firebase:
1. Vai su Firestore Database
2. Crea documento: `config/terra`
3. Aggiungi campi:
   - `devId`: "il-tuo-dev-id"
   - `apiKey`: "la-tua-api-key"

Opzione B - Via Environment Variables (Firebase Functions):
```bash
# Nel file functions/.env
TERRA_DEV_ID=il-tuo-dev-id
TERRA_API_KEY=la-tua-api-key
```

### 5. Deploy Firebase Functions

```bash
cd functions
npm install node-fetch
firebase deploy --only functions
```

## Come Funziona

### Flusso Utente iOS:

1. Utente clicca "Connetti Apple Health" nell'app
2. Si apre il widget Terra (pagina web)
3. Utente seleziona Apple Health
4. Viene reindirizzato all'App Store per scaricare l'app Terra (se non installata)
5. Autorizza l'accesso ai dati nell'app Terra
6. Torna all'app IronFlow
7. Clicca "Verifica Connessione"
8. Dati sincronizzati!

### Dati Disponibili da Apple Health:

| Dato | Descrizione |
|------|-------------|
| Steps | Passi giornalieri |
| Heart Rate | Frequenza cardiaca media |
| Resting HR | FC a riposo |
| HRV | Variabilità frequenza cardiaca |
| Sleep | Ore di sonno |
| Calories | Calorie bruciate |
| Distance | Distanza percorsa |
| Weight | Peso corporeo |
| Body Fat | Percentuale grasso |
| VO2 Max | Capacità aerobica |
| SpO2 | Saturazione ossigeno |

## Conflitto Provider

L'app impedisce di connettere sia Google Fit che Apple Health contemporaneamente per evitare dati duplicati o conflittuali.

- Se connesso a Google Fit → Deve disconnettersi prima di usare Apple Health
- Se connesso ad Apple Health → Deve disconnettersi prima di usare Google Fit

## Troubleshooting

### "Terra API credentials not configured"
- Verifica che `config/terra` esista in Firestore
- Verifica che contenga `devId` e `apiKey`

### "User not yet connected"
- L'utente deve completare l'autorizzazione nell'app Terra sul telefono
- Assicurarsi che l'app Terra sia installata e autorizzata

### Dati non sincronizzati
- Verificare che l'app Terra sia in background sul telefono
- I dati possono richiedere alcuni minuti per sincronizzarsi
- Provare "Sincronizza Ora" manualmente

## Costi

| Piano | Utenti | Prezzo |
|-------|--------|--------|
| Free | 10 | $0/mese |
| Starter | 100 | $49/mese |
| Growth | 1000 | $199/mese |

Per progetti universitari o demo, il piano Free è sufficiente.

## Links Utili

- [Terra Documentation](https://docs.tryterra.co/)
- [Terra Dashboard](https://dashboard.tryterra.co/)
- [Supported Providers](https://docs.tryterra.co/docs/integrations-summary)
