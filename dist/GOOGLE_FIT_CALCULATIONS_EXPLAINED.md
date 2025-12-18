# Google Fit - Spiegazione Dettagliata dei Calcoli

## Data: 28 Novembre 2025 (Aggiornato)

Questo documento spiega in dettaglio come vengono calcolati tutti i dati prelevati da Google Fit.

> **IMPORTANTE - Aggiornamento 28 Nov 2025**: I calcoli sono stati corretti per mostrare **MEDIE GIORNALIERE** invece di totali settimanali. Questo risolve il problema dei valori che diminuivano col passare dei giorni.

---

## 1. PASSI (Steps) - MEDIA GIORNALIERA

### Logica Corretta (Aggiornata)
I passi vengono ora calcolati come **MEDIA GIORNALIERA** degli ultimi 7 giorni, non come totale settimanale.

### Dati Ricevuti da Google Fit
```javascript
{
  "point": [
    {
      "startTimeNanos": "1700000000000000000",
      "endTimeNanos": "1700000600000000000",
      "value": [{ "intVal": 150 }]  // 150 passi in questo intervallo
    },
    // ... altri intervalli
  ]
}
```

### Calcolo CORRETTO
```javascript
// 1. Raggruppa i passi per GIORNO
const stepsByDay = {};

data.point.forEach(point => {
    const steps = point.value[0].intVal;
    const endNanos = point.endTimeNanos;
    
    // Attribuisci al giorno corretto
    const dayKey = new Date(parseInt(endNanos) / 1000000).toISOString().split('T')[0];
    
    if (!stepsByDay[dayKey]) {
        stepsByDay[dayKey] = new Map(); // Map per evitare duplicati
    }
    
    const intervalKey = `${startNanos}-${endNanos}`;
    stepsByDay[dayKey].set(intervalKey, Math.max(
        stepsByDay[dayKey].get(intervalKey) || 0, 
        steps
    ));
});

// 2. Calcola totale per ogni giorno
const dailyTotals = {};
Object.entries(stepsByDay).forEach(([day, intervalsMap]) => {
    dailyTotals[day] = Array.from(intervalsMap.values()).reduce((sum, s) => sum + s, 0);
});

// 3. Calcola MEDIA GIORNALIERA
const daysWithData = Object.keys(dailyTotals).length;
const totalSteps = Object.values(dailyTotals).reduce((sum, s) => sum + s, 0);
const dailyAverage = Math.round(totalSteps / daysWithData);

// Esempio:
// Giorno 1: 8,500 passi
// Giorno 2: 10,200 passi
// Giorno 3: 7,800 passi
// Media: (8500 + 10200 + 7800) / 3 = 8,833 passi/giorno
```

### Perché Media Giornaliera?
- **Consistenza**: Il valore non diminuisce quando passa un giorno
- **Confrontabilità**: Puoi confrontare con obiettivi giornalieri (es. 10,000 passi/giorno)
- **Accuratezza**: Riflette la tua attività media reale

---

## 2. SONNO (Sleep)

### Dati Ricevuti da Google Fit
```javascript
{
  "point": [
    {
      "startTimeNanos": "1700000000000000000",  // 23:00 del giorno X
      "endTimeNanos": "1700028800000000000",    // 07:00 del giorno X+1
      "value": [{ "intVal": 4 }]  // Type 4 = Light Sleep
    },
    {
      "startTimeNanos": "1700028800000000000",  // 07:00
      "endTimeNanos": "1700030400000000000",    // 07:30
      "value": [{ "intVal": 1 }]  // Type 1 = Awake (NON contare!)
    },
    {
      "startTimeNanos": "1700030400000000000",  // 07:30
      "endTimeNanos": "1700032000000000000",    // 08:00
      "value": [{ "intVal": 5 }]  // Type 5 = Deep Sleep
    }
    // ... altri segmenti
  ]
}
```

### Tipi di Segmenti Sonno
```javascript
const SLEEP_TYPES = {
    1: "Awake",           // ❌ NON contare
    2: "Sleep",           // ✅ Contare
    3: "Out-of-bed",      // ❌ NON contare
    4: "Light Sleep",     // ✅ Contare
    5: "Deep Sleep",      // ✅ Contare
    6: "REM Sleep"        // ✅ Contare
};

const VALID_SLEEP_TYPES = [2, 4, 5, 6];  // Solo questi contano come sonno
```

### Calcolo
```javascript
// 1. Creo un oggetto per raggruppare per giorno
const sleepByDay = {};

// 2. Per ogni segmento di sonno
data.point.forEach(point => {
    const sleepType = point.value[0].intVal;  // Es: 4 (Light Sleep)
    
    // 3. Salta se non è sonno effettivo (es: Awake)
    if (![2, 4, 5, 6].includes(sleepType)) {
        return;  // Salta questo segmento
    }
    
    // 4. Calcola la durata in minuti
    const start = parseInt(point.startTimeNanos) / 1000000;  // Converti da nanosecondi a millisecondi
    const end = parseInt(point.endTimeNanos) / 1000000;
    const durationMinutes = (end - start) / (1000 * 60);  // Converti in minuti
    
    // Esempio: (1700028800000 - 1700000000000) / (1000 * 60) = 480 minuti = 8 ore
    
    // 5. Raggruppa per giorno (usa la data di inizio)
    const dayKey = new Date(start).toISOString().split('T')[0];  // Es: "2025-11-24"
    
    if (!sleepByDay[dayKey]) {
        sleepByDay[dayKey] = {
            totalMinutes: 0,
            segments: []
        };
    }
    
    // 6. Aggiungi i minuti al totale del giorno
    sleepByDay[dayKey].totalMinutes += durationMinutes;
    sleepByDay[dayKey].segments.push({
        type: sleepType,
        minutes: Math.round(durationMinutes)
    });
});

// 7. Calcola la media giornaliera
const days = Object.keys(sleepByDay);  // Es: ["2025-11-24", "2025-11-25", "2025-11-26"]
const totalMinutes = Object.values(sleepByDay)
    .reduce((sum, data) => sum + data.totalMinutes, 0);
    
// Esempio: (480 + 420 + 510) / 3 = 470 minuti = 7.83 ore

const avgMinutes = totalMinutes / days.length;
const avgHours = avgMinutes / 60;

return Math.round(avgHours * 10) / 10;  // Arrotonda a 1 decimale: 7.8 ore
```

### Esempio Pratico
```
Giorno 1 (24 Nov):
  - Light Sleep: 23:00-01:00 = 120 min
  - Deep Sleep: 01:00-03:00 = 120 min
  - REM Sleep: 03:00-05:00 = 120 min
  - Light Sleep: 05:00-07:00 = 120 min
  - Awake: 07:00-07:30 = 30 min (NON contato)
  Totale: 480 min = 8.0 ore

Giorno 2 (25 Nov):
  - Light Sleep: 23:30-02:00 = 150 min
  - Deep Sleep: 02:00-04:00 = 120 min
  - REM Sleep: 04:00-06:30 = 150 min
  Totale: 420 min = 7.0 ore

Giorno 3 (26 Nov):
  - Light Sleep: 22:00-01:00 = 180 min
  - Deep Sleep: 01:00-03:30 = 150 min
  - REM Sleep: 03:30-06:00 = 150 min
  - Awake: 06:00-06:30 = 30 min (NON contato)
  Totale: 480 min = 8.0 ore

Media: (8.0 + 7.0 + 8.0) / 3 = 7.7 ore/notte
```

---

## 3. BATTITO CARDIACO (Heart Rate)

### Dati Ricevuti da Google Fit
```javascript
{
  "point": [
    { "value": [{ "fpVal": 72.5 }] },  // 72.5 bpm
    { "value": [{ "fpVal": 68.0 }] },  // 68.0 bpm
    { "value": [{ "fpVal": 250.0 }] }, // 250 bpm (OUTLIER!)
    { "value": [{ "fpVal": 75.3 }] },  // 75.3 bpm
    { "value": [{ "fpVal": 20.0 }] },  // 20 bpm (OUTLIER!)
    { "value": [{ "fpVal": 70.8 }] },  // 70.8 bpm
    // ... centinaia di valori
  ]
}
```

### Calcolo con Rimozione Outliers (Metodo IQR)
```javascript
// 1. Estrai tutti i valori validi (range fisiologico 30-220 bpm)
const hrValues = data.point
    .map(p => p.value[0].fpVal)
    .filter(v => v && v > 30 && v < 220);

// Esempio: [72.5, 68.0, 75.3, 70.8, 65.2, 78.1, 69.5, 73.2]

// 2. Ordina i valori
const sorted = [...hrValues].sort((a, b) => a - b);
// Risultato: [65.2, 68.0, 69.5, 70.8, 72.5, 73.2, 75.3, 78.1]

// 3. Calcola Q1 (primo quartile - 25%)
const q1Index = Math.floor(sorted.length * 0.25);  // 8 * 0.25 = 2
const q1 = sorted[q1Index];  // sorted[2] = 69.5

// 4. Calcola Q3 (terzo quartile - 75%)
const q3Index = Math.floor(sorted.length * 0.75);  // 8 * 0.75 = 6
const q3 = sorted[q3Index];  // sorted[6] = 75.3

// 5. Calcola IQR (Interquartile Range)
const iqr = q3 - q1;  // 75.3 - 69.5 = 5.8

// 6. Calcola i limiti per gli outliers
const lowerBound = q1 - 1.5 * iqr;  // 69.5 - (1.5 * 5.8) = 60.8
const upperBound = q3 + 1.5 * iqr;  // 75.3 + (1.5 * 5.8) = 84.0

// 7. Filtra gli outliers
const filteredValues = hrValues.filter(v => v >= lowerBound && v <= upperBound);
// Risultato: [65.2, 68.0, 69.5, 70.8, 72.5, 73.2, 75.3, 78.1]
// (In questo esempio, nessun valore è outlier)

// 8. Calcola la media
const avgHR = filteredValues.reduce((a, b) => a + b, 0) / filteredValues.length;
// (65.2 + 68.0 + 69.5 + 70.8 + 72.5 + 73.2 + 75.3 + 78.1) / 8 = 71.6

return Math.round(avgHR);  // 72 bpm
```

### Esempio con Outliers
```
Valori originali: [72, 68, 250, 75, 20, 70, 73, 69]

Dopo filtro fisiologico (30-220): [72, 68, 250, 75, 70, 73, 69]
(20 bpm rimosso)

Ordinati: [68, 69, 70, 72, 73, 75, 250]

Q1 (25%): 69
Q3 (75%): 75
IQR: 75 - 69 = 6

Lower Bound: 69 - (1.5 * 6) = 60
Upper Bound: 75 + (1.5 * 6) = 84

Dopo rimozione outliers: [68, 69, 70, 72, 73, 75]
(250 bpm rimosso come outlier)

Media finale: (68 + 69 + 70 + 72 + 73 + 75) / 6 = 71.2 ≈ 71 bpm
```

---

## 4. CALORIE

### Dati Ricevuti da Google Fit
```javascript
{
  "point": [
    { "value": [{ "fpVal": 85.5 }] },   // 85.5 kcal in questo intervallo
    { "value": [{ "fpVal": 120.3 }] },  // 120.3 kcal
    { "value": [{ "fpVal": 95.7 }] },   // 95.7 kcal
    // ... molti intervalli
  ]
}
```

### Calcolo
```javascript
// Somma semplice di tutti i valori
const totalCalories = data.point.reduce((sum, point) => {
    return sum + (point.value[0].fpVal || 0);
}, 0);

// Esempio: 85.5 + 120.3 + 95.7 + ... = 15,648 kcal (settimanale)

return Math.round(totalCalories);  // 15,648 kcal
```

### Nota Importante
Le calorie includono:
- **BMR** (Metabolismo Basale): ~1,800 kcal/giorno
- **NEAT** (Attività quotidiana): calorie dai passi
- **NON include**: allenamenti specifici registrati separatamente

Esempio settimanale:
```
BMR: 1,800 kcal/giorno × 7 giorni = 12,600 kcal
NEAT: 300 kcal/giorno × 7 giorni = 2,100 kcal
Totale: 14,700 kcal/settimana
```

---

## 5. DISTANZA

### Dati Ricevuti da Google Fit
```javascript
{
  "point": [
    { "value": [{ "fpVal": 850.5 }] },   // 850.5 metri
    { "value": [{ "fpVal": 1200.3 }] },  // 1200.3 metri
    { "value": [{ "fpVal": 650.0 }] },   // 650 metri
    // ... molti intervalli
  ]
}
```

### Calcolo
```javascript
// Somma tutti i delta di distanza (in metri)
const totalDistance = data.point.reduce((sum, point) => {
    return sum + (point.value[0].fpVal || 0);
}, 0);

// Esempio: 850.5 + 1200.3 + 650.0 + ... = 45,230 metri

return totalDistance;  // 45,230 metri = 45.23 km
```

### Conversione per Display
```javascript
const distanceKm = totalDistance / 1000;  // 45.23 km
const distanceMiles = totalDistance / 1609.34;  // 28.1 miglia
```

---

## 6. PESO (Weight)

### Dati Ricevuti da Google Fit
```javascript
{
  "point": [
    { "value": [{ "fpVal": 79.5 }], "startTimeNanos": "1700000000000000000" },  // 79.5 kg il 24 Nov
    { "value": [{ "fpVal": 79.3 }], "startTimeNanos": "1700086400000000000" },  // 79.3 kg il 25 Nov
    { "value": [{ "fpVal": 79.7 }], "startTimeNanos": "1700172800000000000" },  // 79.7 kg il 26 Nov
  ]
}
```

### Calcolo
```javascript
// Prendi l'ULTIMO peso registrato (più recente)
const weights = data.point
    .map(p => p.value[0].fpVal)
    .filter(v => v);

if (weights.length === 0) return null;

return weights[weights.length - 1];  // 79.7 kg (ultimo valore)
```

### Perché l'ultimo?
- Il peso più recente è il più rilevante
- Google Fit può avere misurazioni multiple al giorno
- L'ultimo valore è tipicamente la misurazione più accurata

---

## RIEPILOGO FORMULE

### Passi
```
Totale = Σ(passi_unici_per_intervallo)
```

### Sonno
```
Media ore/notte = (Σ minuti_sonno_effettivo_per_giorno) / numero_giorni / 60
```

### Battito Cardiaco
```
1. Filtra: 30 < bpm < 220
2. Calcola Q1, Q3, IQR
3. Rimuovi outliers: valore < Q1-1.5×IQR o valore > Q3+1.5×IQR
4. Media = Σ(valori_filtrati) / count
```

### Calorie
```
Totale = Σ(calorie_per_intervallo)
```

### Distanza
```
Totale metri = Σ(distanza_per_intervallo)
Totale km = Totale metri / 1000
```

### Peso
```
Peso attuale = ultimo_valore_registrato
```

---

## CONVERSIONI TEMPORALI

### Nanosecondi → Millisecondi
```javascript
const milliseconds = parseInt(nanos) / 1000000;
```

### Millisecondi → Data
```javascript
const date = new Date(milliseconds);
const dayKey = date.toISOString().split('T')[0];  // "2025-11-24"
```

### Minuti → Ore
```javascript
const hours = minutes / 60;
const hoursRounded = Math.round(hours * 10) / 10;  // 1 decimale
```

---

## GESTIONE ERRORI

Tutti i calcoli gestiscono:
- **Dati mancanti**: Ritorna `null` o `0`
- **Valori invalidi**: Filtrati prima del calcolo
- **Array vuoti**: Controllo `length === 0`
- **Outliers**: Rimossi con metodo statistico

Esempio:
```javascript
if (!data.point || data.point.length === 0) {
    console.log('No data available');
    return null;
}
```
