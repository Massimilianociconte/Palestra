export const EXERCISE_DB = {
    // Chest
    "panca piana": ["chest", "triceps", "front-delts"],
    "panca inclinata": ["upper-chest", "triceps", "front-delts"],
    "croci": ["chest"],
    "chest press": ["chest", "triceps"],
    "piegamenti": ["chest", "abs"],
    "bench press": ["chest", "triceps", "front-delts"],
    "push up": ["chest", "abs"],
    "dips": ["chest", "triceps"],

    // Back
    "trazioni": ["lats", "biceps", "traps"],
    "lat machine": ["lats", "biceps"],
    "pulley": ["lats", "rhomboids", "biceps"],
    "rematore": ["lats", "rhomboids", "biceps", "lower-back"],
    "pull up": ["lats", "biceps"],
    "row": ["lats", "rhomboids"],
    "deadlift": ["hamstrings", "glutes", "lower-back", "traps"],
    "stacco": ["hamstrings", "glutes", "lower-back", "traps"],

    // Legs
    "squat": ["quads", "glutes", "core"],
    "pressa": ["quads", "glutes"],
    "leg extension": ["quads"],
    "leg curl": ["hamstrings"],
    "affondi": ["quads", "glutes"],
    "calfs": ["calves"],
    "polpacci": ["calves"],

    // Shoulders
    "military press": ["front-delts", "triceps", "core"],
    "lento avanti": ["front-delts", "triceps"],
    "alzate laterali": ["side-delts"],
    "alzate frontali": ["front-delts"],
    "shoulder press": ["front-delts", "triceps"],

    // Arms
    "curl": ["biceps"],
    "curl manubri": ["biceps"],
    "curl bilanciere": ["biceps"],
    "french press": ["triceps"],
    "push down": ["triceps"],
    "tricipiti": ["triceps"],

    // Core
    "crunch": ["abs"],
    "plank": ["abs", "core"],
    "leg raise": ["abs"]
};

export const MUSCLE_GROUPS = {
    "chest": { label: "Pettorali", group: "push" },
    "upper-chest": { label: "Petto Alto", group: "push" },
    "lats": { label: "Dorsali", group: "pull" },
    "traps": { label: "Trapezio", group: "pull" },
    "rhomboids": { label: "Centro Schiena", group: "pull" },
    "lower-back": { label: "Lombari", group: "pull" },
    "front-delts": { label: "Spalle Anteriori", group: "push" },
    "side-delts": { label: "Spalle Laterali", group: "push" },
    "rear-delts": { label: "Spalle Posteriori", group: "pull" },
    "biceps": { label: "Bicipiti", group: "pull" },
    "triceps": { label: "Tricipiti", group: "push" },
    "forearms": { label: "Avambracci", group: "pull" },
    "abs": { label: "Addominali", group: "core" },
    "core": { label: "Core", group: "core" },
    "glutes": { label: "Glutei", group: "legs" },
    "quads": { label: "Quadricipiti", group: "legs" },
    "hamstrings": { label: "Femorali", group: "legs" },
    "calves": { label: "Polpacci", group: "legs" },
    "neck": { label: "Collo", group: "other" }
};

// Bilateral dumbbell exercises - weight entered is per dumbbell, display/track total
export const BILATERAL_DUMBBELL_EXERCISES = [
    "curl manubri",
    "dumbbell press",
    "dumbbell bench press",
    "dumbbell shoulder press",
    "dumbbell row",
    "dumbbell fly",
    "dumbbell lateral raise",
    "alzate laterali",
    "alzate frontali",
    "hammer curl",
    "dumbbell curl",
    "dumbbell tricep extension",
    "dumbbell lunges",
    "affondi manubri",
    "goblet squat",
    "dumbbell squat",
    "dumbbell deadlift",
    "dumbbell shrug",
    "scrollate manubri",
    "incline dumbbell press",
    "panca inclinata manubri",
    "decline dumbbell press",
    "croci manubri",
    "dumbbell pullover"
];

// Check if exercise is bilateral dumbbell
export function isBilateralDumbbell(exerciseName) {
    if (!exerciseName) return false;
    const normalized = exerciseName.toLowerCase().trim();
    
    // Check explicit list
    if (BILATERAL_DUMBBELL_EXERCISES.some(ex => normalized.includes(ex) || ex.includes(normalized))) {
        return true;
    }
    
    // Check if name contains "manubri" or "dumbbell" (common pattern)
    if (normalized.includes('manubri') || normalized.includes('dumbbell')) {
        // Exclude single-arm exercises
        if (normalized.includes('singolo') || normalized.includes('single') || 
            normalized.includes('unilateral') || normalized.includes('one arm')) {
            return false;
        }
        return true;
    }
    
    return false;
}

// Calculate total weight for bilateral dumbbell exercises
export function calculateTotalWeight(exerciseName, singleDumbbellWeight) {
    if (isBilateralDumbbell(exerciseName)) {
        return singleDumbbellWeight * 2;
    }
    return singleDumbbellWeight;
}

// Get display weight (what user sees in UI)
export function getDisplayWeight(exerciseName, storedWeight, showTotal = true) {
    if (isBilateralDumbbell(exerciseName) && showTotal) {
        return storedWeight; // Already stored as total
    }
    return storedWeight;
}

// Get input weight (what user enters - single dumbbell)
export function getInputWeight(exerciseName, totalWeight) {
    if (isBilateralDumbbell(exerciseName)) {
        return totalWeight / 2;
    }
    return totalWeight;
}

