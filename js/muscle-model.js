// Geometric Muscle Model for IronFlow Heatmap
// Style: Low-Poly / Cybernetic
// ViewBox: 0 0 400 500

export const MUSCLE_PATHS = {
    front: {
        // --- TORSO ---
        chest: "M130,110 L200,110 L200,160 L130,150 Z M270,110 L200,110 L200,160 L270,150 Z",
        "upper-chest": "M130,90 L200,95 L200,110 L130,110 Z M270,90 L200,95 L200,110 L270,110 Z",
        abs: "M165,160 L235,160 L230,240 L170,240 Z",
        obliques: "M130,150 L165,160 L170,240 L135,230 Z M270,150 L235,160 L230,240 L265,230 Z",
        
        // --- ARMS ---
        "front-delts": "M100,90 L130,90 L130,130 L105,120 Z M300,90 L270,90 L270,130 L295,120 Z",
        biceps: "M100,135 L130,140 L125,180 L105,175 Z M300,135 L270,140 L275,180 L295,175 Z",
        forearms: "M95,190 L125,190 L120,250 L100,250 Z M305,190 L275,190 L280,250 L300,250 Z",
        
        // --- LEGS ---
        quads: "M135,240 L195,250 L190,360 L140,350 Z M265,240 L205,250 L210,360 L260,350 Z",
        adductors: "M195,260 L205,260 L200,320 Z", // Inner thigh small patch
        calves: "M140,370 L185,370 L175,450 L150,450 Z M260,370 L215,370 L225,450 L250,450 Z",

        // --- NECK/HEAD (Visual only, usually not heatmapped but good for context) ---
        traps: "M150,90 L170,70 L230,70 L250,90 L200,95 Z"
    },
    back: {
        // --- TORSO ---
        traps: "M150,90 L200,60 L250,90 L200,150 Z", // Diamond shape trap
        lats: "M120,120 L150,90 L200,150 L250,90 L280,120 L260,200 L200,220 L140,200 Z",
        "lower-back": "M170,220 L230,220 L230,250 L170,250 Z",
        
        // --- ARMS ---
        "rear-delts": "M100,95 L130,95 L130,125 L105,120 Z M300,95 L270,95 L270,125 L295,120 Z",
        triceps: "M105,130 L135,130 L135,180 L110,180 Z M295,130 L265,130 L265,180 L290,180 Z",
        forearms: "M95,190 L125,190 L120,250 L100,250 Z M305,190 L275,190 L280,250 L300,250 Z", // Same as front roughly

        // --- LEGS ---
        glutes: "M135,250 L200,250 L200,300 L140,290 Z M265,250 L200,250 L200,300 L260,290 Z",
        hamstrings: "M140,300 L195,310 L190,365 L145,360 Z M260,300 L205,310 L210,365 L255,360 Z",
        calves: "M145,375 L190,375 L180,440 L155,440 Z M255,375 L210,375 L220,440 L245,440 Z"
    }
};

// Simple stick figure skeleton for background context (optional)
export const SKELETON_PATH = "";
