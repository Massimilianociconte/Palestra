import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

const DAY_MS = 24 * 60 * 60 * 1000;

const daysSince = (isoDate) => {
    if (!isoDate) return null;
    const ts = new Date(isoDate).getTime();
    if (Number.isNaN(ts)) return null;
    return Math.max(0, Math.round((Date.now() - ts) / DAY_MS));
};

const formatHotspotLine = (hotspot) => {
    if (!hotspot) return '';
    const intensity = hotspot.avgIntensity ?? hotspot.lastIntensity;
    const since = daysSince(hotspot.lastReportedAt);
    const rec = hotspot.avgRecoveryDays ?? hotspot.lastRecoveryDays;
    const details = [
        intensity !== null && intensity !== undefined ? `intensità media ${intensity}/10` : null,
        rec !== null && rec !== undefined ? `REC medio ${rec}g` : null,
        since !== null ? `ultimo ${since}g fa` : null
    ].filter(Boolean).join(', ');
    return `- ${hotspot.label}: ${hotspot.occurrences} segnalazioni${details ? ` (${details})` : ''}`;
};

const buildDomsSummaryBlock = (hotspots = [], limit = 6) => {
    if (!hotspots.length) {
        return '- Nessuna segnalazione DOMS registrata.';
    }
    return hotspots.slice(0, limit).map(formatHotspotLine).join('\n');
};

const buildRecentDomsBlock = (hotspots = [], windowDays = 4) => {
    const filtered = hotspots.filter(h => {
        const since = daysSince(h.lastReportedAt);
        return since !== null && since <= windowDays;
    });
    if (!filtered.length) {
        return 'Nessun DOMS significativo negli ultimi giorni.';
    }
    return filtered.map(h => {
        const since = daysSince(h.lastReportedAt);
        const rec = h.lastRecoveryDays ?? h.avgRecoveryDays;
        const intensity = h.lastIntensity ?? h.avgIntensity;
        return `- ${h.label}: dolore ${intensity ?? 'N/D'}/10, ${since}g fa, REC stimato ${rec ?? 'N/D'}g`;
    }).join('\n');
};

export class AIService {
    constructor() {
        // API Key is loaded from LocalStorage only. 
        // NEVER hardcode keys in public repositories.
        this.apiKey = localStorage.getItem('ironflow_ai_key');
    }

    hasKey() {
        return !!this.apiKey;
    }

    saveKey(key) {
        this.apiKey = key;
        localStorage.setItem('ironflow_ai_key', key);
    }

    // --- TOON Encoder Implementation (Lightweight) ---
    // Reference: https://github.com/toon-format/toon
    encodeToTOON(data, rootName = 'data') {
        if (Array.isArray(data)) {
            if (data.length === 0) return `${rootName}[0]{}`;
            
            // Get all unique keys from first item (assuming consistent schema for token efficiency)
            const keys = Object.keys(data[0]);
            const header = `${rootName}[${data.length}]{${keys.join(',')}}:`;
            
            const rows = data.map(item => {
                return '  ' + keys.map(k => {
                    let val = item[k];
                    if (val === undefined || val === null) return '';
                    if (typeof val === 'object') return JSON.stringify(val); // Nested objects fallback
                    return String(val).replace(/,/g, '\\,'); // Escape commas
                }).join(',');
            }).join('\n');

            return `${header}\n${rows}`;
        } 
        
        if (typeof data === 'object' && data !== null) {
            // Single object
            return `${rootName}:\n` + Object.entries(data)
                .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
                .join('\n');
        }

        return `${rootName}: ${data}`;
    }

    async analyzeProgress(data) {
        if (!this.apiKey) {
            return { success: false, message: "API Key mancante." };
        }

        try {
            const genAI = new GoogleGenerativeAI(this.apiKey);
            
            // Configuration for high-quality output
            const generationConfig = {
                temperature: 0.7, // Creative but grounded
                topP: 0.95,
                topK: 40,
                maxOutputTokens: 8192, // Increased to prevent truncation (Gemini 1.5/Flash support high limits)
            };

            // Use the most advanced model available
            // Fallback chain: 1.5 Pro (Stable High Intelligence) -> 2.0 Flash (Fast)
            const model = genAI.getGenerativeModel({ 
                model: "gemini-flash-latest", 
                generationConfig 
            }); 

            // Convert data to TOON to save tokens
            const toonLogs = this.encodeToTOON(data.recentLogs, 'workoutLogs');
            
            // Flatten PRs for cleaner AI context (lift + 1rm/3rm/5rm/8rm)
            const prList = Object.entries(data.prs).map(([k, v]) => {
                // Handle both legacy (number) and new (object) formats
                if (typeof v === 'number') return { lift: k, '1rm': v };
                return { lift: k, ...v };
            });
            const toonPrs = this.encodeToTOON(prList, 'personalRecords');
            
            // Historical PRs for progression tracking
            const historicalPrList = data.historicalPrs ? Object.entries(data.historicalPrs).map(([k, v]) => {
                if (typeof v === 'number') return { lift: k, '1rm': v };
                return { lift: k, ...v };
            }) : [];
            const toonHistoricalPrs = historicalPrList.length > 0 
                ? this.encodeToTOON(historicalPrList, 'historicalPRs')
                : 'historicalPRs[0]{}';
            
            // Progression/Regression data
            const progressionList = data.progressionData ? Object.entries(data.progressionData).map(([lift, prog]) => ({
                lift,
                current: prog.current,
                historical: prog.historical,
                change: prog.change,
                changePercent: prog.changePercent,
                status: prog.status
            })) : [];
            const toonProgressions = progressionList.length > 0
                ? this.encodeToTOON(progressionList, 'progressionRegression')
                : 'progressionRegression[0]{}';
            
            // Body stats for weight trend
            const toonBodyStats = data.bodyStats && data.bodyStats.length > 0
                ? this.encodeToTOON(data.bodyStats.map(s => ({
                    date: s.date || s.recordedAt,
                    weight: s.weight,
                    fat: s.fat || null
                })), 'bodyStats')
                : 'bodyStats[0]{}';

            const wellnessBlock = data.wellness ? `
**Recovery & Wellness (scala 1-10)**
- Qualità Sonno Media: ${data.wellness.sleepQuality ?? 'N/D'}
- Energia Giornaliera: ${data.wellness.energyLevel ?? 'N/D'}
- Stress Percepito: ${data.wellness.stressLevel ?? 'N/D'}
- Dolore Muscolare: ${data.wellness.sorenessLevel ?? 'N/D'}
` : '';

            const domsHotspots = data?.domsInsights?.hotspots || [];
            const domsBlock = `
**DOMS Localizzati & Recupero**
${buildDomsSummaryBlock(domsHotspots)}
`;

            // Health Data from Google Fit (already decoded by gatherDataForAI)
            const healthBlock = data.healthData ? `
**Dati Salute (Google Fit - Ultimi 7 giorni)**
- Passi Totali: ${data.healthData.steps ? Math.round(data.healthData.steps).toLocaleString('it-IT') : 'N/D'}
- Frequenza Cardiaca Media: ${data.healthData.heartRate ? Math.round(data.healthData.heartRate) : 'N/D'} bpm
- Peso (Google Fit): ${data.healthData.weight ? data.healthData.weight.toFixed(1) : 'N/D'} kg
- Calorie Bruciate: ${data.healthData.calories ? Math.round(data.healthData.calories).toLocaleString('it-IT') : 'N/D'} kcal
- Distanza Percorsa: ${data.healthData.distance ? data.healthData.distance.toFixed(1) : 'N/D'} km
- Sonno Medio: ${data.healthData.sleep ? data.healthData.sleep.toFixed(1) : 'N/D'} ore/notte
- Fonte: ${data.healthData.source || 'google_fit'}
- Ultimo Sync: ${data.healthData.syncTimestamp ? new Date(data.healthData.syncTimestamp).toLocaleString('it-IT') : 'N/D'}

*Nota: Questi dati sono sincronizzati automaticamente da Google Fit e forniscono un quadro oggettivo dell'attività quotidiana e del recupero. Il sonno è particolarmente importante per valutare la capacità di recupero.*
` : '';

            const prompt = `
Sei un **Elite Strength & Conditioning Coach** con un PhD in Biomeccanica e Fisiologia dell'Esercizio. La tua specializzazione è l'analisi dei dati per ottimizzare l'ipertrofia e la forza massima.
Il tuo compito è analizzare i dati di allenamento di un atleta forniti in formato **TOON** (Token-Oriented Object Notation) e fornire un feedback tecnico, critico e attuabile.

---

### 📊 DATI ATLETA (TOON Format)

**Profilo & Biometria:**
- Nome: ${data.profile.name || 'Atleta'}
- Età: ${data.profile.athleteParams?.age || 'N/D'} anni
- Altezza: ${data.profile.athleteParams?.height || 'N/D'} cm
- Sesso: ${data.profile.athleteParams?.gender || 'N/D'}
- Livello Attività: ${data.profile.athleteParams?.activity || 'N/D'}
- Peso Corporeo Attuale: ${data.bodyStats.length > 0 ? data.bodyStats[0].weight + ' kg' : 'N/D'}
- Grasso Corporeo: ${data.bodyStats.length > 0 && data.bodyStats[0].fat ? data.bodyStats[0].fat + '%' : 'N/D'}
- Sessioni (Ultimi 30gg): ${data.recentWorkoutCount}

**Massimali Stimati Attuali (1RM, 3RM, 5RM):**
${toonPrs}

**Massimali Storici (60-90 giorni fa):**
${toonHistoricalPrs}

**Progressioni/Regressioni per Esercizio:**
${toonProgressions}

**Log Allenamenti Recenti (30 giorni):**
${toonLogs}

**Storico Peso Corporeo:**
${toonBodyStats}

${wellnessBlock}
${domsBlock}
${healthBlock}

---

### 🧠 ANALISI RICHIESTA

Analizza i dati sopra e genera un report strutturato seguendo rigorosamente questi passaggi logici:

**1. CONTESTUALIZZAZIONE BIOMETRICA & LIVELLO**
- Usa età, peso, altezza e sesso (se disponibili) per contestualizzare i carichi sollevati. (Es. 100kg di panca sono ottimi per un atleta di 70kg, normali per uno di 100kg).
- Stima il livello dell'atleta (Principiante, Intermedio, Avanzato) basandoti sul rapporto Forza Relativa (1RM / Peso Corporeo).

**2. ANALISI DEL CARICO & FREQUENZA**
- Valuta la consistenza dell'atleta (frequenza settimanale) rispetto al suo livello di attività dichiarato.
- Analizza il trend del volume (sta aumentando, stallando o diminuendo?).
- Identifica se c'è un sovraccarico progressivo evidente nei log.

**3. ANALISI PROGRESSIONI/REGRESSIONI**
- Usa i dati \`progressionRegression\` per identificare quali esercizi stanno migliorando e quali stanno regredendo.
- Confronta \`personalRecords\` con \`historicalPRs\` per vedere l'evoluzione a lungo termine.
- Identifica pattern: ci sono esercizi in stallo da settimane? Ci sono regressioni preoccupanti?

**4. ANALISI STRUTTURALE & BILANCIAMENTO**
- Osserva i \`exercises\` (struttura workout) e i \`personalRecords\`.
- C'è equilibrio tra catena cinetica anteriore (es. Squat, Bench) e posteriore (es. Deadlift, Row)?
- I massimali sono proporzionati?

**5. PIANO D'AZIONE (PROSSIME 4 SETTIMANE)**
- Fornisci 3 direttive tecniche specifiche basate su progressioni/regressioni identificate.
- Suggerisci una variazione di intensità o volume basata sui dati e sull'età/recupero atteso.
- Se ci sono regressioni, proponi strategie di recupero o deload.

**6. RECUPERO & DOMS LOCALIZZATI**
- Usa la mappa DOMS e l'età dell'atleta per stimare la capacità di recupero reale.
- Identifica se i DOMS persistenti stanno influenzando le performance (correlazione con regressioni).

**7. ANALISI DATI SALUTE (Google Fit)**
- Se disponibili, usa i dati di passi, calorie, sonno e frequenza cardiaca per valutare:
  - Livello di attività generale (NEAT - Non-Exercise Activity Thermogenesis)
  - Qualità del recupero (sonno oggettivo vs percepito)
  - Stress cardiovascolare (frequenza cardiaca a riposo)
  - Bilancio energetico (calorie bruciate vs obiettivo)
- Correla questi dati con le performance in palestra (es. pochi passi + basso sonno = possibile overtraining o underrecovery)

---

### 📝 FORMATO RISPOSTA

Rispondi in **Markdown** pulito.
Usa un tono **Professionale, Tecnico ma Motivante**.
Non inventare dati non presenti nel TOON.
Se mancano dati critici (es. peso o altezza), fallo notare come suggerimento.

**Struttura Output:**
### 🛡️ Coach Insight per ${data.profile.name || 'Atleta'}
> *Breve frase riassuntiva sullo stato attuale (es. "Dati i tuoi 25 anni e 80kg, i carichi sono promettenti, ma attenzione al volume").*

#### 📉 Analisi Tecnica
*   **Livello Stimato**: ... (basato su forza relativa)
*   **Volume & Frequenza**: ...
*   **Equilibrio Strutturale**: ...
*   **Punti di Forza**: ...

#### 🎯 Focus Settimana
1.  **[Azione 1]**: ...
2.  **[Azione 2]**: ...
3.  **[Azione 3]**: ...

Evidenzia sempre come modulare i carichi sui gruppi attualmente stressati da DOMS.

#### 💡 Tip Avanzato
...
`;
            console.log("Sending Advanced TOON Prompt size:", prompt.length);

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            return { success: true, text: text };
        } catch (error) {
            console.error("AI Error:", error);
            return { success: false, message: "Errore AI: " + error.message };
        }
    }

    // NEW: AI Session Predictor
    async predictNextSession(data) {
        if (!this.apiKey) return { success: false, message: "API Key mancante." };
        try {
            const genAI = new GoogleGenerativeAI(this.apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" }); 

            const toonLogs = this.encodeToTOON(data.recentLogs.slice(0, 10), 'lastWorkouts'); // Last 10 for better pattern detection
            const domsGuidance = buildRecentDomsBlock(data?.domsInsights?.hotspots || []);
            
            // Include existing workouts in TOON format
            const existingWorkoutsTOON = data.existingWorkouts && data.existingWorkouts.length > 0 
                ? this.encodeToTOON(data.existingWorkouts, 'existingWorkoutPlans')
                : 'existingWorkoutPlans: []';
            
            // Include progression data to guide exercise selection
            const progressionList = data.progressionData ? Object.entries(data.progressionData).map(([lift, prog]) => ({
                lift,
                status: prog.status,
                changePercent: prog.changePercent
            })) : [];
            const toonProgressions = progressionList.length > 0
                ? this.encodeToTOON(progressionList, 'recentProgressions')
                : 'recentProgressions[0]{}';

            const prompt = `
Come Personal Trainer esperto, analizza gli ultimi allenamenti di questo atleta e suggerisci l'allenamento per OGGI.
Obiettivo: Bilanciamento muscolare e recupero.

**Schede Allenamento Create dall'Utente:**
(Queste sono le schede che l'utente ha già configurato. Se appropriato, suggerisci di usare o modificare una di queste, oppure fanne una nuova se nessuna è adatta.)
${existingWorkoutsTOON}

**Ultimi Allenamenti Svolti (TOON Format):**
${toonLogs}

**Progressioni/Regressioni Recenti (TOON Format):**
${toonProgressions}

**Segnalazioni DOMS recenti (<=4 giorni):**
${domsGuidance}

**Profilo & Biometria Atleta:**
- Età: ${data.profile.athleteParams?.age || 'N/D'}
- Altezza: ${data.profile.athleteParams?.height || 'N/D'} cm
- Livello Attività: ${data.profile.athleteParams?.activity || 'N/D'}
- Peso Corporeo: ${data.bodyStats && data.bodyStats.length > 0 ? data.bodyStats[0].weight + ' kg' : 'N/D'}
- Obiettivo: ${data.profile.goal || data.profile.objective || 'N/D'}
- Sessioni Totali (30gg): ${data.recentWorkoutCount || 0}

**Dati Salute (Google Fit - Ultimi 7 giorni):**
${data.healthData ? `
- Passi Totali: ${data.healthData.steps ? Math.round(data.healthData.steps).toLocaleString('it-IT') : 'N/D'}
- Frequenza Cardiaca: ${data.healthData.heartRate ? Math.round(data.healthData.heartRate) : 'N/D'} bpm
- Calorie Bruciate: ${data.healthData.calories ? Math.round(data.healthData.calories).toLocaleString('it-IT') : 'N/D'} kcal
- Sonno Medio: ${data.healthData.sleep ? data.healthData.sleep.toFixed(1) : 'N/D'} ore/notte
- Distanza: ${data.healthData.distance ? data.healthData.distance.toFixed(1) : 'N/D'} km
*Usa questi dati per valutare il livello di recupero e attività generale dell'atleta. Il sonno è cruciale per decidere l'intensità dell'allenamento.*
` : '- Dati salute non disponibili'}

**ANALISI STILE E STRUTTURA:**
1. Identifica la "Split" o lo stile abituale dell'utente guardando gli ultimi workout (es. fa Push/Pull/Legs? Upper/Lower? Full Body? O split per gruppi muscolari singoli?).
2. Nota il volume abituale (quanti esercizi fa in media per sessione?).

**COMPITO:**
Suggerisci un allenamento per OGGI.
IMPORTANTE: 
1. Cerca di mantenere una struttura simile a quella a cui l'atleta è abituato (es. se fa solitamente 6 esercizi, non proporne 3 a caso; se usa schede specifiche, cerca di rimanere in quel solco), A MENO CHE non sia esplicitamente necessario cambiare per motivi di recupero o stallo.
2. Usa i dati \`recentProgressions\` per prioritizzare esercizi in progressione e variare/deload quelli in regressione.
3. Evita gruppi muscolari con DOMS elevati (>7/10) negli ultimi 2 giorni.
4. Se l'atleta ha un obiettivo specifico (bulk/cut/strength), adatta volume e intensità di conseguenza.

Rispondi in formato JSON (senza markdown, solo JSON puro):
{
    "suggestion": "Titolo Allenamento (es. Push Day o nome di una scheda esistente)",
    "focus": "Breve spiegazione del perché (es. 'Visto il tuo stile PPL e l'ultimo leg day, oggi tocca Push. Mantengo il volume alto come piace a te').",
    "warmup": ["Esercizio 1", "Esercizio 2"],
    "main_lifts": ["Esercizio Key 1", "Esercizio Key 2", "Esercizio Key 3 (se necessario)"]
}
`;
            const result = await model.generateContent(prompt);
            let text = result.response.text();
            // Clean markdown if present
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
            
            return { success: true, data: JSON.parse(text) };
        } catch (error) {
            console.error("AI Prediction Error:", error);
            return { success: false, message: error.message };
        }
    }

    async generateTrendDigest(payload) {
        if (!this.apiKey) return { success: false, message: "API Key mancante." };
        try {
            const genAI = new GoogleGenerativeAI(this.apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" }); 

            const domsHotspots = payload?.domsHotspots || [];
            
            // Convert metrics to TOON format for token efficiency
            const toonMetrics = this.encodeToTOON(payload.metrics, 'trendMetrics');
            const toonDomsHotspots = this.encodeToTOON(domsHotspots, 'domsHotspots');
            
            // Include historical trend data if available
            const toonHistoricalTrends = payload.historicalTrends 
                ? this.encodeToTOON(payload.historicalTrends, 'historicalTrends')
                : 'historicalTrends: []';

            const prompt = `
Sei un Performance Coach di alto livello. Analizza le metriche qui sotto e genera un resoconto **solo in HTML valido** (niente Markdown, niente tag <html>/<body>). Usa esclusivamente questa struttura:

<div class="ai-summary">
  <h4>Andamento Generale</h4>
  <p>...</p>
  <h4>Miglioramenti Evidenti</h4>
  <ul>
    <li>...</li>
  </ul>
  <h4>Rischi / Regressioni</h4>
  <ul>
    <li>...</li>
  </ul>
  <h4>Focus Prossimi 7 Giorni</h4>
  <ol>
    <li>...</li>
  </ol>
</div>

**Metriche Trend Bisettimanali (TOON Format):**
${toonMetrics}

**Profilo Atleta:**
Nome: ${payload.profile?.name || 'Atleta'}
Età: ${payload.profile?.athleteParams?.age || 'N/D'}
Altezza: ${payload.profile?.athleteParams?.height || 'N/D'} cm
Peso: ${payload.profile?.athleteParams?.weight || 'N/D'} kg
Livello: ${payload.profile?.athleteParams?.activity || 'N/D'}
Obiettivo: ${payload.profile?.goal || payload.profile?.objective || 'N/D'}

**DOMS Hotspots (TOON Format):**
${toonDomsHotspots}

**Storico Trend (TOON Format):**
${toonHistoricalTrends}

**Dati Salute (Google Fit - Ultimi 7 giorni):**
${payload.healthData ? `
- Passi: ${payload.healthData.steps ? Math.round(payload.healthData.steps).toLocaleString('it-IT') : 'N/D'}
- Frequenza Cardiaca: ${payload.healthData.heartRate ? Math.round(payload.healthData.heartRate) : 'N/D'} bpm
- Peso: ${payload.healthData.weight ? payload.healthData.weight.toFixed(1) : 'N/D'} kg
- Calorie: ${payload.healthData.calories ? Math.round(payload.healthData.calories).toLocaleString('it-IT') : 'N/D'} kcal
- Sonno: ${payload.healthData.sleep ? payload.healthData.sleep.toFixed(1) : 'N/D'} ore/notte
- Distanza: ${payload.healthData.distance ? payload.healthData.distance.toFixed(1) : 'N/D'} km
*Considera questi dati oggettivi per valutare il recupero e l'attività generale. Il sonno è un indicatore chiave della capacità di recupero.*
` : '- Dati salute non disponibili'}

- Tono: professionale, motivante, conciso.
- Se una sezione non ha punti rilevanti, scrivi "Nessun dato significativo" ma mantieni comunque la struttura.
- Nella sezione "Rischi / Regressioni" cita eventuali distretti con DOMS persistenti e, se serve, richiamali anche nel focus dei prossimi 7 giorni.
- Usa lo storico trend per identificare pattern a lungo termine (es. stallo prolungato, regressioni ricorrenti).
`;
            const result = await model.generateContent(prompt);
            const text = result.response.text();
            return { success: true, text };
        } catch (error) {
            console.error("AI Trend Digest Error:", error);
            return { success: false, message: error.message };
        }
    }
}

export const aiService = new AIService();
