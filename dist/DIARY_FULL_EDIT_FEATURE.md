# Feature: Modifica Completa Allenamenti nel Diario

## Obiettivo
Permettere la modifica completa di qualsiasi allenamento salvato nel diario, inclusi:
- ✅ Nomi degli esercizi
- ✅ Aggiunta/rimozione esercizi
- ✅ Aggiunta/rimozione set
- ✅ Modifica peso, reps, RPE
- ✅ Modifica data, durata, wellness

**Importante**: Le modifiche sono retroattive e persistenti solo per quella specifica sessione di allenamento. Non influenzano altre sessioni o schede salvate.

---

## Funzionalità Implementate

### 1. **Modifica Nome Esercizio**
- Ogni esercizio ha ora un campo input editabile per il nome
- Il nome modificato viene salvato solo per quella sessione specifica
- Non influenza altre sessioni o la scheda originale

**UI**:
```
[Nome Esercizio (editabile)]  [+ Set] [× Esercizio]
```

### 2. **Aggiungi/Rimuovi Set**
- Pulsante **"+ Set"** per ogni esercizio
- Pulsante **"×"** per ogni set (se ci sono più di 1 set)
- I set vengono rinumerati automaticamente dopo rimozione

**UI per ogni set**:
```
Set | Kg/Lbs | Reps | RPE | [×]
 1  |   60   |  10  |  8  | ×
```

### 3. **Aggiungi/Rimuovi Esercizio**
- Pulsante **"+ Aggiungi Esercizio"** in fondo alla lista
- Pulsante **"× Esercizio"** per ogni esercizio (se ce ne sono più di 1)
- Gli esercizi vengono rinumerati automaticamente

### 4. **Modifica Tutti i Dati**
- Data allenamento
- Durata
- Wellness (sonno, energia, stress, DOMS)
- Peso, reps, RPE per ogni set

### 5. **Persistenza Retroattiva**
- Le modifiche vengono salvate in `localStorage` con lo stesso ID
- Sincronizzazione automatica con Firestore (se connesso)
- Le modifiche sono permanenti per quella sessione specifica

---

## Flusso Utente

### Scenario 1: Correggere un Errore di Battitura
1. Vai su **Diario**
2. Clicca **✏️** sull'allenamento da modificare
3. Modifica il nome dell'esercizio nel campo input
4. Clicca **"Aggiorna Allenamento"**
5. ✅ Il nome è corretto solo per quella sessione

### Scenario 2: Aggiungere un Esercizio Dimenticato
1. Vai su **Diario**
2. Clicca **✏️** sull'allenamento
3. Clicca **"+ Aggiungi Esercizio"** in fondo
4. Inserisci nome, peso, reps per i set
5. Clicca **"Aggiorna Allenamento"**
6. ✅ L'esercizio è aggiunto a quella sessione

### Scenario 3: Rimuovere un Set Errato
1. Vai su **Diario**
2. Clicca **✏️** sull'allenamento
3. Clicca **×** sul set da rimuovere
4. I set rimanenti vengono rinumerati automaticamente
5. Clicca **"Aggiorna Allenamento"**
6. ✅ Il set è rimosso

### Scenario 4: Modificare Peso/Reps
1. Vai su **Diario**
2. Clicca **✏️** sull'allenamento
3. Modifica i valori nei campi input
4. Clicca **"Aggiorna Allenamento"**
5. ✅ I valori sono aggiornati

---

## Struttura Dati

### Prima (Immutabile):
```javascript
{
  id: 1732396800000,
  workoutId: "workout-123",
  workoutName: "Push Day",
  date: "2025-11-23",
  exercises: [
    {
      name: "Panca Piana", // Nome fisso dalla scheda
      sets: [
        { weight: 60, reps: 10, rpe: 8 }
      ]
    }
  ]
}
```

### Dopo (Editabile):
```javascript
{
  id: 1732396800000,
  workoutId: "workout-123",
  workoutName: "Push Day",
  date: "2025-11-23",
  exercises: [
    {
      name: "Panca Piana con Bilanciere", // Nome modificato dall'utente
      sets: [
        { weight: 60, reps: 10, rpe: 8 },
        { weight: 62.5, reps: 8, rpe: 9 } // Set aggiunto
      ]
    },
    {
      name: "Piegamenti", // Esercizio aggiunto
      sets: [
        { weight: 0, reps: 15, rpe: 7 }
      ]
    }
  ]
}
```

---

## Implementazione Tecnica

### 1. **Rendering Form Editabile**
```javascript
function renderLoggingForm(workout, existingExercises = null) {
    // Ogni esercizio ha:
    // - Input text per nome (editabile)
    // - Pulsante "+ Set"
    // - Pulsante "× Esercizio" (se >1 esercizio)
    
    // Ogni set ha:
    // - Input per peso, reps, RPE
    // - Pulsante "×" per rimuovere (se >1 set)
}
```

### 2. **Aggiunta Dinamica Esercizi/Set**
```javascript
function addNewExercise() {
    // Crea nuovo div con:
    // - Input nome vuoto
    // - 1 set vuoto
    // - Pulsanti controllo
}

function attachExerciseControls() {
    // Attach listeners per:
    // - Add set
    // - Remove set
    // - Remove exercise
    // - Rinumerazione automatica
}
```

### 3. **Salvataggio con Nomi Modificati**
```javascript
// Collect Data
exerciseItems.forEach(item => {
    const exNameInput = item.querySelector('.exercise-name-input');
    const exName = exNameInput.value.trim(); // Nome editabile
    
    // ... raccolta set ...
    
    logData.exercises.push({
        name: exName, // Nome modificato dall'utente
        sets: setsData
    });
});
```

### 4. **Persistenza**
```javascript
// Aggiorna log esistente
if (editingLogIndex >= 0) {
    logData.id = logs[editingLogIndex].id; // Mantieni stesso ID
    logs[editingLogIndex] = logData; // Sovrascrivi
} else {
    logs.unshift(logData); // Nuovo log
}

localStorage.setItem('ironflow_logs', JSON.stringify(logs));
await syncLogsToCloud(); // Sync Firestore
```

---

## UI/UX Miglioramenti

### Controlli Visivi
- **+ Set**: Pulsante azzurro (primary color)
- **× Set**: Pulsante rosso piccolo (×)
- **× Esercizio**: Pulsante rosso con testo
- **+ Aggiungi Esercizio**: Pulsante outline full-width

### Feedback Utente
- Conferma prima di rimuovere esercizio
- Rinumerazione automatica set/esercizi
- Pulsante "Aggiorna Allenamento" invece di "Salva" quando in edit mode

### Responsive
- Grid layout si adatta a mobile
- Pulsanti touch-friendly
- Input fields con padding adeguato

---

## Casi d'Uso Avanzati

### 1. **Correzione Errori di Tracking**
**Problema**: Ho registrato "Panca Piana" ma era "Panca Inclinata"
**Soluzione**: Modifica il nome dell'esercizio in edit mode

### 2. **Aggiunta Esercizi Dimenticati**
**Problema**: Ho fatto anche Tricipiti ma ho dimenticato di registrarli
**Soluzione**: Clicca "+ Aggiungi Esercizio" e inserisci i dati

### 3. **Rimozione Set Errati**
**Problema**: Ho registrato un set di riscaldamento per errore
**Soluzione**: Clicca × sul set da rimuovere

### 4. **Modifica Retroattiva Dati**
**Problema**: Ho scoperto che il bilanciere pesa 2kg in più
**Soluzione**: Modifica tutti i pesi aggiungendo 2kg

---

## Limitazioni & Note

### ✅ Cosa Puoi Fare:
- Modificare qualsiasi dato di un allenamento salvato
- Aggiungere/rimuovere esercizi e set
- Modificare nomi esercizi per quella sessione
- Le modifiche sono permanenti per quella sessione

### ❌ Cosa NON Puoi Fare:
- Modificare la scheda originale (quella rimane invariata)
- Modificare altri allenamenti basati sulla stessa scheda
- Modificare allenamenti di altre persone (ovviamente)

### 🔒 Sicurezza:
- Le modifiche sono locali (localStorage) e sincronizzate su Firestore
- Ogni utente può modificare solo i propri allenamenti
- Le modifiche sono tracciabili tramite timestamp

---

## Testing

### Test Case 1: Modifica Nome Esercizio
1. Crea allenamento con "Panca Piana"
2. Salva
3. Modifica in "Panca Piana con Bilanciere"
4. Salva
5. ✅ Verifica che il nome sia aggiornato nel diario
6. ✅ Verifica che altri allenamenti non siano influenzati

### Test Case 2: Aggiungi Esercizio
1. Crea allenamento con 2 esercizi
2. Salva
3. Modifica e aggiungi 3° esercizio
4. Salva
5. ✅ Verifica che ci siano 3 esercizi nel diario
6. ✅ Verifica che il volume totale sia ricalcolato

### Test Case 3: Rimuovi Set
1. Crea allenamento con 4 set
2. Salva
3. Modifica e rimuovi 2 set
4. Salva
5. ✅ Verifica che ci siano 2 set
6. ✅ Verifica che i set siano rinumerati (1, 2)

### Test Case 4: Sincronizzazione
1. Modifica allenamento offline
2. Salva
3. Vai online
4. ✅ Verifica che le modifiche siano sincronizzate su Firestore

---

## Benefici

### Per l'Utente:
✅ **Flessibilità**: Può correggere errori senza rifare tutto
✅ **Precisione**: Dati sempre accurati per analisi AI
✅ **Controllo**: Pieno controllo sui propri dati
✅ **Efficienza**: Non serve rifare l'allenamento da zero

### Per l'AI:
✅ **Dati Puliti**: Nomi esercizi corretti migliorano l'analisi
✅ **Completezza**: Nessun esercizio dimenticato
✅ **Accuratezza**: Pesi e reps corretti per calcolo 1RM

### Per il Sistema:
✅ **Integrità**: Dati consistenti e tracciabili
✅ **Flessibilità**: Struttura dati supporta modifiche
✅ **Scalabilità**: Funziona con qualsiasi numero di esercizi/set

---

## Prossimi Passi

### Possibili Miglioramenti Futuri:
1. **Storico Modifiche**: Tracciare chi ha modificato cosa e quando
2. **Undo/Redo**: Permettere di annullare modifiche
3. **Duplica Allenamento**: Creare copia per modifiche massive
4. **Template da Log**: Creare scheda da allenamento modificato
5. **Confronto Versioni**: Vedere differenze tra originale e modificato

---

## Documentazione Correlata
- `diary.html` - Implementazione completa
- `ARCHITETTURA_DATI.md` - Struttura dati logs
- `HEALTH_DATA_AI_INTEGRATION.md` - Integrazione con AI
