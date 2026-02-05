/**
 * Export Service - Gestisce l'esportazione e condivisione dei report AI
 */

class ExportService {
    constructor() {
        this.supportedFormats = ['markdown', 'text', 'html', 'rtf'];
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
    async downloadAsFile(content, filename, format = 'markdown') {
        try {
            const formattedContent = this.formatContent(content, format);
            const extension = format === 'html' ? 'html' : (format === 'markdown' ? 'md' : 'txt');
            const mimeType = format === 'html' ? 'text/html' : 'text/plain';
            
            const blob = new Blob([formattedContent], { type: mimeType });
            
            // Check if running in Capacitor (native app)
            const isCapacitor = typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
            
            if (isCapacitor) {
                console.log('🔧 Rilevato ambiente Capacitor nativo per file', format);
                try {
                    const Filesystem = window.Capacitor.Plugins.Filesystem;
                    const Share = window.Capacitor.Plugins.Share;
                    
                    if (!Filesystem || !Share) {
                        throw new Error('Filesystem or Share plugin not available');
                    }
                    
                    // Convert blob to base64
                    const reader = new FileReader();
                    const base64Promise = new Promise((resolve, reject) => {
                        reader.onloadend = () => {
                            const base64 = reader.result.split(',')[1];
                            resolve(base64);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    const base64Data = await base64Promise;
                    
                    // Save to cache directory
                    const savedFile = await Filesystem.writeFile({
                        path: `${filename}.${extension}`,
                        data: base64Data,
                        directory: 'CACHE'
                    });
                    console.log('💾 File salvato:', savedFile.uri);
                    
                    // Share the file
                    await Share.share({
                        title: filename,
                        url: savedFile.uri,
                        dialogTitle: 'Salva o condividi il file'
                    });
                    
                    return { success: true, message: 'File pronto per il salvataggio!' };
                } catch (capacitorError) {
                    console.warn('⚠️ Capacitor plugins error:', capacitorError);
                    // Fall through to web download
                }
            }
            
            // Web download fallback
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
     * Download come file Word (.doc) in formato RTF
     */
    async downloadAsWord(content, filename, title = 'Report GymBro') {
        try {
            console.log('downloadAsWord chiamato - inizio generazione RTF');
            // Genera RTF dal contenuto HTML
            const rtfContent = this.htmlToRTF(content, title);
            console.log('RTF generato, lunghezza:', rtfContent.length);
            
            // Crea blob RTF
            const blob = new Blob([rtfContent], { type: 'application/rtf' });
            
            // Check if running in Capacitor (native app)
            const isCapacitor = typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
            
            if (isCapacitor) {
                console.log('🔧 Rilevato ambiente Capacitor nativo');
                // Use Capacitor Filesystem plugin for native download
                try {
                    // Capacitor plugins are registered on window.Capacitor.Plugins
                    const Filesystem = window.Capacitor.Plugins.Filesystem;
                    const Share = window.Capacitor.Plugins.Share;
                    
                    if (!Filesystem || !Share) {
                        throw new Error('Filesystem or Share plugin not available');
                    }
                    
                    // Convert blob to base64
                    const reader = new FileReader();
                    const base64Promise = new Promise((resolve, reject) => {
                        reader.onloadend = () => {
                            const base64 = reader.result.split(',')[1];
                            resolve(base64);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    const base64Data = await base64Promise;
                    console.log('📄 Base64 generato, lunghezza:', base64Data.length);
                    
                    // Save to cache directory (Directory enum: Cache = 'CACHE')
                    const savedFile = await Filesystem.writeFile({
                        path: `${filename}.doc`,
                        data: base64Data,
                        directory: 'CACHE'
                    });
                    console.log('💾 File salvato:', savedFile.uri);
                    
                    // Share the file (this opens the native share dialog)
                    await Share.share({
                        title: title,
                        text: 'Report GymBro',
                        url: savedFile.uri,
                        dialogTitle: 'Salva o condividi il report'
                    });
                    
                    return { success: true, message: 'File pronto per il salvataggio!' };
                } catch (capacitorError) {
                    console.warn('⚠️ Capacitor plugins error:', capacitorError);
                    console.warn('Falling back to web download...');
                    // Fall through to web download
                }
            }
            
            // Web download fallback
            console.log('📥 Usando download web standard');
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${filename}.doc`;
            a.style.display = 'none';
            document.body.appendChild(a);
            
            // Use setTimeout to ensure the click is processed
            await new Promise(resolve => {
                setTimeout(() => {
                    a.click();
                    resolve();
                }, 100);
            });
            
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            return { success: true, message: 'File Word scaricato!' };
        } catch (error) {
            console.error('Errore download Word:', error);
            return { success: false, message: 'Errore durante la creazione del file Word' };
        }
    }

    /**
     * Sanitizza HTML per prevenire XSS
     * @param {string} html - HTML da sanitizzare
     * @returns {string} HTML sanitizzato
     */
    sanitizeHTML(html) {
        // Lista di tag consentiti per i report
        const allowedTags = ['h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'code', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'br', 'blockquote', 'span', 'div'];
        const allowedAttributes = ['style', 'class'];
        
        const temp = document.createElement('div');
        temp.innerHTML = html;
        
        // Rimuovi script e elementi pericolosi
        const dangerousElements = temp.querySelectorAll('script, iframe, object, embed, form, input, link, meta, base');
        dangerousElements.forEach(el => el.remove());
        
        // Rimuovi event handlers da tutti gli elementi
        const allElements = temp.querySelectorAll('*');
        allElements.forEach(el => {
            // Rimuovi tutti gli attributi on*
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.toLowerCase().startsWith('on') || 
                    attr.value.toLowerCase().includes('javascript:')) {
                    el.removeAttribute(attr.name);
                }
            });
            
            // Rimuovi href con javascript:
            if (el.hasAttribute('href') && el.getAttribute('href').toLowerCase().includes('javascript:')) {
                el.removeAttribute('href');
            }
        });
        
        return temp.innerHTML;
    }

    /**
     * Converte HTML in formato RTF
     */
    htmlToRTF(htmlContent, title) {
        // Header RTF
        let rtf = '{\\rtf1\\ansi\\deff0\n';
        
        // Font table
        rtf += '{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}{\\f1\\fmodern\\fcharset0 Courier New;}}\n';
        
        // Color table
        rtf += '{\\colortbl;\\red0\\green243\\blue255;\\red102\\green102\\blue102;\\red0\\green0\\blue0;}\n';
        
        // Document formatting
        rtf += '\\viewkind4\\uc1\\pard\\sa200\\sl276\\slmult1\\lang1040\\f0\\fs22\n';
        
        // Title header
        rtf += '\\qc\\b\\fs48 GYMBRO\\b0\\fs22\\par\n';
        rtf += '\\qc\\cf2\\fs20 Report generato il ' + new Date().toLocaleDateString('it-IT', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) + '\\cf0\\fs22\\par\n';
        rtf += '\\pard\\sa200\\sl276\\slmult1\\par\n';
        
        // SECURITY FIX: Sanitize HTML content before parsing
        const sanitizedHTML = this.sanitizeHTML(htmlContent);
        const temp = document.createElement('div');
        temp.innerHTML = sanitizedHTML;
        
        // Convert HTML to RTF
        rtf += this.parseHtmlToRTF(temp);
        
        // Footer
        rtf += '\\par\\pard\\qc\\brdrb\\brdrs\\brdrw10\\brsp20\\par\n';
        rtf += '\\cf2\\i Generato da GymBro - Il tuo assistente di allenamento intelligente\\i0\\cf0\\par\n';
        
        // Close RTF
        rtf += '}';
        
        return rtf;
    }

    /**
     * Parse ricorsivo HTML to RTF
     */
    parseHtmlToRTF(node) {
        let rtf = '';
        
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent.trim();
                if (text) {
                    rtf += this.escapeRTF(text) + ' ';
                }
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tagName = child.tagName.toLowerCase();
                
                switch (tagName) {
                    case 'h1':
                        rtf += '\\pard\\sa200\\sl276\\slmult1\\b\\fs36\\cf1 ' + this.escapeRTF(child.textContent) + '\\cf0\\b0\\fs22\\par\n';
                        break;
                    
                    case 'h2':
                        rtf += '\\pard\\sa200\\sl276\\slmult1\\b\\fs32\\cf1 ' + this.escapeRTF(child.textContent) + '\\cf0\\b0\\fs22\\par\n';
                        break;
                    
                    case 'h3':
                        rtf += '\\pard\\sa200\\sl276\\slmult1\\b\\fs28\\cf1 ' + this.escapeRTF(child.textContent) + '\\cf0\\b0\\fs22\\par\n';
                        break;
                    
                    case 'h4':
                        rtf += '\\pard\\sa200\\sl276\\slmult1\\b\\fs24 ' + this.escapeRTF(child.textContent) + '\\b0\\fs22\\par\n';
                        break;
                    
                    case 'p':
                        rtf += '\\pard\\sa200\\sl276\\slmult1 ' + this.parseInlineToRTF(child) + '\\par\n';
                        break;
                    
                    case 'ul':
                    case 'ol':
                        const items = child.querySelectorAll('li');
                        items.forEach(li => {
                            rtf += '\\pard\\fi-360\\li720\\sa100\\sl276\\slmult1\\bullet  ' + this.escapeRTF(li.textContent) + '\\par\n';
                        });
                        rtf += '\\pard\\sa200\\sl276\\slmult1\\par\n';
                        break;
                    
                    case 'blockquote':
                        rtf += '\\pard\\li720\\sa200\\sl276\\slmult1\\i\\cf2 ' + this.escapeRTF(child.textContent) + '\\cf0\\i0\\par\n';
                        break;
                    
                    case 'table':
                        const rows = child.querySelectorAll('tr');
                        rows.forEach(row => {
                            const cells = row.querySelectorAll('td, th');
                            const isHeader = row.querySelector('th') !== null;
                            
                            rtf += '\\pard\\sa100\\sl276\\slmult1';
                            if (isHeader) rtf += '\\b';
                            
                            const rowText = Array.from(cells).map(cell => this.escapeRTF(cell.textContent.trim())).join(' | ');
                            rtf += ' ' + rowText;
                            
                            if (isHeader) rtf += '\\b0';
                            rtf += '\\par\n';
                        });
                        rtf += '\\pard\\sa200\\sl276\\slmult1\\par\n';
                        break;
                    
                    case 'br':
                        rtf += '\\line\n';
                        break;
                    
                    default:
                        rtf += this.parseHtmlToRTF(child);
                        break;
                }
            }
        }
        
        return rtf;
    }

    /**
     * Parse elementi inline per RTF
     */
    parseInlineToRTF(element) {
        let rtf = '';
        
        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                rtf += this.escapeRTF(child.textContent);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tagName = child.tagName.toLowerCase();
                const text = this.escapeRTF(child.textContent);
                
                switch (tagName) {
                    case 'strong':
                    case 'b':
                        rtf += '\\b ' + text + '\\b0 ';
                        break;
                    case 'em':
                    case 'i':
                        rtf += '\\i ' + text + '\\i0 ';
                        break;
                    case 'code':
                        rtf += '\\f1\\fs20 ' + text + '\\f0\\fs22 ';
                        break;
                    default:
                        rtf += text;
                        break;
                }
            }
        }
        
        return rtf;
    }

    /**
     * Escape caratteri speciali per RTF
     */
    escapeRTF(text) {
        return text
            .replace(/\\/g, '\\\\')
            .replace(/{/g, '\\{')
            .replace(/}/g, '\\}')
            .replace(/\n/g, '\\line ')
            .replace(/[\u00A0-\uFFFF]/g, (char) => {
                return '\\u' + char.charCodeAt(0) + '?';
            });
    }

    /**
     * Converte HTML in elementi docx
     */
    htmlToDocxElements(htmlContent, title) {
        const { Paragraph, TextRun, HeadingLevel, AlignmentType, UnderlineType } = window.docx;
        const elements = [];
        
        // Header con titolo
        elements.push(
            new Paragraph({
                text: 'GYMBRO',
                heading: HeadingLevel.HEADING_1,
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 }
            })
        );
        
        elements.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: `Report generato il ${new Date().toLocaleDateString('it-IT', { 
                            day: 'numeric', 
                            month: 'long', 
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })}`,
                        size: 20,
                        color: '666666'
                    })
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 }
            })
        );
        
        // Parse HTML content
        const temp = document.createElement('div');
        temp.innerHTML = htmlContent;
        
        // Converti elementi HTML in docx
        this.parseHtmlNode(temp, elements);
        
        // Footer
        elements.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: '─'.repeat(50),
                        color: 'CCCCCC'
                    })
                ],
                spacing: { before: 400, after: 200 }
            })
        );
        
        elements.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: 'Generato da GymBro - Il tuo assistente di allenamento intelligente',
                        size: 18,
                        color: '666666',
                        italics: true
                    })
                ],
                alignment: AlignmentType.CENTER
            })
        );
        
        return elements;
    }

    /**
     * Parse ricorsivo dei nodi HTML
     */
    parseHtmlNode(node, elements) {
        const { Paragraph, TextRun, HeadingLevel, AlignmentType } = window.docx;
        
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent.trim();
                if (text) {
                    elements.push(
                        new Paragraph({
                            children: [new TextRun(text)],
                            spacing: { after: 100 }
                        })
                    );
                }
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tagName = child.tagName.toLowerCase();
                
                switch (tagName) {
                    case 'h1':
                        elements.push(
                            new Paragraph({
                                text: child.textContent,
                                heading: HeadingLevel.HEADING_1,
                                spacing: { before: 240, after: 120 }
                            })
                        );
                        break;
                    
                    case 'h2':
                        elements.push(
                            new Paragraph({
                                text: child.textContent,
                                heading: HeadingLevel.HEADING_2,
                                spacing: { before: 200, after: 100 }
                            })
                        );
                        break;
                    
                    case 'h3':
                        elements.push(
                            new Paragraph({
                                text: child.textContent,
                                heading: HeadingLevel.HEADING_3,
                                spacing: { before: 160, after: 80 }
                            })
                        );
                        break;
                    
                    case 'h4':
                        elements.push(
                            new Paragraph({
                                text: child.textContent,
                                heading: HeadingLevel.HEADING_4,
                                spacing: { before: 120, after: 60 }
                            })
                        );
                        break;
                    
                    case 'p':
                        const pChildren = this.parseInlineElements(child);
                        if (pChildren.length > 0) {
                            elements.push(
                                new Paragraph({
                                    children: pChildren,
                                    spacing: { after: 120 }
                                })
                            );
                        }
                        break;
                    
                    case 'ul':
                    case 'ol':
                        const items = child.querySelectorAll('li');
                        items.forEach((li, index) => {
                            elements.push(
                                new Paragraph({
                                    text: `• ${li.textContent}`,
                                    spacing: { after: 80 },
                                    indent: { left: 720 }
                                })
                            );
                        });
                        break;
                    
                    case 'blockquote':
                        elements.push(
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: child.textContent,
                                        italics: true,
                                        color: '666666'
                                    })
                                ],
                                spacing: { before: 120, after: 120 },
                                indent: { left: 720 }
                            })
                        );
                        break;
                    
                    case 'table':
                        // Per semplicità, convertiamo le tabelle in testo formattato
                        const rows = child.querySelectorAll('tr');
                        rows.forEach(row => {
                            const cells = row.querySelectorAll('td, th');
                            const rowText = Array.from(cells).map(cell => cell.textContent.trim()).join(' | ');
                            if (rowText) {
                                elements.push(
                                    new Paragraph({
                                        text: rowText,
                                        spacing: { after: 60 }
                                    })
                                );
                            }
                        });
                        break;
                    
                    default:
                        // Ricorsione per altri elementi
                        this.parseHtmlNode(child, elements);
                        break;
                }
            }
        }
    }

    /**
     * Parse elementi inline (strong, em, etc.)
     */
    parseInlineElements(element) {
        const { TextRun } = window.docx;
        const runs = [];
        
        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent;
                if (text.trim()) {
                    runs.push(new TextRun(text));
                }
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tagName = child.tagName.toLowerCase();
                const text = child.textContent;
                
                if (!text.trim()) continue;
                
                const options = { text };
                
                if (tagName === 'strong' || tagName === 'b') {
                    options.bold = true;
                } else if (tagName === 'em' || tagName === 'i') {
                    options.italics = true;
                } else if (tagName === 'code') {
                    options.font = 'Courier New';
                    options.size = 20;
                }
                
                runs.push(new TextRun(options));
            }
        }
        
        return runs.length > 0 ? runs : [new TextRun(element.textContent)];
    }

    /**
     * Prepara HTML ben formattato per Word
     */
    prepareHtmlForWord(content, title) {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        body {
            font-family: 'Calibri', 'Arial', sans-serif;
            font-size: 11pt;
            line-height: 1.6;
            color: #000000;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        h1 {
            font-size: 24pt;
            font-weight: bold;
            color: #00f3ff;
            margin-top: 0;
            margin-bottom: 16pt;
            border-bottom: 2px solid #00f3ff;
            padding-bottom: 8pt;
        }
        h2 {
            font-size: 18pt;
            font-weight: bold;
            color: #00f3ff;
            margin-top: 16pt;
            margin-bottom: 12pt;
        }
        h3 {
            font-size: 14pt;
            font-weight: bold;
            color: #00f3ff;
            margin-top: 12pt;
            margin-bottom: 8pt;
        }
        h4 {
            font-size: 12pt;
            font-weight: bold;
            color: #333333;
            margin-top: 10pt;
            margin-bottom: 6pt;
            border-left: 3px solid #00f3ff;
            padding-left: 10px;
        }
        p {
            margin-top: 0;
            margin-bottom: 10pt;
            text-align: justify;
        }
        ul, ol {
            margin-top: 0;
            margin-bottom: 10pt;
            padding-left: 30px;
        }
        li {
            margin-bottom: 6pt;
        }
        strong, b {
            font-weight: bold;
            color: #000000;
        }
        em, i {
            font-style: italic;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10pt;
            margin-bottom: 10pt;
        }
        th {
            background-color: #00f3ff;
            color: #000000;
            font-weight: bold;
            padding: 8pt;
            border: 1px solid #cccccc;
            text-align: left;
        }
        td {
            padding: 6pt;
            border: 1px solid #cccccc;
        }
        tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        blockquote {
            border-left: 3px solid #cccccc;
            padding-left: 15px;
            margin-left: 0;
            font-style: italic;
            color: #666666;
            background-color: #f5f5f5;
            padding: 10pt;
        }
        code {
            font-family: 'Courier New', monospace;
            background-color: #f5f5f5;
            padding: 2px 4px;
            border-radius: 3px;
            font-size: 10pt;
        }
        pre {
            font-family: 'Courier New', monospace;
            background-color: #f5f5f5;
            padding: 10pt;
            border-radius: 5px;
            overflow-x: auto;
            margin-top: 10pt;
            margin-bottom: 10pt;
        }
        .header {
            text-align: center;
            margin-bottom: 30pt;
        }
        .footer {
            margin-top: 30pt;
            padding-top: 10pt;
            border-top: 1px solid #cccccc;
            font-size: 9pt;
            color: #666666;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>GYMBRO</h1>
        <p style="font-size: 10pt; color: #666666;">Report generato il ${new Date().toLocaleDateString('it-IT', { 
            day: 'numeric', 
            month: 'long', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })}</p>
    </div>
    ${content}
    <div class="footer">
        <p>Generato da GymBro - Il tuo assistente di allenamento intelligente</p>
    </div>
</body>
</html>`;
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
            // Usa tg:// per app nativa o https://telegram.me per web
            const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            const url = isMobile 
                ? `tg://msg?text=${encodedText}`
                : `https://telegram.me/share/msg?text=${encodedText}`;
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
                        💾 Scarica Markdown
                    </button>
                    <button class="export-btn" data-action="word">
                        📄 Scarica Word
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
            @media (max-width: 400px) {
                .export-options {
                    grid-template-columns: 1fr;
                }
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
                        const filename = `gymbro-report-${Date.now()}`;
                        result = this.downloadAsFile(content, filename, 'markdown');
                        break;
                    case 'word':
                        const wordFilename = `gymbro-report-${Date.now()}`;
                        result = await this.downloadAsWord(content, wordFilename, title);
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
