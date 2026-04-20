#!/usr/bin/env node
/**
 * P3.35 — Generate the pre-rendered "double beep" WAV file shipped as a
 * static asset at `assets/audio/beep.wav`.
 *
 * This is a byte-for-byte equivalent of the WAV that
 * `NotificationManager.generateBeepDataURI()` produces at runtime, so the
 * notification sound stays identical but can be served from the cache / CDN
 * without any Web Audio work on page load.
 *
 * Run: `node scripts/generate-beep-wav.js`
 */

const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 44100;
const DURATION = 0.8;            // seconds, total file length
const NUM_SAMPLES = Math.floor(SAMPLE_RATE * DURATION);
const FREQ = 880;                 // A5
const BEEP_DURATION = 0.25;       // each of the two beeps
const PAUSE_DURATION = 0.15;      // gap between beeps

const buffer = Buffer.alloc(44 + NUM_SAMPLES * 2);

// ---- RIFF / WAVE header ----
buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + NUM_SAMPLES * 2, 4);
buffer.write("WAVE", 8);
buffer.write("fmt ", 12);
buffer.writeUInt32LE(16, 16);             // PCM chunk size
buffer.writeUInt16LE(1, 20);              // audio format = 1 (PCM)
buffer.writeUInt16LE(1, 22);              // channels = 1 (mono)
buffer.writeUInt32LE(SAMPLE_RATE, 24);
buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate (mono 16 bit)
buffer.writeUInt16LE(2, 32);              // block align
buffer.writeUInt16LE(16, 34);             // bits per sample
buffer.write("data", 36);
buffer.writeUInt32LE(NUM_SAMPLES * 2, 40);

// ---- Samples ----
for (let i = 0; i < NUM_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;
    let sample = 0;

    if (t < BEEP_DURATION) {
        // First beep: 20ms attack, slow decay
        const envelope =
            Math.min(1, t * 20) *
            Math.max(0, 1 - (t / BEEP_DURATION) * 0.5);
        sample = Math.sin(2 * Math.PI * FREQ * t) * envelope * 0.8;
    } else if (
        t >= BEEP_DURATION + PAUSE_DURATION &&
        t < BEEP_DURATION * 2 + PAUSE_DURATION
    ) {
        // Second beep, shifted by one beep + pause
        const t2 = t - BEEP_DURATION - PAUSE_DURATION;
        const envelope =
            Math.min(1, t2 * 20) *
            Math.max(0, 1 - (t2 / BEEP_DURATION) * 0.5);
        sample = Math.sin(2 * Math.PI * FREQ * t2) * envelope * 0.8;
    }

    const pcm = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(pcm, 44 + i * 2);
}

const outDir = path.join(__dirname, "..", "assets", "audio");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "beep.wav");
fs.writeFileSync(outPath, buffer);

console.log(
    "wrote",
    buffer.length,
    "bytes to",
    path.relative(path.join(__dirname, ".."), outPath)
);
