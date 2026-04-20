# Migration & Deployment Notes

Questo file raccoglie le azioni manuali necessarie per rendere effettivi
alcuni dei miglioramenti introdotti nel lavoro di hardening.

---

## P3.41 — Migrazione `firebase-functions` v4 → v6 (opzionale, post-deploy)

Il codice in `functions/index.js` usa ancora l'API v1 classica
(`functions.https.onCall`, `functions.https.onRequest`, ecc.). Google ha già
reso disponibile la v6 con le nuove factory `onCall` / `onRequest` dal
modulo `firebase-functions/v2/*`.

Quando si deciderà di migrare:

1. Aggiornare `functions/package.json`:
   ```json
   "dependencies": {
     "firebase-functions": "^6.0.0",
     "firebase-admin": "^12.0.0"
   }
   ```
2. Importare gli handler v2:
   ```js
   const { onCall, HttpsError } = require("firebase-functions/v2/https");
   const { onDocumentCreated } = require("firebase-functions/v2/firestore");
   const { onSchedule } = require("firebase-functions/v2/scheduler");
   const { setGlobalOptions } = require("firebase-functions/v2");
   setGlobalOptions({ region: "europe-west1", maxInstances: 20 });
   ```
3. Sostituire le definizioni:
   - `functions.https.onCall((data, ctx) => …)` → `onCall((req) => { const {auth, data} = req; … })`
   - `functions.https.onRequest(…)` → importare da `functions/v2/https`
   - `functions.https.HttpsError` → `HttpsError`
   - `functions.firestore.document(...).onCreate(...)` → `onDocumentCreated('path/{id}', (event) => …)`
   - `functions.pubsub.schedule(...)` → `onSchedule('every 15 minutes', (event) => …)`
4. `context.auth.uid` diventa `request.auth.uid`.
5. I `functions.config()` vanno sostituiti con `defineSecret` / env vars di
   Cloud Run.
6. Testare in emulatore prima del deploy: `firebase emulators:start --only functions,firestore`.

Motivazione: la v6 permette concorrenza per-istanza, cold start più veloci,
rollout canary e configurazione `minInstances`. Non è urgente, ma è la
strada naturale quando Google deprecerà la v1.

---

## P3.42 — Smoke test minimi

Finché non c'è una suite Playwright completa, dopo ogni deploy controllare
manualmente i seguenti flussi (ognuno in 1-2 minuti):

### Smoke 1 — PWA web (desktop + mobile Safari/Chrome)

1. Apri `https://massimilianociconte.github.io/Palestra/`.
2. DevTools → **Network**: nessuna 404/500, nessun `unpkg.com/lucide`
   (ora è self-hosted), nessun `firestore_debug.rules`.
3. DevTools → **Application** → Service Workers: `gymbro-v7` attivo.
4. DevTools → **Console**: nessun errore; banner iOS deve comparire
   SOLO in Safari iOS non installato come PWA.
5. Login (email/password o Google) → verifica redirect → user.html.
6. Apri il chat GymBro: scrivi 2 messaggi, ricarica la pagina, verifica
   che la history venga ripristinata (**P2.32**).

### Smoke 2 — Creator + Diary + Timer

1. `creator.html`: crea una scheda con 3 esercizi, salva.
2. `diary.html`: apri l'allenamento, avvia timer riposo 30s.
3. Verifica che:
   - la notifica di "Fine riposo" arrivi con **suono** (**P1.13**);
   - chiudere l'app in background e riaprire mantiene il timer (**Android foreground service**);
   - `timer.worker.js` clampa l'aggiunta di tempo (**P1.17** — prova `+9999s`).
4. Completa un set → vai su `records.html`: i session PR devono mostrarsi
   senza query string mega-lunga (**P1.15**).

### Smoke 3 — Cloud Functions

1. `firebase functions:log --only generateContentWithGemini -n 20`:
   log strutturati in JSON (**P2.33**).
2. Testa rate limit: invoca 11 volte generateContent con un utente non-admin
   → la 11° deve tornare `resource-exhausted` e loggare
   `rate_limit.exceeded`.
3. Prova a invocare `migrateUserEmails` da browser normale →
   `permission-denied` (**P0.4**).
4. Upload immagine profilo: deve passare da `uploadToImgBB` CF
   (**P0.5**), non dal client.

### Smoke 4 — Android release build

1. `cd android && ./gradlew assembleRelease`.
2. APK installato deve:
   - avere dimensioni ridotte rispetto al precedente (R8 attivo — **P3.36**);
   - bloccare traffico HTTP verso qualsiasi host (**P2.26** cleartext=false);
   - far funzionare login/timer/notifiche.
3. `adb shell dumpsys package com.gymbro.app | grep -i backup`:
   `allowBackup=false` (**P2.26**).

### Smoke 5 — Firestore rules

1. Firebase Console → Firestore → Rules Playground.
2. Simula:
   - Letto di `/users/{uid}` come utente diverso → **deny**.
   - Letto di `/users/{uid}/public/profile` come utente loggato → **allow**.
   - Scrittura di `/users/{uid}` con `admin=true` da client → **deny**
     (campo strippato lato server).

---

## Credenziali e rotazione

- `GEMINI_API_KEY`: ruotare ogni 90 giorni.
- `IMGBB_API_KEY`: ruotare ogni 90 giorni (solo server).
- `HAE_WEBHOOK_SECRET`: 32+ byte random; ruotare se compromesso.
- Firebase App Check reCAPTCHA site key: impostare via
  `window.__APP_CHECK_SITE_KEY__` in un bootstrap script dedicato.
