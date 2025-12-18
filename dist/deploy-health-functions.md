# Deploy Firebase Functions per Health Connect

## Credenziali OAuth

Le credenziali OAuth sono state verificate dal file JSON ufficiale di Google Cloud e configurate correttamente.

**Nota**: Le credenziali sono sensibili e non devono essere condivise pubblicamente.

## Metodo 1: Usando .env (Raccomandato - Nuovo Sistema)

### 1. Il file `.env` è già stato creato in `functions/.env`

```env
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=https://your-domain.github.io/your-repo/auth-callback.html
```

**Nota**: Sostituisci i placeholder con le tue credenziali reali dal file JSON di Google Cloud.

### 2. Deploy delle Functions

```bash
# Installa dipendenze
cd functions
npm install

# Torna alla root
cd ..

# Deploy
firebase deploy --only functions
```

## Metodo 2: Usando functions.config (Sistema Legacy - Già Configurato)

La configurazione legacy è già presente e funzionante:

```bash
firebase functions:config:get
```

Output:
```json
{
  "google": {
    "client_id": "your_client_id.apps.googleusercontent.com",
    "client_secret": "your_client_secret",
    "redirect_uri": "https://your-domain/auth-callback.html"
  }
}
```

## Test della Configurazione

### 1. Test Locale (Opzionale)

```bash
# Avvia emulatore
firebase emulators:start --only functions

# In un altro terminale, testa la function
curl -X POST http://localhost:5001/ironflow-a9bc9/us-central1/exchangeHealthCode \
  -H "Content-Type: application/json" \
  -d '{"data":{"code":"test"}}'
```

### 2. Test in Produzione

Apri il file `test-oauth-config.html` nel browser:

```
https://atomiksnip3r04.github.io/Palestra/test-oauth-config.html
```

Esegui i test nell'ordine:
1. **Testa Flusso OAuth** - Verifica che il popup OAuth si apra correttamente
2. **Testa Firebase Function** - Verifica che la function sia raggiungibile
3. **Verifica Stato Health Connect** - Controlla lo stato della connessione
4. **Testa Caricamento Token** - Verifica che i token siano salvati in Firestore

## Verifica Deploy

Dopo il deploy, verifica che le functions siano attive:

```bash
firebase functions:list
```

Dovresti vedere:
- `exchangeHealthCode`
- `refreshHealthToken`
- `syncHealthData`

## Log delle Functions

Per vedere i log in tempo reale:

```bash
firebase functions:log --only exchangeHealthCode
```

O per tutti i log:

```bash
firebase functions:log
```

## Troubleshooting

### Errore: "Missing OAuth2 configuration"

**Soluzione**: Assicurati che il file `.env` sia presente in `functions/.env` oppure che la configurazione legacy sia impostata.

### Errore: "invalid_grant" durante lo scambio del code

**Possibili cause**:
1. Il code OAuth è già stato usato (i code sono monouso)
2. Il code è scaduto (scadono dopo 10 minuti)
3. Il redirect_uri non corrisponde

**Soluzione**: Riprova la connessione da capo.

### Errore 403 sulle API Google Fit

**Possibili cause**:
1. Token scaduto
2. Scope OAuth non corretti
3. API Google Fit non abilitata nel progetto

**Soluzione**:
1. Verifica che l'API Google Fit sia abilitata nella Google Cloud Console
2. Verifica gli scope nella configurazione OAuth
3. Prova a disconnettere e riconnettere

## Verifica API Google Fit

Vai su Google Cloud Console:
1. Seleziona il progetto `ironflow-479119`
2. Vai su "API e servizi" > "Libreria"
3. Cerca "Fitness API"
4. Assicurati che sia abilitata

## Prossimi Passi

1. **Deploy delle Functions**:
   ```bash
   firebase deploy --only functions
   ```

2. **Testa la connessione** usando `test-oauth-config.html`

3. **Verifica i log** per eventuali errori

4. **Testa la sincronizzazione** dei dati da `user.html`

## Note Importanti

- Il file `.env` NON deve essere committato su Git (è già in `.gitignore`)
- Le credenziali sono sensibili - non condividerle pubblicamente
- Il code delle Functions ora supporta sia `.env` che `functions.config()` per retrocompatibilità
- La migrazione a `.env` è raccomandata perché `functions.config()` sarà deprecato a marzo 2026
