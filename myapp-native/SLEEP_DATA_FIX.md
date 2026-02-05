# Fix Calcolo Sonno - Google Fit Integration

## Problema Identificato

Il dato del sonno mostrava **15.8 ore/notte** invece delle corrette **5h17m** (media degli ultimi 7 giorni dal 17 al 23 novembre).

## Causa Root

La funzione `fetchSleep()` in `health-connect-service.js` sommava TUTTI i segmenti di sonno degli ultimi 7 giorni senza calcolare la media giornaliera:

```javascript
// PRIMA (ERRATO)
async fetchSleep(startTime, endTime) {
    const data = await this.fetchGoogleFitData('sleep', startTime, endTime);
    const sleepMinutes = data.point?.reduce((sum, point) => {
        const start = parseInt(point.startTimeNanos) / 1000000;
        const end = parseInt(point.endTimeNanos) / 1000000;
        return sum + ((end - start) / (1000 * 60));
    }, 0) || 0;
    return Math.round(sleepMinutes / 60 * 10) / 10; // Totale 7 giorni!
}
```

Risultato: 5.27 ore/notte × 7 giorni = ~37 ore totali → salvato come valore singolo

## Soluzione Implementata

Modificata la funzione per raggruppare i segmenti per giorno e calcolare la media:

```javascript
// DOPO (CORRETTO)
async fetchSleep(startTime, endTime) {
    const data = await this.fetchGoogleFitData('sleep', startTime, endTime);
    
    // Raggruppa i segmenti di sonno per giorno
    const sleepByDay = {};
    
    data.point?.forEach(point => {
        const start = parseInt(point.startTimeNanos) / 1000000;
        const end = parseInt(point.endTimeNanos) / 1000000;
        const duration = (end - start) / (1000 * 60); // minuti
        
        const dayKey = new Date(start).toISOString().split('T')[0];
        
        if (!sleepByDay[dayKey]) {
            sleepByDay[dayKey] = 0;
        }
        sleepByDay[dayKey] += duration;
    });
    
    // Calcola la media giornaliera
    const days = Object.keys(sleepByDay);
    if (days.length === 0) return 0;
    
    const totalMinutes = Object.values(sleepByDay).reduce((sum, min) => sum + min, 0);
    const avgMinutes = totalMinutes / days.length;
    
    return Math.round(avgMinutes / 60 * 10) / 10;
}
```

## Modifiche ai Prompt AI

Aggiornati tutti i prompt in `ai-service.js` per chiarire che:
- **Passi**: valore settimanale cumulativo
- **Calorie**: valore settimanale cumulativo (TDEE completo)
- **Sonno**: **media giornaliera** (non totale settimanale)
- **Distanza**: valore settimanale cumulativo

## Contesto Importante per l'AI

**NOTA PER L'ANALISI AI:**
L'utente ha iniziato il tracking con IronFlow il **21 novembre 2025**. I dati mostrano:
- 2 "sessioni" negli ultimi 30 giorni
- In realtà: **1 singola sessione di allenamento** svolta in 2 giorni consecutivi (21-22 novembre)
- La sessione ha allenato 2 gruppi muscolari diversi (split training)

Quindi l'analisi deve considerare:
- Frequenza reale: 1 sessione completa in 2-3 giorni (non 2 sessioni separate)
- Periodo di tracking: solo 2-3 giorni, non 30 giorni
- L'atleta è appena iniziato con l'app, non ha "abbandonato" l'allenamento

## Test da Eseguire

1. Disconnetti e riconnetti Google Fit
2. Forza una nuova sincronizzazione
3. Verifica che il valore del sonno sia ora ~5.3 ore/notte
4. Genera un nuovo report AI e verifica che non menzioni più anomalie sul sonno

## File Modificati

- `js/health-connect-service.js` - Fix calcolo media sonno
- `js/ai-service.js` - Aggiornati 3 prompt (analyzeProgress, predictNextSession, generateTrendDigest)
