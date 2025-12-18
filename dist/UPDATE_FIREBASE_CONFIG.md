# 🔄 Aggiornamento Configurazione Firebase Functions

## ✅ Completato
- [x] Aggiornato `js/health-connect-service.js` con nuovo Client ID
- [x] Aggiornato `functions/.env` con nuove credenziali OAuth
- [x] Aggiornato documentazione (GOOGLE_FIT_DEBUG.md, FIREBASE_FUNCTIONS_DEPLOY.md)

## ⚠️ DA FARE MANUALMENTE

### 1. Aggiorna configurazione Firebase Functions (Produzione)

Esegui questi comandi nel terminale:

```bash
firebase functions:config:set google.client_id="254296220548-ucevne2u3r2t8pga65b4jbcdj91jneec.apps.googleusercontent.com"

firebase functions:config:set google.client_secret="YOUR_CLIENT_SECRET_HERE"

firebase functions:config:set google.redirect_uri="https://atomiksnip3r04.github.io/Palestra/auth-callback.html"
```

### 2. Rideploy Firebase Functions

Dopo aver aggiornato la configurazione, rideploy le functions:

```bash
firebase deploy --only functions
```

### 3. Verifica configurazione

Per verificare che la configurazione sia stata salvata correttamente:

```bash
firebase functions:config:get
```

Dovresti vedere:

```json
{
  "google": {
    "client_id": "254296220548-ucevne2u3r2t8pga65b4jbcdj91jneec.apps.googleusercontent.com",
    "client_secret": "YOUR_CLIENT_SECRET_HERE",
    "redirect_uri": "https://atomiksnip3r04.github.io/Palestra/auth-callback.html"
  }
}
```

## 🔒 IMPORTANTE - Sicurezza Client Secret

⚠️ **HAI ESPOSTO IL CLIENT_SECRET NEL MESSAGGIO PRECEDENTE!**

Anche se per le app web JavaScript il client_secret non viene usato nel frontend (solo nelle Firebase Functions server-side), è comunque una best practice rigenerarlo:

### Come rigenerare il Client Secret:

1. Vai su [Google Cloud Console](https://console.cloud.google.com)
2. Seleziona progetto "ironflow-479119" (o "ironflow-a9bc9")
3. Vai su **APIs & Services > Credentials**
4. Trova il Client ID OAuth: `658389886558-n8arq16hb2iusrgj6kspva8hfhlvj46m`
5. Clicca sui tre puntini → **Reset secret**
6. Copia il nuovo secret
7. Aggiorna:
   - `functions/.env` → `GOOGLE_CLIENT_SECRET=nuovo_secret`
   - Firebase config: `firebase functions:config:set google.client_secret="nuovo_secret"`
   - Rideploy: `firebase deploy --only functions`

## 📝 Note

- Il nuovo OAuth Client ID è configurato per il progetto **ironflow-a9bc9**
- Gli authorized redirect URIs includono:
  - `https://ironflow-a9bc9.firebaseapp.com/auth-callback.html`
  - `https://ironflow-a9bc9.web.app/auth-callback.html`
  - `https://atomiksnip3r04.github.io/Palestra/auth-callback.html`
  - `http://localhost:5500/auth-callback.html`
  - `http://localhost:8080/auth-callback.html`
  - `http://127.0.0.1:5500/auth-callback.html`

- Gli authorized JavaScript origins includono:
  - `https://ironflow-a9bc9.firebaseapp.com`
  - `https://ironflow-a9bc9.web.app`
  - `https://atomiksnip3r04.github.io`
  - `http://localhost:5500`
  - `http://localhost:8080`
  - `http://127.0.0.1:5500`
