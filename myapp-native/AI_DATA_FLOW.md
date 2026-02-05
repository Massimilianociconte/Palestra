# AI Data Flow - Dati Passati all'AI

## Ultimo Aggiornamento: 25 Novembre 2025

Questo documento descrive tutti i dati che vengono raccolti e passati all'AI per l'analisi.

---

## 1. Dati Raccolti da `gatherDataForAI()`

### 1.1 Profilo Utente (`profile`)
- Nome
- Età
- Altezza
- Sesso
- Livello attività
- Obiettivo

### 1.2 Statistiche Corporee (`bodyStats`)
- Ultimi 5 weigh-in
- Data, peso, grasso corporeo (se disponibile)

### 1.3 Log Allenamenti Recenti (`recentLogs`) - Ultimi 30 giorni
Per ogni allenamento:
- Data
- Nome workout
- Volume totale (tonnellaggio)
- Durata
- Lista esercizi con:
  - Nome esercizio
  - Numero set (con tipi speciali: 3N+1B = 3 normali + 1 back-off)
  - RPE medio per esercizio
- RPE medio workout
- Dati wellness (sonno, energia, stress, dolore)
- Muscoli con DOMS

### 1.4 Personal Records (`prs`) - Top 10
Per ogni esercizio:
- 1RM, 3RM, 5RM, 8RM, 10RM, 12RM stimati

### 1.5 PR Storici (`historicalPrs`) - 60-90 giorni fa
Per confronto progressione/regressione

### 1.6 Progressioni/Regressioni (`progressionData`)
Per ogni esercizio:
- 1RM attuale vs storico
- Variazione percentuale
- Status: progressing/regressing/stable

### 1.7 Wellness Summary (`wellness`)
Medie degli ultimi 30 giorni:
- Qualità sonno
- Livello energia
- Livello stress
- Livello dolore muscolare

### 1.8 DOMS Insights (`domsInsights`)
- Hotspots muscolari con DOMS ricorrenti
- Intensità media
- Giorni di recupero stimati

### 1.9 Schede Esistenti (`existingWorkouts`)
Per ogni scheda creata dall'utente:
- Nome scheda
- Lista esercizi con:
  - Nome
  - Numero set (con tipi: "3x normal+1x backoff")
  - Reps target
  - RPE target
  - Flag se ha set speciali

### 1.10 Dati Salute Google Fit (`healthData`)
- Passi totali (settimanali)
- Frequenza cardiaca media
- Peso
- Calorie totali (settimanali)
- Distanza percorsa
- Sonno medio giornaliero
- Timestamp ultimo sync

---

## 2. Formato TOON

I dati vengono convertiti in formato TOON per risparmiare token:

```
workoutLogs[5]{date,name,volume,exercises,avgRpe,duration}:
  2025-11-24,Push Day,12500,[Panca (4 sets @ RPE 8)...],8.2,45 min
  2025-11-23,Pull Day,11200,[Rematore (4 sets @ RPE 7.5)...],7.8,50 min
```

### Vantaggi TOON:
- ~60% risparmio token rispetto a JSON
- Struttura tabellare compatta
- Header con schema, righe con dati

---

## 3. Dati Mancanti / Da Aggiungere

### ✅ Già Implementati:
- [x] Profilo utente
- [x] Body stats
- [x] Log allenamenti con RPE
- [x] Personal Records
- [x] Progressioni/Regressioni
- [x] Wellness data
- [x] DOMS insights
- [x] Schede esistenti
- [x] Google Fit health data
- [x] Tipi di serie (warm-up, back-off, etc.)
- [x] Durata allenamento
- [x] Nome workout nei log

### ⚠️ Potenziali Miglioramenti Futuri:
- [ ] Storico infortuni
- [ ] Preferenze alimentari
- [ ] Supplementi utilizzati
- [ ] Orari di allenamento preferiti
- [ ] Attrezzatura disponibile

---

## 4. Flusso Dati

```
localStorage/Firestore
        ↓
gatherDataForAI()
        ↓
Conversione TOON (encodeToTOON)
        ↓
Prompt AI (analyzeProgress / predictNextSession)
        ↓
Risposta AI
        ↓
Rendering UI
```

---

## 5. Verifica Completezza

Per verificare che tutti i dati siano passati correttamente:

1. Apri la console del browser
2. Esegui: `await firestoreService.gatherDataForAI()`
3. Verifica che tutti i campi siano popolati
4. Controlla i log della console per eventuali errori

---

## 6. Note Tecniche

### Limiti Token:
- Gemini Flash: ~1M token context
- Output max: 16384 token
- TOON riduce input di ~60%

### Frequenza Aggiornamento:
- Dati raccolti al momento della richiesta AI
- Nessun caching (sempre dati freschi)
- Health data: ultimi 7 giorni

### Retrocompatibilità:
- Supporta sia formato vecchio (sets come numero) che nuovo (sets come array)
- Converte automaticamente al formato appropriato
