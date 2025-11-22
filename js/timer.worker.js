self.onmessage = function(e) {
    if (e.data.action === 'start') {
        if (self.timerInterval) clearInterval(self.timerInterval);
        
        const endTime = Date.now() + (e.data.duration * 1000);
        
        self.timerInterval = setInterval(() => {
            const now = Date.now();
            const remaining = Math.ceil((endTime - now) / 1000);
            
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
    }
};
