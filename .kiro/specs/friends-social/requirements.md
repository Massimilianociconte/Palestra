# Spec: Funzionalità Social - Amici

> Implementazione dell'interfaccia utente per la gestione amici in GymBro, sfruttando il backend `FriendshipService` già esistente.

## Contesto

Il servizio `js/services/friendship-service.js` fornisce già tutte le funzionalità backend:
- Invio/accettazione/rifiuto richieste di amicizia
- Blocco/sblocco utenti
- Lista amici
- Richieste in sospeso
- Verifica stato amicizia

**Manca completamente l'interfaccia utente** per accedere a queste funzionalità.

---

## User Stories

### US-1: Accesso alla sezione Amici
**Come** utente autenticato  
**Voglio** accedere facilmente alla sezione amici dal menu di navigazione  
**Per** gestire le mie connessioni social nell'app

**Criteri di accettazione:**
- [ ] Link "Amici" visibile nella bottom navigation bar
- [ ] Icona appropriata (es. 👥 o icona persone)
- [ ] Badge con numero richieste in sospeso (se > 0)
- [ ] Pagina `friends.html` accessibile

---

### US-2: Visualizzazione lista amici
**Come** utente  
**Voglio** vedere la lista dei miei amici  
**Per** sapere con chi sono connesso

**Criteri di accettazione:**
- [ ] Lista amici con avatar/iniziale e nome
- [ ] Data di amicizia ("Amici da...")
- [ ] Empty state se nessun amico
- [ ] Tap su amico apre profilo/azioni

---

### US-3: Ricerca utenti
**Come** utente  
**Voglio** cercare altri utenti per nome o email  
**Per** trovare amici da aggiungere

**Criteri di accettazione:**
- [ ] Campo di ricerca in alto nella pagina
- [ ] Risultati mostrano nome, avatar, stato amicizia
- [ ] Bottone "Aggiungi" per utenti non amici
- [ ] Indicatore se richiesta già inviata
- [ ] Debounce sulla ricerca (300ms)

---

### US-4: Invio richiesta di amicizia
**Come** utente  
**Voglio** inviare una richiesta di amicizia  
**Per** connettermi con altri utenti

**Criteri di accettazione:**
- [ ] Bottone "Aggiungi amico" nei risultati ricerca
- [ ] Feedback visivo dopo invio (toast + cambio stato bottone)
- [ ] Gestione errori (utente già amico, richiesta già inviata)
- [ ] Auto-accept se l'altro ha già inviato richiesta

---

### US-5: Gestione richieste in sospeso
**Come** utente  
**Voglio** vedere e gestire le richieste di amicizia ricevute  
**Per** accettare o rifiutare nuove connessioni

**Criteri di accettazione:**
- [ ] Tab/sezione "Richieste" con badge contatore
- [ ] Lista richieste ricevute con nome e data
- [ ] Bottoni "Accetta" e "Rifiuta" per ogni richiesta
- [ ] Lista richieste inviate (in attesa)
- [ ] Feedback visivo dopo azione

---

### US-6: Rimozione amico
**Come** utente  
**Voglio** poter rimuovere un amico  
**Per** gestire le mie connessioni

**Criteri di accettazione:**
- [ ] Opzione "Rimuovi amico" nel profilo amico
- [ ] Conferma prima della rimozione
- [ ] Feedback dopo rimozione
- [ ] Aggiornamento immediato della lista

---

### US-7: Blocco utente
**Come** utente  
**Voglio** poter bloccare un utente  
**Per** evitare interazioni indesiderate

**Criteri di accettazione:**
- [ ] Opzione "Blocca" nel menu azioni utente
- [ ] Conferma prima del blocco
- [ ] Utente bloccato non può inviare richieste
- [ ] Sezione "Utenti bloccati" nelle impostazioni
- [ ] Possibilità di sbloccare

---

## Design Requirements

### Layout Pagina `friends.html`

```
┌─────────────────────────────────────┐
│  ← Amici                        🔍  │  Header
├─────────────────────────────────────┤
│  [🔍 Cerca utenti...]               │  Search bar
├─────────────────────────────────────┤
│  [Amici (12)] [Richieste (3)]       │  Tab navigation
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 👤 Mario Rossi              │   │  Friend card
│  │    Amici da 3 mesi     ⋮   │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 👤 Luca Bianchi             │   │
│  │    Amici da 1 settimana ⋮   │   │
│  └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
│  🏠  📓  ➕  📊  👥                 │  Bottom nav
└─────────────────────────────────────┘
```

### Componenti UI

1. **Friend Card**
   - Avatar circolare (iniziale o foto)
   - Nome utente
   - Info secondaria (data amicizia)
   - Menu azioni (⋮)

2. **Request Card**
   - Avatar + nome
   - Data richiesta
   - Bottoni Accetta/Rifiuta inline

3. **Search Result Card**
   - Avatar + nome
   - Stato (Amico / Richiesta inviata / Aggiungi)
   - Azione contestuale

4. **Empty States**
   - Nessun amico: "Inizia a connetterti! 🤝"
   - Nessuna richiesta: "Nessuna richiesta in sospeso"
   - Nessun risultato: "Nessun utente trovato"

### Stili (seguire pattern esistenti)

- Colori: `--color-primary: #00f3ff`, `--color-surface`, `--color-bg`
- Border radius: `12-16px` per card
- Shadows: `0 2px 12px rgba(0,0,0,0.2)`
- Font: Inter per body, Oswald per titoli
- Transizioni: `0.15s` per hover/active

---

## Technical Implementation

### File da creare

1. `friends.html` - Pagina principale amici
2. `js/friends-ui.js` - Logica UI per la pagina
3. `css/friends.css` (opzionale, può essere inline)

### Integrazioni

- Importare `FriendshipService` da `js/services/friendship-service.js`
- Usare `AuthService` per verificare autenticazione
- Usare `FirestoreService` per cercare utenti (query su collection `users`)
- Aggiungere link in bottom nav di tutte le pagine HTML

### API FriendshipService disponibili

```javascript
// Già implementate in friendship-service.js
friendshipService.sendFriendRequest(toUid)
friendshipService.acceptFriendRequest(senderUid)
friendshipService.rejectFriendRequest(senderUid)
friendshipService.getFriends()
friendshipService.getPendingRequests()
friendshipService.blockUser(blockedUid)
friendshipService.unblockUser(unblockedUid)
friendshipService.removeFriend(friendUid)
friendshipService.checkFriendshipStatus(otherUid)
```

### Ricerca utenti (da implementare)

Necessaria query Firestore sulla collection `users`:
```javascript
// Esempio ricerca per displayName
const usersRef = collection(db, 'users');
const q = query(usersRef, 
  where('displayName', '>=', searchTerm),
  where('displayName', '<=', searchTerm + '\uf8ff'),
  limit(20)
);
```

---

## Tasks di Implementazione

### Fase 1: Struttura base
- [ ] Creare `friends.html` con layout base
- [ ] Aggiungere link nella bottom nav di tutte le pagine
- [ ] Implementare tab Amici/Richieste

### Fase 2: Lista amici
- [ ] Fetch e render lista amici
- [ ] Card amico con azioni
- [ ] Empty state

### Fase 3: Richieste
- [ ] Fetch richieste in sospeso
- [ ] UI accetta/rifiuta
- [ ] Badge contatore nella nav

### Fase 4: Ricerca
- [ ] Campo ricerca con debounce
- [ ] Query utenti Firestore
- [ ] Risultati con stato amicizia
- [ ] Azione invio richiesta

### Fase 5: Azioni avanzate
- [ ] Rimozione amico
- [ ] Blocco/sblocco utente
- [ ] Profilo amico (stats condivise - futuro)

---

## Note

- UI completamente in italiano
- Mobile-first design
- Offline: mostrare cache locale se disponibile
- Sync automatico quando online
- Accessibilità: focus states, aria-labels
