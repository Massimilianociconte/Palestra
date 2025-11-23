/**
 * Export Service - Gestisce l'esportazione e condivisione dei report AI
 */

class ExportService {
    constructor() {
        this.supportedFormats = ['markdown', 'text', 'html'];
    }

    /**
     * Copia il contenuto negli appunti
     */
    async copyToClipboard(content, format = 'markdown') {
        try {
            const formattedContent = this.formatContent(content, format);
            await navigator.clipboard.writeText(formattedContent);
            return { success: true, message: 'Copiato negli appunti!' };
        } catch (error) {
            console.error('Errore copia clipboard:', error);
            return { success: false, message: 'Errore durante la copia' };
        }
    }

    /**
     * Condividi usando Web Share API (nativo mobile)
     */
    async shareNative(title, content, format = 'text') {
        if (!navigator.share) {
            return { success: false, message: 'Condivisione non supportata su questo dispositivo' };
        }

        try {
            const formattedContent = this.formatContent(content, format);
            await navigator.share({
                title: title,
                text: formattedContent
            });
            return { success: true, message: 'Condiviso con successo!' };
        } catch (error) {
            if (error.name === 'AbortError') {
                return { success: false, message: 'Condivisione annullata' };
            }
            console.error('Errore condivisione:', error);
            return { success: false, message: 'Errore durante la condivisione' };
        }
    }

    /**
     * Download come file
     */
    downloadAsFile(content, filename, format = 'markdown') {
        try {
            const formattedContent = this.formatContent(content, format);
            const extension = format === 'html' ? 'html' : (format === 'markdown' ? 'md' : 'txt');
            const mimeType = format === 'html' ? 'text/html' : 'text/plain';
            
            const blob = new Blob([formattedContent], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${filename}.${extension}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            return { success: true, message: 'File scaricato!' };
        } catch (error) {
            console.error('Errore download:', error);
            return { success: false, message: 'Errore durante il download' };
        }
    }

    /**
     * Condividi su WhatsApp
     */
    shareWhatsApp(content, format = 'text') {
        try {
            const formattedContent = this.formatContent(content, format);
            const encodedText = encodeURIComponent(formattedContent);
            const url = `https://wa.me/?text=${encodedText}`;
            window.open(url, '_blank');
            return { success: true, message: 'Apertura WhatsApp...' };
        } catch (error) {
            console.error('Errore WhatsApp:', error);
            return { success: false, message: 'Errore apertura WhatsApp' };
        }
    }

    /**
     * Condividi su Telegram
     */
    shareTelegram(content, format = 'text') {
        try {
            const formattedContent = this.formatContent(content, format);
            const encodedText = encodeURIComponent(formattedContent);
            const url = `https://t.me/share/url?text=${encodedText}`;
            window.open(url, '_blank');
            return { success: true, message: 'Apertura Telegram...' };
        } catch (error) {
            console.error('Errore Telegram:', error);
            return { success: false, message: 'Errore apertura Telegram' };
        }
    }

    /**
     * Condividi via Email
     */
    shareEmail(subject, content, format = 'text') {
        try {
            const formattedContent = this.formatContent(content, format);
            const encodedSubject = encodeURIComponent(subject);
            const encodedBody = encodeURIComponent(formattedContent);
            const url = `mailto:?subject=${encodedSubject}&body=${encodedBody}`;
            window.location.href = url;
            return { success: true, message: 'Apertura client email...' };
        } catch (error) {
            console.error('Errore Email:', error);
            return { success: false, message: 'Errore apertura email' };
        }
    }

    /**
     * Formatta il contenuto in base al formato richiesto
     */
    formatContent(content, format) {
        switch (format) {
            case 'markdown':
                return this.toMarkdown(content);
            case 'html':
                return this.toHTML(content);
            case 'text':
            default:
                return this.toPlainText(content);
        }
    }

    /**
     * Converte HTML in Markdown
     */
    toMarkdown(htmlContent) {
        const temp = document.createElement('div');
        temp.innerHTML = htmlContent;

        // Rimuovi elementi di stile
        temp.querySelectorAll('style, script').forEach(el => el.remove());

        let markdown = temp.innerHTML;

        // Conversioni base HTML -> Markdown
        markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
        markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
        markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
        markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
        markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
        markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
        markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
        markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
        markdown = markdown.replace(/<ul[^>]*>/gi, '\n');
        markdown = markdown.replace(/<\/ul>/gi, '\n');
        markdown = markdown.replace(/<ol[^>]*>/gi, '\n');
        markdown = markdown.replace(/<\/ol>/gi, '\n');
        markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
        markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
        markdown = markdown.replace(/<br\s*\/?>/gi, '\n');
        markdown = markdown.replace(/<div[^>]*>(.*?)<\/div>/gi, '$1\n');
        markdown = markdown.replace(/<span[^>]*>(.*?)<\/span>/gi, '$1');

        // Rimuovi tag HTML rimanenti
        markdown = markdown.replace(/<[^>]+>/g, '');

        // Decodifica entità HTML
        markdown = markdown.replace(/&nbsp;/g, ' ');
        markdown = markdown.replace(/&amp;/g, '&');
        markdown = markdown.replace(/&lt;/g, '<');
        markdown = markdown.replace(/&gt;/g, '>');
        markdown = markdown.replace(/&quot;/g, '"');

        // Pulisci spazi multipli e linee vuote eccessive
        markdown = markdown.replace(/\n{3,}/g, '\n\n');
        markdown = markdown.trim();

        return markdown;
    }

    /**
     * Converte in testo semplice
     */
    toPlainText(htmlContent) {
        const temp = document.createElement('div');
        temp.innerHTML = htmlContent;
        return temp.textContent || temp.innerText || '';
    }

    /**
     * Mantiene HTML (con pulizia)
     */
    toHTML(htmlContent) {
        return htmlContent;
    }

    /**
     * Mostra menu di esportazione
     */
    showExportMenu(content, title = 'Report AI', container) {
        const menu = document.createElement('div');
        menu.className = 'export-menu';
        menu.innerHTML = `
            <div class="export-menu-backdrop"></div>
            <div class="export-menu-content">
                <h4 style="margin: 0 0 1rem 0; color: var(--color-primary);">📤 Esporta Report</h4>
                <div class="export-options">
                    <button class="export-btn" data-action="copy">
                        📋 Copia negli Appunti
                    </button>
                    <button class="export-btn" data-action="download">
                        💾 Scarica File
                    </button>
                    <button class="export-btn" data-action="share">
                        📱 Condividi
                    </button>
                    <button class="export-btn" data-action="whatsapp">
                        💬 WhatsApp
                    </button>
                    <button class="export-btn" data-action="telegram">
                        ✈️ Telegram
                    </button>
                    <button class="export-btn" data-action="email">
                        📧 Email
                    </button>
                </div>
                <button class="export-close">Annulla</button>
            </div>
        `;

        // Stili inline per il menu
        const style = document.createElement('style');
        style.textContent = `
            .export-menu {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1rem;
            }
            .export-menu-backdrop {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
            }
            .export-menu-content {
                position: relative;
                background: var(--color-bg);
                border: 1px solid var(--color-border);
                border-radius: 12px;
                padding: 1.5rem;
                max-width: 400px;
                width: 100%;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
            }
            .export-options {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 0.75rem;
                margin-bottom: 1rem;
            }
            .export-btn {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid var(--color-border);
                color: white;
                padding: 0.75rem;
                border-radius: 8px;
                cursor: pointer;
                font-size: 0.9rem;
                transition: all 0.2s;
                text-align: center;
            }
            .export-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                border-color: var(--color-primary);
                transform: translateY(-2px);
            }
            .export-close {
                width: 100%;
                background: transparent;
                border: 1px solid var(--color-border);
                color: var(--color-text-muted);
                padding: 0.75rem;
                border-radius: 8px;
                cursor: pointer;
                font-size: 0.9rem;
                transition: all 0.2s;
            }
            .export-close:hover {
                background: rgba(255, 255, 255, 0.05);
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(menu);

        // Event handlers
        const closeMenu = () => {
            menu.remove();
            style.remove();
        };

        menu.querySelector('.export-menu-backdrop').addEventListener('click', closeMenu);
        menu.querySelector('.export-close').addEventListener('click', closeMenu);

        menu.querySelectorAll('.export-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.action;
                let result;

                switch (action) {
                    case 'copy':
                        result = await this.copyToClipboard(content, 'markdown');
                        break;
                    case 'download':
                        const filename = `ironflow-report-${Date.now()}`;
                        result = this.downloadAsFile(content, filename, 'markdown');
                        break;
                    case 'share':
                        result = await this.shareNative(title, content, 'text');
                        break;
                    case 'whatsapp':
                        result = this.shareWhatsApp(content, 'text');
                        break;
                    case 'telegram':
                        result = this.shareTelegram(content, 'text');
                        break;
                    case 'email':
                        result = this.shareEmail(title, content, 'text');
                        break;
                }

                if (result && result.success) {
                    this.showToast(result.message, 'success');
                    closeMenu();
                } else if (result) {
                    this.showToast(result.message, 'error');
                }
            });
        });
    }

    /**
     * Mostra notifica toast
     */
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `export-toast export-toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            z-index: 10000;
            font-size: 0.9rem;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            animation: slideUp 0.3s ease;
        `;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideUp {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideUp 0.3s ease reverse';
            setTimeout(() => {
                toast.remove();
                style.remove();
            }, 300);
        }, 3000);
    }
}

// Export singleton
export const exportService = new ExportService();
