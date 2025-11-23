# Architettura Flusso Dati - IRONFLOW

## Panoramica Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
├─────────────────────────────────────────────────────────────────┤
│  diary.html  │  analysis.html  │  user.html  │  body.html      │
└──────┬───────────────┬──────────────────┬──────────────────────┘
       │               │                  │
       ▼               ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SERVIZI JAVASCRIPT                         │
├─────────────────────────────────────────────────────────────────┤
│  firestore-service.js  │  ai-service.js  │  trend-engine.js    │
│  doms-insights.js      │  heatmap-service.js                    │
└──────┬───────────────┬──────────────────┬──────────────────────┘
       │               │                  │
       ▼               ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STORAGE & PERSISTENZA                        │
├─────────────────────────────────────────────────────────────────┤
│  localStorage        │  Firestore Cloud  │  Trend History      │
└─────────────────────────────────────────────────────────────────┘
```

## Flusso Dati Completo

### 1. Registrazione Allenamento

```
User Input (diary.html)
    │
    ├─> Wellness Data (DOMS, Sleep, Energy, Stress)
    │   └─> Muscle Selection (DOMS localizzati)
    │
    ├─> Exercise Data (Nome, Sets, Weight, Reps, RPE)
    │
    └─> Metadata (Date, Duration, Workout Name)
         │
         ▼
    localStorage.ironflow_logs
         │
         ├─> Auto-trigger: storage event
         │   └─> analysis.html: Auto-refresh Trend Monitor
         │
         └─> firestoreService.syncToCloud()
             └─> Firestore: users/{uid}/logs
```

### 2. Calcolo Trend Monitor

```
Trigger: Page Load / Storage Event / Manual Refresh
    │
    ▼
trendEngine.evaluate({
    logs: ironflow_logs,
    bodyStats: ironflow_body_stats,
    profile: ironflow_profile
})
    │
    ├─> Bucketize Logs (Recent: 0-14 days, Previous: 14-28 days)
    │
    ├─> Calculate Metrics:
    │   ├─> Frequency (sessions/week)
    │   ├─> Volume (avg kg per session)
    │   ├─> Body Weight (avg kg)
    │   ├─> PRs (estimated 1RM)
    │   ├─> Consistency (training days / theoretical days)
    │   └─> Wellness (Sleep, Energy, Stress, Soreness)
    │
    ├─> Evaluate Trends:
    │   ├─> Compare Recent vs Previous
    │   ├─> Calculate Delta & Percentage Change
    │   └─> Assign Status: improving / declining / stable
    │
    ├─> Compute DOMS Insights:
    │   ├─> Hotspots (most frequent DOMS)
    │   ├─> Average Intensity
    │   └─> Average Recovery Days
    │
    └─> Save Snapshot:
        └─> localStorage.ironflow_trend_history
            └─> Max 50 entries (FIFO)
```

### 3. Raccolta Dati per AI

```
firestoreService.gatherDataForAI()
    │
    ├─> Load Data:
    │   ├─> ironflow_logs (all)
    │   ├─> ironflow_body_stats (all)
    │   └─> ironflow_profile
    │
    ├─> Filter Logs:
    │   ├─> Recent: Last 30 days
    │   └─> Historical: 60-90 days ago
    │
    ├─> Calculate PRs:
    │   ├─> Current PRs (from recent logs)
    │   │   └─> 1RM, 3RM, 5RM, 8RM, 10RM, 12RM
    │   │
    │   └─> Historical PRs (from historical logs)
    │       └─> 1RM, 3RM, 5RM
    │
    ├─> Calculate Progressions:
    │   └─> For each exercise:
    │       ├─> current: Current 1RM
    │       ├─> historical: Historical 1RM
    │       ├─> change: Absolute difference
    │       ├─> changePercent: Percentage change
    │       └─> status: progressing / regressing / stable
    │
    ├─> Simplify Logs (Token Efficiency):
    │   └─> Keep only: date, volume, exercises, wellness
    │
    ├─> Calculate Wellness Summary:
    │   └─> Average: sleepQuality, energyLevel, stressLevel, sorenessLevel
    │
    ├─> Compute DOMS Insights:
    │   └─> domsInsights.hotspots
    │
    └─> Return Complete Dataset:
        ├─> profile
        ├─> bodyStats (last 5)
        ├─> recentLogs (simplified)
        ├─> recentWorkoutCount
        ├─> historicalWorkoutCount
        ├─> prs (current)
        ├─> historicalPrs
        ├─> progressionData
        ├─> wellness (summary)
        ├─> domsInsights
        └─> existingWorkouts
```

### 4. Conversione TOON

```
aiService.encodeToTOON(data, rootName)
    │
    ├─> If Array:
    │   ├─> Extract keys from first item
    │   ├─> Create header: rootName[length]{key1,key2,...}:
    │   └─> Create rows: value1,value2,...
    │       └─> Escape commas in values
    │
    └─> If Object:
        └─> Create key-value pairs: key: JSON.stringify(value)

Example Output:
    workoutLogs[10]{date,volume,exercises}:
      2025-11-20,5000,Panca\,Squat
      2025-11-18,4800,Stacco\,Row
      ...

Token Savings: 50-70% vs JSON
```

### 5. Report AI #1: Analisi Progressi

```
User: Click "Chiedi al Coach AI" (analysis.html)
    │
    ▼
aiService.analyzeProgress(data)
    │
    ├─> Convert to TOON:
    │   ├─> workoutLogs (recent logs)
    │   ├─> personalRecords (current PRs)
    │   ├─> historicalPRs (60-90 days ago)
    │   ├─> progressionRegression (per exercise)
    │   └─> bodyStats (weight trend)
    │
    ├─> Build Prompt:
    │   ├─> Profilo & Biometria
    │   ├─> Massimali Attuali vs Storici
    │   ├─> Progressioni/Regressioni
    │   ├─> Log Allenamenti
    │   ├─> Wellness & DOMS
    │   └─> Richiesta Analisi Strutturata
    │
    ├─> Call Gemini AI:
    │   └─> model: gemini-flash-latest
    │       └─> temperature: 0.7
    │
    ├─> Parse Response (Markdown)
    │
    ├─> Save to History:
    │   └─> firestoreService.saveAIAnalysis()
    │       └─> Firestore: users/{uid}/aiHistory
    │
    └─> Display in Modal (analysis.html)
```

### 6. Report AI #2: Prossima Sessione

```
User: Click "🤖 Genera" (user.html)
    │
    ▼
aiService.predictNextSession(data)
    │
    ├─> Convert to TOON:
    │   ├─> lastWorkouts (last 10)
    │   ├─> existingWorkoutPlans (user's saved workouts)
    │   └─> recentProgressions (status per exercise)
    │
    ├─> Build Prompt:
    │   ├─> Ultimi Allenamenti
    │   ├─> Progressioni/Regressioni
    │   ├─> DOMS Recenti
    │   ├─> Profilo & Obiettivo
    │   └─> Richiesta: Suggerisci allenamento OGGI
    │
    ├─> Call Gemini AI:
    │   └─> Response Format: JSON
    │       ├─> suggestion: "Nome allenamento"
    │       ├─> focus: "Spiegazione"
    │       ├─> warmup: ["Ex1", "Ex2"]
    │       └─> main_lifts: ["Ex1", "Ex2", "Ex3"]
    │
    ├─> Save to History:
    │   └─> localStorage.ironflow_ai_plan_history
    │
    └─> Display in Widget (user.html)
        └─> Option: "Salva come scheda"
```

### 7. Report AI #3: Resoconto Bisettimanale

```
Trigger: Auto (every 9+ days) OR Manual (analysis.html)
    │
    ▼
aiService.generateTrendDigest(payload)
    │
    ├─> Convert to TOON:
    │   ├─> trendMetrics (current evaluation)
    │   ├─> domsHotspots (DOMS insights)
    │   └─> historicalTrends (last 90 days)
    │
    ├─> Build Prompt:
    │   ├─> Metriche Trend Bisettimanali
    │   ├─> Profilo Atleta
    │   ├─> DOMS Hotspots
    │   ├─> Storico Trend (90 giorni)
    │   └─> Richiesta: Resoconto HTML
    │
    ├─> Call Gemini AI:
    │   └─> Response Format: HTML
    │       ├─> Andamento Generale
    │       ├─> Miglioramenti Evidenti
    │       ├─> Rischi / Regressioni
    │       └─> Focus Prossimi 7 Giorni
    │
    ├─> Save to History:
    │   └─> localStorage.ironflow_ai_summary_history
    │
    └─> Show Toast Notification
        └─> Click: Open Modal (analysis.html)
```

## Strutture Dati Chiave

### Workout Log
```javascript
{
  id: 1732377600000,
  workoutId: "workout_123",
  workoutName: "Push Day",
  date: "2025-11-23T10:00:00.000Z",
  duration: "60 min",
  totalVolume: 5000,
  exercises: [
    {
      name: "Panca Piana",
      sets: [
        { weight: 80, reps: 8, rpe: 8 },
        { weight: 80, reps: 8, rpe: 8 },
        { weight: 80, reps: 7, rpe: 9 }
      ]
    }
  ],
  wellness: {
    sleepQuality: 7,
    energyLevel: 8,
    stressLevel: 4,
    sorenessLevel: 3,
    recordedAt: "2025-11-23T09:55:00.000Z",
    sorenessMuscles: ["pectoralis", "deltoids"],
    sorenessLabels: ["Pettorali", "Deltoidi"]
  },
  fromAI: false,
  source: "focus"
}
```

### Trend Snapshot
```javascript
{
  timestamp: "2025-11-23T12:00:00.000Z",
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
    {
      id: "volume",
      label: "Volume Medio",
      current: 5200,
      previous: 4800,
      status: "improving",
      sentiment: "positive",
      delta: 400,
      pct: 8.3
    }
  ],
  domsHotspots: [
    {
      muscle: "pectoralis",
      label: "Pettorali",
      occurrences: 5,
      avgIntensity: 6.2,
      avgRecoveryDays: 2.8
    }
  ]
}
```

### Progression Data
```javascript
{
  "panca piana": {
    current: 100,
    historical: 95,
    change: 5,
    changePercent: 5.3,
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

## Eventi e Sincronizzazione

### Storage Events
```
localStorage.setItem('ironflow_logs', ...)
    │
    └─> Trigger: window.storage event
        │
        ├─> analysis.html: Auto-refresh Trend Monitor
        ├─> diary.html: Refresh log list
        └─> user.html: Refresh workout list
```

### Auto-Sync to Cloud
```
After every data modification:
    │
    └─> firestoreService.syncToCloud()
        │
        ├─> Collect all localStorage data
        ├─> Upload to Firestore: users/{uid}
        └─> Update lastUpdated timestamp
```

### Load from Cloud
```
On Login / Page Load:
    │
    └─> firestoreService.loadFromCloud()
        │
        ├─> Fetch from Firestore: users/{uid}
        ├─> Write to localStorage
        └─> Trigger UI refresh
```

## Performance & Ottimizzazioni

### Token Efficiency (TOON)
- JSON: ~150 token per 2 workout logs
- TOON: ~50 token per 2 workout logs
- **Risparmio: 66%**

### Storage Limits
- Trend History: Max 50 snapshots (~500KB)
- AI Summary History: Max 12 entries (~200KB)
- AI Plan History: Max 20 entries (~100KB)
- Total localStorage: ~1-2MB (well under 5-10MB limit)

### Firestore Reads/Writes
- Login: 1 read
- Sync: 1 write
- Daily average: ~5-10 operations
- Monthly: ~150-300 operations (well under free tier 50K)

## Sicurezza & Privacy

### API Keys
- Stored in: localStorage (client-side only)
- Backup in: Firestore users/{uid}/profile.geminiKey
- Never exposed in: Git, logs, or public code

### User Data
- Authentication: Firebase Auth
- Storage: Firestore (user-scoped)
- Access: Only authenticated user can read/write own data
- Rules: Firestore Security Rules enforce user isolation

### DOMS Data
- Stored locally: Last selection persisted
- Sent to AI: Only aggregated insights (no PII)
- Privacy: Muscle groups only, no personal identifiers

---

**Nota**: Questa architettura garantisce:
1. ✅ Efficienza token (50-70% risparmio)
2. ✅ Persistenza dati (localStorage + Firestore)
3. ✅ Sincronizzazione automatica
4. ✅ Analisi storiche complete
5. ✅ Privacy e sicurezza utente
