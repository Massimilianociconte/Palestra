# ✅ Checklist Test Google Fit

## Pre-requisiti
- [ ] Sei loggato su `user.html`
- [ ] Hai aperto DevTools (F12) > Console
- [ ] Hai cancellato la cache (Ctrl+F5)

## Test 1: Verifica Configurazione
Apri: `https://atomiksnip3r04.github.io/Palestra/test-oauth-config.html`

- [ ] La pagina mostra la configurazione OAuth
- [ ] Client ID è visibile e corretto
- [ ] Redirect URI è corretto

## Test 2: Connessione Google Fit
Su `user.html`, sezione "Connessione Salute":

### Prima della connessione:
- [ ] Stato mostra: "Non connesso"
- [ ] Bottone visibile: "🔗 Connetti Google Fit"
- [ ] Bottoni nascosti: "Sincronizza Ora", "Disconnetti"

### Durante la connessione:
- [ ] Click su "Connetti Google Fit"
- [ ] Si apre popup OAuth di Google
- [ ] Selezioni l'account Google
- [ ] Autorizzi i permessi richiesti
- [ ] Il popup si chiude automaticamente

### Dopo la connessione:
- [ ] Appare alert: "✅ Connesso con successo!"
- [ ] Stato mostra: "✅ Connesso a Google Fit" (verde)
- [ ] Bottone nascosto: "Connetti Google Fit"
- [ ] Bottoni visibili: "🔄 Sincronizza Ora", "❌ Disconnetti"
- [ ] Mostra "Ultimo sync: [data/ora]"

## Test 3: Verifica Console
Nella console DevTools, dovresti vedere:

```
✅ Auth code exchanged successfully
✅ Health token loaded successfully, expires: [data]
✅ Health Connect is now connected
✅ Starting health data sync for last 7 days
✅ Health data saved successfully
```

**NON dovresti vedere:**
```
❌ 403 Forbidden
❌ Failed to load token
❌ Token expired
```

## Test 4: Verifica Stato Programmatico
Nella console, esegui:

```javascript
import('./js/health-connect-service.js').then(({ healthConnectService }) => {
  healthConnectService.getStatus().then(status => {
    console.log('Status:', status);
    console.log('✅ Connected:', status.isConnected);
    console.log('✅ Has Token:', status.hasToken);
    console.log('✅ Token Valid:', status.tokenValid);
  });
});
```

**Risultato atteso:**
```
Status: {isConnected: true, hasToken: true, tokenExpiry: 1732467890000, tokenValid: true}
✅ Connected: true
✅ Has Token: true
✅ Token Valid: true
```

## Test 5: Verifica Firestore
Firebase Console > Firestore:

- [ ] Naviga a: `users/{tuo-uid}/private/healthToken`
- [ ] Documento esiste
- [ ] Campo `accessToken` presente (stringa lunga ~200 caratteri)
- [ ] Campo `refreshToken` presente (stringa lunga ~100 caratteri)
- [ ] Campo `expiryDate` presente (numero timestamp)
- [ ] Campo `scope` presente (contiene "fitness.activity.read" etc.)
- [ ] Campo `updatedAt` presente (timestamp recente)

## Test 6: Sincronizzazione Manuale
Su `user.html`:

- [ ] Click su "🔄 Sincronizza Ora"
- [ ] Bottone mostra "⏳ Sincronizzazione..."
- [ ] Dopo pochi secondi: alert "✅ Dati sincronizzati con successo!"
- [ ] "Ultimo sync" si aggiorna con l'ora corrente
- [ ] Nessun errore 403 nella console

## Test 7: Verifica Dati Salvati
Firebase Console > Firestore:

- [ ] Naviga a: `users/{tuo-uid}/health/{data-odierna}`
- [ ] Documento esiste
- [ ] Campi presenti (alcuni potrebbero essere null se non hai dati):
  - `steps` (formato TOON: "S|numero|data|steps")
  - `heartRate` (formato TOON)
  - `weight` (formato TOON)
  - `calories` (formato TOON)
  - `distance` (formato TOON)
  - `sleep` (formato TOON)
  - `syncTimestamp` (timestamp)
  - `source` ("google_fit")

## Test 8: Disconnessione
Su `user.html`:

- [ ] Click su "❌ Disconnetti"
- [ ] Conferma nel popup
- [ ] Alert: "✅ Disconnesso con successo"
- [ ] Stato torna a: "Non connesso"
- [ ] Bottone torna a: "🔗 Connetti Google Fit"
- [ ] Altri bottoni nascosti

## Test 9: Riconnessione
- [ ] Ricarica la pagina (F5)
- [ ] Dopo il caricamento, lo stato dovrebbe essere "Non connesso"
- [ ] Riconnetti seguendo Test 2
- [ ] Tutto funziona come prima

## Test 10: Persistenza
- [ ] Connetti Google Fit
- [ ] Chiudi il browser completamente
- [ ] Riapri il browser
- [ ] Vai su `user.html`
- [ ] Effettua login se necessario
- [ ] **Aspetta 1-2 secondi** per il caricamento
- [ ] Lo stato dovrebbe mostrare: "✅ Connesso a Google Fit"
- [ ] I bottoni dovrebbero essere corretti (Sincronizza/Disconnetti visibili)

## 🐛 Se qualcosa non funziona

### UI non si aggiorna dopo connessione
1. Apri console e cerca errori
2. Esegui Test 4 (verifica stato programmatico)
3. Se lo stato è `isConnected: true` ma l'UI non si aggiorna:
   - Forza refresh: Ctrl+F5
   - Cancella cache: DevTools > Application > Clear storage

### Errore 403 durante sincronizzazione
1. Verifica che l'API Fitness sia abilitata:
   - Google Cloud Console > API & Services > Library
   - Cerca "Fitness API"
   - Deve essere "Enabled"
2. Verifica i log: `firebase functions:log`
3. Prova a disconnettere e riconnettere

### Token non viene salvato
1. Verifica Firestore Rules
2. Verifica log Firebase Functions: `firebase functions:log`
3. Cerca errori nella console del browser

### Popup OAuth non si chiude
1. Verifica che `auth-callback.html` sia accessibile
2. Verifica la console del popup per errori
3. Chiudi manualmente e riprova

## 📊 Risultato Finale Atteso

✅ **Tutto funziona se:**
- Lo stato UI si aggiorna correttamente dopo la connessione
- Nessun errore 403 nella console
- I dati vengono salvati in Firestore
- La connessione persiste dopo il reload della pagina
- La sincronizzazione manuale funziona senza errori

## 📝 Note

- Il token di accesso scade dopo 1 ora, ma viene automaticamente refreshato
- La sincronizzazione automatica avviene ogni 6 ore (Cloud Scheduler)
- I dati sono in formato TOON per compatibilità con l'AI
- Tutti i passaggi sono loggati nella console per debug

## 🎯 Prossimo Test (Opzionale)

Dopo 1 ora dalla connessione:
- [ ] Vai su `user.html`
- [ ] Click su "Sincronizza Ora"
- [ ] Verifica che funzioni (dovrebbe fare auto-refresh del token)
- [ ] Controlla console per log: "403 error - attempting token refresh"
- [ ] Verifica che la sincronizzazione completi con successo
