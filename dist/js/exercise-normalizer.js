/**
 * Exercise Normalizer Service
 * Normalizza i nomi degli esercizi usando AI per evitare duplicati semantici
 * Now uses Firebase Cloud Functions for secure API key management.
 */

export class ExerciseNormalizer {
    constructor() {
        this.exerciseCache = new Map(); // Cache per evitare chiamate API ripetute
        this.existingExercises = [];
    }

    /**
     * Carica la lista di esercizi esistenti dal localStorage
     */
    loadExistingExercises() {
        const exercises = new Set();

        // Da logs
        try {
            const logs = JSON.parse(localStorage.getItem('ironflow_logs') || '[]');
            logs.forEach(log => {
                (log.exercises || []).forEach(ex => {
                    if (ex.name) exercises.add(ex.name.trim());
                });
            });
        } catch (e) {
            console.warn('[ExerciseNormalizer] Failed to parse ironflow_logs:', e.message);
        }

        // Da workout salvati
        try {
            const workouts = JSON.parse(localStorage.getItem('ironflow_workouts') || '[]');
            workouts.forEach(workout => {
                (workout.exercises || []).forEach(ex => {
                    if (ex.name) exercises.add(ex.name.trim());
                });
            });
        } catch (e) {
            console.warn('[ExerciseNormalizer] Failed to parse ironflow_workouts:', e.message);
        }

        // Da PR tracker
        try {
            const prs = JSON.parse(localStorage.getItem('ironflow_personal_records') || '{}');
            Object.values(prs).forEach(pr => {
                if (pr.displayName) exercises.add(pr.displayName);
            });
        } catch (e) {
            console.warn('[ExerciseNormalizer] Failed to parse ironflow_personal_records:', e.message);
        }

        this.existingExercises = Array.from(exercises).sort();
        return this.existingExercises;
    }

    /**
     * Ottieni la lista esercizi formattata per il prompt AI
     */
    getExerciseListForPrompt() {
        this.loadExistingExercises();
        if (this.existingExercises.length === 0) {
            return "Nessun esercizio esistente nel database.";
        }
        return this.existingExercises.join('\n');
    }

    /**
     * Normalizza un singolo nome di esercizio usando matching locale
     * (senza chiamata API, per performance)
     */
    normalizeLocally(exerciseName) {
        if (!exerciseName) return exerciseName;

        const normalized = this._normalizeString(exerciseName);

        // Cerca match esatto (case insensitive)
        for (const existing of this.existingExercises) {
            if (this._normalizeString(existing) === normalized) {
                return existing; // Ritorna il nome esistente
            }
        }

        // Cerca match fuzzy (similarity > 85%)
        for (const existing of this.existingExercises) {
            if (this._calculateSimilarity(normalized, this._normalizeString(existing)) > 0.85) {
                return existing; // Ritorna il nome esistente
            }
        }

        return exerciseName; // Nessun match, ritorna originale
    }

    /**
     * Normalizza una lista di esercizi
     * @deprecated Use normalizeWithCloudFunction instead
     * This method now only uses local normalization for backward compatibility
     */
    async normalizeWithAI(exerciseNames, apiKey) {
        // Legacy method - now uses only local normalization
        // Use normalizeWithCloudFunction for AI-powered normalization
        console.warn('normalizeWithAI is deprecated. Use normalizeWithCloudFunction instead.');

        if (!exerciseNames || exerciseNames.length === 0) {
            return exerciseNames;
        }

        this.loadExistingExercises();

        if (this.existingExercises.length === 0) {
            return exerciseNames;
        }

        // Use local normalization only
        return exerciseNames.map(name => this.normalizeLocally(name));
    }

    /**
     * Normalizza una lista di esercizi usando Cloud Function
     * @param {string[]} exerciseNames - Lista di nomi esercizi da normalizzare
     * @param {function} generateContentCallable - httpsCallable function from ai-service
     */
    async normalizeWithCloudFunction(exerciseNames, generateContentCallable) {
        if (!generateContentCallable || !exerciseNames || exerciseNames.length === 0) {
            return exerciseNames;
        }

        this.loadExistingExercises();

        if (this.existingExercises.length === 0) {
            return exerciseNames;
        }

        const uncached = exerciseNames.filter(name => !this.exerciseCache.has(name));

        if (uncached.length === 0) {
            return exerciseNames.map(name => this.exerciseCache.get(name) || name);
        }

        try {
            const prompt = `Sei un assistente per la normalizzazione dei nomi degli esercizi di palestra.

ESERCIZI GIÀ ESISTENTI NEL DATABASE:
${this.existingExercises.join('\n')}

ESERCIZI DA NORMALIZZARE:
${uncached.join('\n')}

REGOLE IMPORTANTI:
1. Se un esercizio da normalizzare è IDENTICO o SEMANTICAMENTE EQUIVALENTE a uno esistente, ritorna ESATTAMENTE il nome esistente (stesso casing, stessa stringa)
2. Considera equivalenti variazioni come: singolare/plurale, con/senza articoli, abbreviazioni comuni
3. Se l'esercizio è NUOVO e non ha equivalenti, ritornalo esattamente come fornito
4. NON inventare nuovi nomi, NON modificare la formattazione se non necessario

FORMATO RISPOSTA (JSON array, mantenendo l'ordine):
["nome1", "nome2", ...]

Rispondi SOLO con il JSON array, nient'altro.`;

            const result = await generateContentCallable({
                prompt: prompt,
                config: { temperature: 0.1, maxOutputTokens: 1024 },
                modelName: 'gemini-3-flash-preview'
            });

            const text = result.data.text.trim();

            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const normalized = JSON.parse(jsonMatch[0]);

                uncached.forEach((name, i) => {
                    if (normalized[i]) {
                        this.exerciseCache.set(name, normalized[i]);
                    }
                });

                return exerciseNames.map(name => this.exerciseCache.get(name) || name);
            }
        } catch (error) {
            console.warn('Exercise normalization Cloud Function failed:', error);
        }

        return exerciseNames.map(name => this.normalizeLocally(name));
    }

    /**
     * Ottieni il prompt prefix per l'AI quando genera workout
     * Da includere in ogni prompt che genera esercizi
     */
    getAINormalizationPrompt() {
        this.loadExistingExercises();

        if (this.existingExercises.length === 0) {
            return '';
        }

        return `
IMPORTANTE - NORMALIZZAZIONE NOMI ESERCIZI:
L'utente ha già registrato questi esercizi nel database:
${this.existingExercises.slice(0, 50).join(', ')}${this.existingExercises.length > 50 ? `... e altri ${this.existingExercises.length - 50} esercizi` : ''}

REGOLA CRITICA: Se devi suggerire un esercizio che è CONCETTUALMENTE IDENTICO a uno già esistente nella lista sopra, DEVI usare ESATTAMENTE lo stesso nome (stesso casing, stessa stringa) già presente nel database.
Solo se l'esercizio è completamente NUOVO e non sovrapponibile a quelli esistenti, puoi creare un nome nuovo.
Questo garantisce coerenza nei dati e nelle statistiche dell'utente.

`;
    }

    // --- Utility Methods ---

    _normalizeString(str) {
        return (str || '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[()[\]{}]/g, '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, ''); // Rimuovi accenti
    }

    _calculateSimilarity(str1, str2) {
        if (str1 === str2) return 1;
        if (!str1 || !str2) return 0;

        const getBigrams = (str) => {
            const bigrams = new Set();
            for (let i = 0; i < str.length - 1; i++) {
                bigrams.add(str.slice(i, i + 2));
            }
            return bigrams;
        };

        const bigrams1 = getBigrams(str1);
        const bigrams2 = getBigrams(str2);

        let intersection = 0;
        bigrams1.forEach(b => {
            if (bigrams2.has(b)) intersection++;
        });

        return (2 * intersection) / (bigrams1.size + bigrams2.size);
    }
}

// Singleton export
export const exerciseNormalizer = new ExerciseNormalizer();
