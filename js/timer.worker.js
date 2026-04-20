// P1.17: rest timer worker with hard bounds.
// - MAX_REST_MS caps how far in the future the endTime can be pushed, to
//   prevent the UI from letting a runaway timer block the workout.
// - MAX_TIMER_DURATION_S guards the initial "start" call.
// - adjust events clamp the new endTime to [now, now + MAX_REST_MS].

const MAX_TIMER_DURATION_S = 20 * 60; // 20 minutes
const MAX_REST_MS = MAX_TIMER_DURATION_S * 1000;

function clampEndTime(nextEndTime) {
    const now = Date.now();
    if (nextEndTime < now) return now;
    const upperBound = now + MAX_REST_MS;
    return nextEndTime > upperBound ? upperBound : nextEndTime;
}

function clearTimer() {
    if (self.timerInterval) {
        clearInterval(self.timerInterval);
        self.timerInterval = null;
    }
}

self.onmessage = function (e) {
    const data = e.data || {};

    if (data.action === "start") {
        let duration = Number(data.duration);
        if (!Number.isFinite(duration) || duration <= 0) return;
        duration = Math.min(duration, MAX_TIMER_DURATION_S);

        clearTimer();
        self.endTime = Date.now() + duration * 1000;
        self.timerInterval = setInterval(() => {
            const now = Date.now();
            const remaining = Math.ceil((self.endTime - now) / 1000);
            if (remaining <= 0) {
                clearTimer();
                self.postMessage({ action: "complete" });
            } else {
                self.postMessage({ action: "tick", remaining });
            }
        }, 250);
    } else if (data.action === "stop") {
        clearTimer();
        self.endTime = 0;
    } else if (data.action === "adjust" && self.timerInterval && self.endTime) {
        let delta = Number(data.seconds);
        if (!Number.isFinite(delta)) return;
        // P1.17: per-adjust delta cap so a stuck button cannot rack up years
        delta = Math.max(-MAX_TIMER_DURATION_S, Math.min(MAX_TIMER_DURATION_S, delta));
        self.endTime = clampEndTime(self.endTime + delta * 1000);
        const remaining = Math.max(0, Math.ceil((self.endTime - Date.now()) / 1000));
        self.postMessage({ action: "tick", remaining });
    }
};
