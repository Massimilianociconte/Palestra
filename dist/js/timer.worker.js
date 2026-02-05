self.onmessage = function(e) {
    if (e.data.action === 'start') {
        if (self.timerInterval) clearInterval(self.timerInterval);
        
        // Store endTime in scope to adjust it later
        self.endTime = Date.now() + (e.data.duration * 1000);
        
        self.timerInterval = setInterval(() => {
            const now = Date.now();
            const remaining = Math.ceil((self.endTime - now) / 1000);
            
            if (remaining <= 0) {
                clearInterval(self.timerInterval);
                self.postMessage({ action: 'complete' });
            } else {
                self.postMessage({ action: 'tick', remaining: remaining });
            }
        }, 250);
    } else if (e.data.action === 'stop') {
        if (self.timerInterval) {
            clearInterval(self.timerInterval);
            self.timerInterval = null;
        }
    } else if (e.data.action === 'adjust') {
        if (self.timerInterval && self.endTime) {
            // Add seconds (can be negative)
            self.endTime += (e.data.seconds * 1000);
            // Force immediate tick update
            const now = Date.now();
            const remaining = Math.max(0, Math.ceil((self.endTime - now) / 1000));
            self.postMessage({ action: 'tick', remaining: remaining });
        }
    }
};
