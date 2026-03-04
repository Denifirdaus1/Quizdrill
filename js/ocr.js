/**
 * ocr.js — OCR handler using Tesseract.js and PDF.js
 */
const OCR = (() => {

    /**
     * Perform OCR on an image file
     * @param {File} file - Image file
     * @param {Function} onProgress - Progress callback (0-100)
     * @returns {Promise<string>} - Extracted text
     */
    async function recognizeImage(file, onProgress) {
        const worker = await Tesseract.createWorker('ind+eng', 1, {
            logger: m => {
                if (m.status === 'recognizing text' && onProgress) {
                    onProgress(Math.round(m.progress * 100));
                }
            }
        });

        const imgUrl = URL.createObjectURL(file);
        const { data: { text } } = await worker.recognize(imgUrl);
        URL.revokeObjectURL(imgUrl);
        await worker.terminate();
        return text;
    }

    /**
     * Perform OCR on multiple image files
     */
    async function recognizeImages(files, onProgress) {
        const results = [];
        for (let i = 0; i < files.length; i++) {
            const text = await recognizeImage(files[i], (pct) => {
                const overall = Math.round(((i + pct / 100) / files.length) * 100);
                if (onProgress) onProgress(overall, `Memproses gambar ${i + 1}/${files.length}...`);
            });
            results.push(text);
        }
        return results.join('\n\n');
    }

    /**
     * Extract text from PDF using PDF.js + Tesseract.js
     * First tries text extraction, falls back to OCR
     */
    async function recognizePdf(file, onProgress) {
        // Load PDF.js dynamically 
        const pdfjsLib = window.pdfjsLib || await loadPdfJs();

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdf.numPages;
        let allText = '';

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);

            // Try text extraction first
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');

            if (pageText.trim().length > 20) {
                // Text-based PDF
                allText += `\n${pageText}\n`;
                if (onProgress) {
                    onProgress(Math.round((pageNum / numPages) * 100), `Halaman ${pageNum}/${numPages} (teks)...`);
                }
            } else {
                // Image-based PDF — render to canvas and OCR
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');
                await page.render({ canvasContext: ctx, viewport }).promise;

                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                const ocrText = await recognizeImage(blob, (pct) => {
                    const overall = Math.round(((pageNum - 1 + pct / 100) / numPages) * 100);
                    if (onProgress) onProgress(overall, `OCR halaman ${pageNum}/${numPages}...`);
                });
                allText += `\n${ocrText}\n`;
            }
        }

        return allText.trim();
    }

    async function loadPdfJs() {
        if (window.pdfjsLib) return window.pdfjsLib;

        // PDF.js should be loaded via module script in HTML
        // This is a fallback
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.js';
            script.onload = () => {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.js';
                resolve(window.pdfjsLib);
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    return { recognizeImage, recognizeImages, recognizePdf };
})();
