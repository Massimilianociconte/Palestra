/**
 * GymBro Chat Component
 * A floating AI chatbot that uses Gemini to analyze user data and provide fitness advice.
 */
import { authService } from './auth-service.js';
import { firestoreService } from './firestore-service.js';

class GymBroChat {
    constructor() {
        this.isOpen = false;
        this.messages = [];
        this.isTyping = false;
        this.initialized = false;
        this.rateLimitCounter = 0;
        this.lastMessageTime = 0;
    }

    async init() {
        if (this.initialized) return;

        this.renderUI();
        this.setupEventListeners();
        this.loadWelcomeMessage();

        this.initialized = true;
        console.log('🤖 GymBro Chat Initialized');
    }

    renderUI() {
        // Toggle Button
        const toggle = document.createElement('button');
        toggle.className = 'gymbro-chat-toggle';
        toggle.id = 'gymbroChatToggle';
        toggle.innerHTML = `<img src="mascott-gymbro.png" alt="GymBro">`;
        document.body.appendChild(toggle);

        // Widget
        const widget = document.createElement('div');
        widget.className = 'gymbro-chat-widget';
        widget.id = 'gymbroChatWidget';
        widget.innerHTML = `
            <div class="gymbro-chat-header">
                <div class="gymbro-chat-title">
                    <img src="mascott-gymbro.png" alt="GymBro">
                    <div>
                        <h4>GymBro Coach</h4>
                        <span>Online • AI Assistant</span>
                    </div>
                </div>
                <button class="gymbro-chat-close" id="gymbroChatClose">&times;</button>
            </div>
            <div class="gymbro-chat-messages" id="gymbroChatMessages"></div>
            <div class="gymbro-chat-input-area">
                <input type="text" class="gymbro-chat-input" id="gymbroChatInput" placeholder="Chiedimi della tua scheda o progresso...">
                <button class="gymbro-chat-send" id="gymbroChatSend">
                    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
            </div>
        `;
        document.body.appendChild(widget);

        this.elements = {
            toggle,
            widget,
            messagesContainer: widget.querySelector('#gymbroChatMessages'),
            input: widget.querySelector('#gymbroChatInput'),
            sendBtn: widget.querySelector('#gymbroChatSend'),
            closeBtn: widget.querySelector('#gymbroChatClose')
        };
    }

    setupEventListeners() {
        this.elements.toggle.addEventListener('click', () => this.toggleChat());
        this.elements.closeBtn.addEventListener('click', () => this.toggleChat());

        this.elements.sendBtn.addEventListener('click', () => this.handleSendMessage());
        this.elements.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSendMessage();
        });

        // Hide toggle when scrolling deeply on mobile to avoid overlapping content
        window.addEventListener('scroll', () => {
            if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 100) {
                this.elements.toggle.style.opacity = '0.5';
            } else {
                this.elements.toggle.style.opacity = '1';
            }
        });
    }

    toggleChat() {
        this.isOpen = !this.isOpen;
        this.elements.widget.classList.toggle('active', this.isOpen);

        if (this.isOpen) {
            this.elements.input.focus();
        }
    }

    loadWelcomeMessage() {
        const welcome = "Ehilà <b class=\"highlight\">campione</b>! Sono <b class=\"highlight\">GymBro</b>, il tuo coach virtuale. Come posso aiutarti oggi? Posso analizzare i tuoi allenamenti, darti una mano con la dieta o spiegarti perché quel muscolo ti fa ancora male! 🔥";
        this.addMessage('gymbro', welcome);
    }

    addMessage(role, text) {
        const msg = document.createElement('div');
        msg.className = `chat-msg ${role}`;

        if (role === 'user') {
            msg.textContent = text; // Secure for user input
        } else {
            msg.innerHTML = text; // Allow HTML for GymBro rich formatting
            // Add animation class for mascot bounce
            msg.classList.add('new-message');
            // Remove animation class after it completes
            setTimeout(() => msg.classList.remove('new-message'), 700);
        }

        this.elements.messagesContainer.appendChild(msg);
        this.scrollToBottom();

        this.messages.push({ role, text });
    }

    scrollToBottom() {
        this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
    }

    showTyping() {
        if (this.isTyping) return;
        this.isTyping = true;

        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.id = 'gymbroTyping';
        indicator.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;
        this.elements.messagesContainer.appendChild(indicator);
        this.scrollToBottom();
    }

    hideTyping() {
        const indicator = document.getElementById('gymbroTyping');
        if (indicator) indicator.remove();
        this.isTyping = false;
    }

    async handleSendMessage() {
        const text = this.elements.input.value.trim();
        if (!text || this.isTyping) return;

        // Security & Guardrails
        if (text.length > 500) {
            alert("Il messaggio è troppo lungo, GymBro preferisce i fatti alle parole! (Max 500 caratteri)");
            return;
        }

        // Rate Limiting
        const now = Date.now();
        if (now - this.lastMessageTime < 2000) {
            console.warn("Calma bro, un passo alla volta!");
            return;
        }
        this.lastMessageTime = now;

        this.elements.input.value = '';
        this.addMessage('user', text);
        this.showTyping();

        try {
            // Gather context for AI
            const context = await firestoreService.gatherDataForAI();

            // Get AI response
            const { aiService } = await import('./ai-service.js');
            const response = await aiService.chatWithGymBro(text, this.messages, context);

            this.hideTyping();
            if (response.success) {
                this.addMessage('gymbro', response.text);
            } else {
                this.addMessage('gymbro', "Scusa bro, ho avuto un calo di zuccheri (errore tecnico). Riprova tra un attimo!");
            }
        } catch (error) {
            console.error('Chat Error:', error);
            this.hideTyping();
            this.addMessage('gymbro', "C'è stato un errore nel caricamento dei pesi... cioè del messaggio. Riprova!");
        }
    }
}

// Global instance
export const gymbroChat = new GymBroChat();

// Auto-init on page load if possible
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => gymbroChat.init());
} else {
    gymbroChat.init();
}
