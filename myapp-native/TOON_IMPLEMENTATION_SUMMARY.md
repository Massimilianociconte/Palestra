# Implementazione TOON Format e Miglioramenti Trend Monitor

## Modifiche Implementate

### 1. **Formato TOON per Tutti i Report AI**

Il formato TOON (Token-Oriented Object Notation) è ora utilizzato per tutti e 3 i report AI:

#### a) Analisi Miglioramenti/Peggioramenti Bisettimanali (`analyzeProgress`)
- ✅ Dati workout in formato TOON (`workoutLogs`)
- ✅ Personal Records in formato TOON (`personalRecords`)
- ✅ **NUOVO**: PRs storici in formato TOON (`historicalPRs`)
- ✅ **NUOVO**: Progressioni/Regressioni in formato TOON (`progressionRegression`)
- ✅ **NUOVO**: Storico peso corporeo in formato TOON (`bodyStats`)
- ✅ DOMS insights inclusi

#### b) Strutturazione Workout Futuri (`predictNextSession`)
- ✅ Ultimi 10 allenamenti in formato TOON (`lastWorkouts`)
- ✅ Schede esistenti in formato TOON (`existingWorkoutPlans`)
- ✅ **NUOVO**: Progressioni recenti in formato TOON (`recentProgressions`)
- ✅ DOMS recenti per evitare sovraccarico
- ✅ Obiettivo atleta (bulk/cut/strength) considerato

#### c) Analisi Dati Passati con Consigli (`generateTrendDigest`)
- ✅ Metriche trend in formato TOON (`trendMetrics`)
- ✅ DOMS hotspots in formato TOON (`domsHotspots`)
- ✅ **NUOVO**: Storico trend (90 giorni) in formato TOON (`historicalTrends`)

### 2. **Trend Monitor con Persistenza Dati**

#### Funzionalità Implementate:
- ✅ **Salvataggio automatico snapshot**: Ogni valutazione trend viene salvata in `localStorage` (`ironflow_trend_history`)
- ✅ **Storico fino a 50 entry**: Mantiene gli ultimi 50 snapshot per analisi a lungo termine
- ✅ **Metodi di accesso storico**:
  - `trendEngine.getHistory()`: Ottiene tutto lo storico
  - `trendEngine.getHistoricalTrends(daysBack)`: Filtra per periodo (default 90 giorni)
- ✅ **Auto-refresh**: Il trend monitor si aggiorna automaticamente quando cambiano i dati (`storage` event listener)
- ✅ **Sincronizzazione**: I dati vengono sincronizzati con Firestore tramite `syncToCloud()`

#### Struttura Snapshot:
```javascript
{
  timestamp: "2025-11-23T...",
  metrics: [
    {
      id: "frequency",
      label: "Frequenza Allenamenti",
      current: 3.5,
      previous: 3.0,
      status: "improving",
      sentiment: "positive",
      delta: 0.5,
      pct: 16.7
    },
    // ... altre metriche
  ],
  domsHotspots: [
    {
      muscle: "pectoralis",
      label: "Pettorali",
      occurrences: 5,
      avgIntensity: 6.2,
      avgRecoveryDays: 2.8
    },
    // ... altri hotspot
  ]
}
```

### 3. **Dati Storici Completi per Progressioni/Regressioni**

#### Nuovi Dati Raccolti in `gatherDataForAI()`:
- ✅ **historicalLogs**: Allenamenti 60-90 giorni fa per confronto
- ✅ **historicalPrs**: Massimali storici per ogni esercizio
- ✅ **progressionData**: Calcolo automatico di:
  - Valore attuale vs storico
  - Variazione assoluta e percentuale
  - Status: `progressing`, `regressing`, `stable`

#### Esempio Progression Data:
```javascript
{
  "panca piana": {
    current: 100,      // 1RM attuale
    historical: 95,    // 1RM 60-90 giorni fa
    change: 5,         // +5kg
    changePercent: 5.3, // +5.3%
    status: "progressing"
  },
  "squat": {
    current: 120,
    historical: 130,
    change: -10,
    changePercent: -7.7,
    status: "regressing"
  }
}
```

### 4. **Miglioramenti AI Prompt**

#### Analisi Progressioni/Regressioni:
- L'AI ora riceve dati storici completi per identificare:
  - Esercizi in stallo prolungato
  - Pattern di regressione ricorrenti
  - Correlazione tra DOMS e performance
  - Trend a lungo termine (90 giorni)

#### Suggerimenti Workout:
- L'AI ora considera:
  - Progressioni recenti (prioritizza esercizi in crescita)
  - Regressioni (suggerisce deload o varianti)
  - DOMS elevati (evita gruppi muscolari sovraccarichi)
  - Obiettivo atleta (adatta volume/intensità)

### 5. **Formato TOON - Vantaggi**

Il formato TOON riduce drasticamente i token utilizzati:

**Esempio JSON (tradizionale):**
```json
[
  {"date": "2025-11-20", "volume": 5000, "exercises": ["Panca", "Squat"]},
  {"date": "2025-11-18", "volume": 4800, "exercises": ["Stacco", "Row"]}
]
```
**~150 token**

**Stesso dato in TOON:**
```
workoutLogs[2]{date,volume,exercises}:
  2025-11-20,5000,["Panca"\,"Squat"]
  2025-11-18,4800,["Stacco"\,"Row"]
```
**~50 token** (risparmio 66%)

### 6. **Sincronizzazione e Persistenza**

#### Eventi Monitorati:
- `storage` event: Aggiorna trend quando cambiano `ironflow_logs` o `ironflow_body_stats`
- `focus` event: Ricarica dati quando l'utente torna alla pagina
- `visibilitychange`: Aggiorna quando la tab diventa visibile

#### Persistenza Cloud:
- Tutti i dati (logs, trend history, PRs) vengono sincronizzati con Firestore
- Sincronizzazione automatica dopo ogni modifica
- Fallback locale se il cloud non è disponibile

## File Modificati

1. **js/ai-service.js**
   - Aggiunto supporto TOON per tutti i report
   - Inclusi dati storici e progressioni
   - Migliorati prompt AI

2. **js/trend-engine.js**
   - Aggiunto sistema di persistenza snapshot
   - Metodi `getHistory()` e `getHistoricalTrends()`
   - Salvataggio automatico in localStorage

3. **js/firestore-service.js**
   - Calcolo progressioni/regressioni
   - Raccolta dati storici (60-90 giorni)
   - Inclusione PRs storici

4. **analysis.html**
   - Auto-refresh trend monitor
   - Passaggio storico trend all'AI
   - Visualizzazione valori formattati

## Test Consigliati

1. ✅ Verificare che i trend vengano salvati in `localStorage` (`ironflow_trend_history`)
2. ✅ Testare auto-refresh aggiungendo un nuovo log
3. ✅ Verificare che l'AI riceva dati in formato TOON (controllare console)
4. ✅ Testare analisi progressioni con dati storici
5. ✅ Verificare sincronizzazione cloud

## Note Tecniche

- **Token Efficiency**: Il formato TOON riduce l'uso di token del 50-70%
- **Compatibilità**: Mantiene retrocompatibilità con dati esistenti
- **Performance**: Snapshot limitati a 50 entry per evitare overhead
- **Fallback**: Se TOON fallisce, usa JSON standard

## Prossimi Passi Suggeriti

1. Aggiungere visualizzazione grafica dello storico trend
2. Implementare export/import dello storico
3. Aggiungere notifiche per regressioni significative
4. Creare dashboard comparativo (mese vs mese)
