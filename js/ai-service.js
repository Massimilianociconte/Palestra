import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

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
            const toonPrs = this.encodeToTOON(Object.entries(data.prs).map(([k,v]) => ({lift: k, weight: v})), 'personalRecords');

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
}

export const aiService = new AIService();
