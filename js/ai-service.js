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

            const prompt = `
Sei un **Elite Strength & Conditioning Coach** con un PhD in Biomeccanica e Fisiologia dell'Esercizio. La tua specializzazione è l'analisi dei dati per ottimizzare l'ipertrofia e la forza massima.
Il tuo compito è analizzare i dati di allenamento di un atleta forniti in formato **TOON** (Token-Oriented Object Notation) e fornire un feedback tecnico, critico e attuabile.

---

### 📊 DATI ATLETA (TOON Format)

**Profilo:**
- Nome: ${data.profile.name || 'Atleta'}
- Peso Corporeo Attuale: ${data.bodyStats.length > 0 ? data.bodyStats[0].weight + ' kg' : 'N/D'}
- Sessioni (Ultimi 30gg): ${data.recentWorkoutCount}

**Massimali Stimati (1RM):**
${toonPrs}

**Log Allenamenti Recenti:**
${toonLogs}

${wellnessBlock}
${domsBlock}

---

### 🧠 ANALISI RICHIESTA

Analizza i dati sopra e genera un report strutturato seguendo rigorosamente questi passaggi logici:

**1. ANALISI DEL CARICO & FREQUENZA**
- Valuta la consistenza dell'atleta (frequenza settimanale).
- Analizza il trend del volume (sta aumentando, stallando o diminuendo?).
- Identifica se c'è un sovraccarico progressivo evidente nei log.

**2. ANALISI STRUTTURALE & BILANCIAMENTO**
- Osserva i \`mainExercises\` e i \`personalRecords\`.
- C'è equilibrio tra catena cinetica anteriore (es. Squat, Bench) e posteriore (es. Deadlift, Row)?
- I massimali sono proporzionati? (Es. Una panca forte ma uno squat debole indica uno squilibrio).

**3. DIAGNOSI CRITICA**
- Qual è il collo di bottiglia attuale? (Es. Volume spazzatura, frequenza incostante, selezione esercizi povera).
- Stima il livello dell'atleta (Principiante, Intermedio, Avanzato) basandoti sui carichi relativi al peso corporeo (se disponibile) o ai numeri assoluti.

**4. PIANO D'AZIONE (PROSSIME 4 SETTIMANE)**
- Fornisci 3 direttive tecniche specifiche. Non dire "allenati di più", di "Aumenta il volume settimanale sui pettorali del 10% aggiungendo 2 set di croci ai cavi".
- Suggerisci una variazione di intensità o volume basata sui dati.

**5. RECUPERO & DOMS LOCALIZZATI**
- Usa la mappa DOMS per capire quali distretti accumulano più fatica residua e quante giornate di recupero servono in media.
- Indica eventuali deload, rotazioni di esercizi o accorgimenti tecnici per quei muscoli, evitando sovrapposizioni di stimolo finché non tornano sotto controllo.

---

### 📝 FORMATO RISPOSTA

Rispondi in **Markdown** pulito.
Usa un tono **Professionale, Tecnico ma Motivante**.
Non inventare dati non presenti nel TOON.
Se mancano dati critici (es. peso corporeo), fallo notare come primo punto per migliorare l'analisi futura.

**Struttura Output:**
### 🛡️ Coach Insight per ${data.profile.name || 'Atleta'}
> *Breve frase riassuntiva sullo stato attuale (es. "Sei in una fase di accumulo produttiva, ma attenzione al recupero").*

#### 📉 Analisi Tecnica
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

            const toonLogs = this.encodeToTOON(data.recentLogs.slice(0, 5), 'lastWorkouts'); // Only last 5 needed
            const domsGuidance = buildRecentDomsBlock(data?.domsInsights?.hotspots || []);
            
            // Include existing workouts in TOON format
            const existingWorkoutsTOON = data.existingWorkouts && data.existingWorkouts.length > 0 
                ? this.encodeToTOON(data.existingWorkouts, 'existingWorkoutPlans')
                : 'existingWorkoutPlans: []';

            const prompt = `
Come Personal Trainer esperto, analizza gli ultimi allenamenti di questo atleta e suggerisci l'allenamento per OGGI.
Obiettivo: Bilanciamento muscolare e recupero.

**Schede Allenamento Create dall'Utente:**
(Queste sono le schede che l'utente ha già configurato. Se appropriato, suggerisci di usare o modificare una di queste, oppure fanne una nuova se nessuna è adatta.)
${existingWorkoutsTOON}

**Ultimi Allenamenti Svolti:**
${toonLogs}

**Segnalazioni DOMS recenti (<=4 giorni):**
${domsGuidance}

Linee guida: evita di sovraccaricare i distretti ancora doloranti, proponi varianti di recupero attivo o focus su gruppi freschi se necessario.

Rispondi in formato JSON (senza markdown, solo JSON puro):
{
    "suggestion": "Titolo Allenamento (es. Push Day o nome di una scheda esistente)",
    "focus": "Breve spiegazione del perché (es. Hai fatto gambe ieri, oggi tocca spinta)",
    "warmup": ["Esercizio 1", "Esercizio 2"],
    "main_lifts": ["Esercizio Key 1", "Esercizio Key 2"]
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

Metriche JSON:
${JSON.stringify(payload.metrics, null, 2)}

Profilo atleta:
${JSON.stringify(payload.profile || {})}

DOMS Hotspot JSON (usa questi dati per contestualizzare recupero e rischi specifici):
${JSON.stringify(domsHotspots, null, 2)}

- Tono: professionale, motivante, conciso.
- Se una sezione non ha punti rilevanti, scrivi "Nessun dato significativo" ma mantieni comunque la struttura.
- Nella sezione "Rischi / Regressioni" cita eventuali distretti con DOMS persistenti e, se serve, richiamali anche nel focus dei prossimi 7 giorni.
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
