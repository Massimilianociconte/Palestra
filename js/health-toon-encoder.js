/**
 * Health TOON Encoder/Decoder
 * Gestisce la codifica/decodifica dei dati health in formato TOON compatto
 */

class HealthTOONEncoder {
    constructor() {
        // Mapping tipi dati health
        this.types = {
            STEPS: 'S',
            HEART_RATE: 'HR',
            WEIGHT: 'W',
            SLEEP: 'SL',
            CALORIES: 'C',
            DISTANCE: 'D',
            ACTIVE_MINUTES: 'AM',
            HRV: 'HRV',
            BODY_FAT: 'BF',
            BMI: 'BMI',
            WATER: 'H2O',
            PROTEIN: 'P',
            CARBS: 'CH',
            FATS: 'F'
        };

        // Reverse mapping per decode
        this.reverseTypes = Object.fromEntries(
            Object.entries(this.types).map(([k, v]) => [v, k])
        );
    }

    /**
     * Encode singolo dato health in formato TOON
     * @param {string} type - Tipo dato (es. 'STEPS')
     * @param {number} value - Valore
     * @param {string|Date} timestamp - Timestamp
     * @param {string} unit - Unità di misura
     * @returns {string} Stringa TOON
     */
    encode(type, value, timestamp, unit) {
        const typeCode = this.types[type] || type;
        const ts = this.formatTimestamp(timestamp);
        return `${typeCode}|${value}|${ts}|${unit}`;
    }

    /**
     * Decode stringa TOON in oggetto
     * @param {string} toonString - Stringa TOON
     * @returns {object} Oggetto decodificato
     */
    decode(toonString) {
        const [typeCode, value, timestamp, unit] = toonString.split('|');
        const type = this.reverseTypes[typeCode] || typeCode;
        
        return {
            type,
            typeCode,
            value: parseFloat(value),
            timestamp: this.parseTimestamp(timestamp),
            unit
        };
    }

    /**
     * Encode batch di dati health
     * @param {Array} healthData - Array di oggetti health
     * @returns {object} Oggetto con dati TOON encoded
     */
    encodeBatch(healthData) {
        const encoded = {};
        
        for (const data of healthData) {
            const key = data.type.toLowerCase();
            encoded[key] = this.encode(
                data.type,
                data.value,
                data.timestamp,
                data.unit
            );
        }
        
        return encoded;
    }

    /**
     * Decode batch di dati TOON
     * @param {object} toonData - Oggetto con stringhe TOON
     * @returns {Array} Array di oggetti decodificati
     */
    decodeBatch(toonData) {
        const decoded = [];
        
        for (const [key, toonString] of Object.entries(toonData)) {
            if (typeof toonString === 'string' && toonString.includes('|')) {
                decoded.push(this.decode(toonString));
            }
        }
        
        return decoded;
    }

    /**
     * Encode dati aggregati (medie, totali)
     * @param {string} type - Tipo dato
     * @param {number} value - Valore aggregato
     * @param {string} period - Periodo (7d, 30d, etc)
     * @param {string} unit - Unità
     * @returns {string} Stringa TOON aggregata
     */
    encodeAggregate(type, value, period, unit) {
        const typeCode = this.types[type] || type;
        return `${typeCode}|${value}|${period}|${unit}`;
    }

    /**
     * Formatta timestamp per TOON
     * @param {string|Date|number} timestamp
     * @returns {string} Timestamp formattato
     */
    formatTimestamp(timestamp) {
        if (!timestamp) {
            return new Date().toISOString().split('T')[0].replace(/-/g, '');
        }
        
        if (timestamp instanceof Date) {
            return timestamp.toISOString().split('T')[0].replace(/-/g, '');
        }
        
        if (typeof timestamp === 'number') {
            return new Date(timestamp).toISOString().split('T')[0].replace(/-/g, '');
        }
        
        // Se è già una stringa, rimuovi separatori
        return timestamp.replace(/[-:T]/g, '').substring(0, 8);
    }

    /**
     * Parse timestamp TOON in Date
     * @param {string} toonTimestamp - Timestamp TOON (es. "20231123" o "7d")
     * @returns {Date|string} Date object o stringa periodo
     */
    parseTimestamp(toonTimestamp) {
        // Se è un periodo (es. "7d", "30d")
        if (toonTimestamp.includes('d') || toonTimestamp === 'latest') {
            return toonTimestamp;
        }
        
        // Parse formato YYYYMMDD
        if (toonTimestamp.length === 8) {
            const year = toonTimestamp.substring(0, 4);
            const month = toonTimestamp.substring(4, 6);
            const day = toonTimestamp.substring(6, 8);
            return new Date(`${year}-${month}-${day}`);
        }
        
        // Parse formato YYYYMMDDTHHmm
        if (toonTimestamp.length >= 12) {
            const year = toonTimestamp.substring(0, 4);
            const month = toonTimestamp.substring(4, 6);
            const day = toonTimestamp.substring(6, 8);
            const hour = toonTimestamp.substring(9, 11);
            const minute = toonTimestamp.substring(11, 13);
            return new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
        }
        
        return new Date(toonTimestamp);
    }

    /**
     * Crea summary TOON per AI context
     * @param {Array} healthData - Dati health grezzi
     * @param {number} days - Giorni da aggregare
     * @returns {object} Summary TOON
     */
    createAISummary(healthData, days = 7) {
        const summary = {};
        const now = Date.now();
        const cutoff = now - (days * 24 * 60 * 60 * 1000);
        
        // Filtra dati recenti
        const recentData = healthData.filter(d => {
            const ts = typeof d.timestamp === 'number' ? d.timestamp : new Date(d.timestamp).getTime();
            return ts >= cutoff;
        });
        
        // Aggrega per tipo
        const grouped = {};
        for (const data of recentData) {
            if (!grouped[data.type]) {
                grouped[data.type] = [];
            }
            grouped[data.type].push(data.value);
        }
        
        // Calcola medie e encode
        for (const [type, values] of Object.entries(grouped)) {
            if (values.length === 0) continue;
            
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            const unit = recentData.find(d => d.type === type)?.unit || '';
            
            summary[type.toLowerCase()] = this.encodeAggregate(
                type,
                Math.round(avg * 10) / 10, // 1 decimale
                `${days}d`,
                unit
            );
        }
        
        // Aggiungi ultimo peso se disponibile
        const weightData = recentData.filter(d => d.type === 'WEIGHT');
        if (weightData.length > 0) {
            const latest = weightData[weightData.length - 1];
            summary.weight_latest = this.encode('WEIGHT', latest.value, latest.timestamp, latest.unit);
        }
        
        return summary;
    }

    /**
     * Valida stringa TOON
     * @param {string} toonString - Stringa da validare
     * @returns {boolean} True se valida
     */
    isValidTOON(toonString) {
        if (typeof toonString !== 'string') return false;
        
        const parts = toonString.split('|');
        if (parts.length !== 4) return false;
        
        const [type, value, timestamp, unit] = parts;
        
        // Valida tipo
        if (!this.reverseTypes[type] && !Object.values(this.types).includes(type)) {
            return false;
        }
        
        // Valida valore numerico
        if (isNaN(parseFloat(value))) return false;
        
        // Valida timestamp o periodo
        if (!timestamp || timestamp.length === 0) return false;
        
        // Valida unità
        if (!unit || unit.length === 0) return false;
        
        return true;
    }

    /**
     * Converte dati Google Fit in formato TOON
     * @param {object} googleFitData - Dati da Google Fit API
     * @returns {object} Dati in formato TOON
     */
    fromGoogleFit(googleFitData) {
        const toonData = {};
        const timestamp = new Date();
        
        // Steps
        if (googleFitData.steps) {
            toonData.steps = this.encode('STEPS', googleFitData.steps, timestamp, 'steps');
        }
        
        // Heart Rate
        if (googleFitData.heartRate) {
            toonData.heartRate = this.encode('HEART_RATE', googleFitData.heartRate, timestamp, 'bpm');
        }
        
        // Weight
        if (googleFitData.weight) {
            toonData.weight = this.encode('WEIGHT', googleFitData.weight, timestamp, 'kg');
        }
        
        // Sleep
        if (googleFitData.sleep) {
            toonData.sleep = this.encode('SLEEP', googleFitData.sleep, timestamp, 'hours');
        }
        
        // Calories
        if (googleFitData.calories) {
            toonData.calories = this.encode('CALORIES', googleFitData.calories, timestamp, 'kcal');
        }
        
        // Distance
        if (googleFitData.distance) {
            toonData.distance = this.encode('DISTANCE', googleFitData.distance / 1000, timestamp, 'km');
        }
        
        // Active Minutes
        if (googleFitData.activeMinutes) {
            toonData.activeMinutes = this.encode('ACTIVE_MINUTES', googleFitData.activeMinutes, timestamp, 'min');
        }
        
        return toonData;
    }

    /**
     * Formatta dati TOON per display umano
     * @param {string} toonString - Stringa TOON
     * @returns {string} Stringa formattata
     */
    formatForDisplay(toonString) {
        if (!this.isValidTOON(toonString)) return toonString;
        
        const decoded = this.decode(toonString);
        const typeNames = {
            STEPS: 'Passi',
            HEART_RATE: 'Frequenza Cardiaca',
            WEIGHT: 'Peso',
            SLEEP: 'Sonno',
            CALORIES: 'Calorie',
            DISTANCE: 'Distanza',
            ACTIVE_MINUTES: 'Minuti Attivi',
            HRV: 'Variabilità FC',
            BODY_FAT: 'Grasso Corporeo',
            BMI: 'BMI'
        };
        
        const typeName = typeNames[decoded.type] || decoded.type;
        const value = decoded.value;
        const unit = decoded.unit;
        
        return `${typeName}: ${value} ${unit}`;
    }

    /**
     * Decodifica un record health da Firestore (con stringhe TOON) in oggetto semplice
     * @param {object} healthRecord - Record da Firestore con stringhe TOON
     * @returns {object} Oggetto con valori decodificati
     */
    decodeHealthData(healthRecord) {
        const decoded = {
            steps: null,
            heartRate: null,
            weight: null,
            sleep: null,
            calories: null,
            distance: null,
            activeMinutes: null,
            syncTimestamp: healthRecord.syncTimestamp || null,
            source: healthRecord.source || null
        };

        // Decodifica ogni campo TOON se presente
        if (healthRecord.steps && this.isValidTOON(healthRecord.steps)) {
            decoded.steps = this.decode(healthRecord.steps).value;
        }

        if (healthRecord.heartRate && this.isValidTOON(healthRecord.heartRate)) {
            decoded.heartRate = this.decode(healthRecord.heartRate).value;
        }

        if (healthRecord.weight && this.isValidTOON(healthRecord.weight)) {
            decoded.weight = this.decode(healthRecord.weight).value;
        }

        if (healthRecord.sleep && this.isValidTOON(healthRecord.sleep)) {
            decoded.sleep = this.decode(healthRecord.sleep).value;
        }

        if (healthRecord.calories && this.isValidTOON(healthRecord.calories)) {
            decoded.calories = this.decode(healthRecord.calories).value;
        }

        if (healthRecord.distance && this.isValidTOON(healthRecord.distance)) {
            // Distance è salvata in km nel TOON, convertiamo in metri per consistenza
            decoded.distance = this.decode(healthRecord.distance).value * 1000;
        }

        if (healthRecord.activeMinutes && this.isValidTOON(healthRecord.activeMinutes)) {
            decoded.activeMinutes = this.decode(healthRecord.activeMinutes).value;
        }

        return decoded;
    }
}

// Export singleton
export const healthTOONEncoder = new HealthTOONEncoder();
