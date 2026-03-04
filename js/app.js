/**
 * app.js — Main application controller for QuizDrill (Monochrome Edition)
 */
window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = typeof reason === 'string'
        ? reason
        : (reason && reason.message) ? reason.message : '';

    // Ignore noisy wallet-extension errors unrelated to QuizDrill.
    if (/failed to connect to metamask|metamask extension not found/i.test(message)) {
        event.preventDefault();
    }
});

const App = (() => {
    let currentView = 'dashboard';
    let editingQuestionId = null;
    let quizTimerInterval = null;
    let currentResults = null;
    let mathRenderQueue = Promise.resolve();
    let optionFeedback = null;
    let pendingQuestionImageBlob = null;
    let pendingQuestionImageUrl = null;

    // ===== INITIALIZATION =====
    async function init() {
        // Load all screen fragments into the DOM first
        try {
            await Router.loadAll();
        } catch (err) {
            console.error('Gagal load screens:', err);
            document.getElementById('mainContent').innerHTML =
                '<div style="padding:60px; text-align:center; font-weight:900;">GAGAL MEMUAT APLIKASI</div>';
            return;
        }

        try {
            await Store.init();
        } catch (err) {
            console.error('Gagal init data store:', err);
        }
        setupNavigation();
        setupMobileMenu();
        setupExamCountdown();
        setupQuestionForm();
        setupLatexPreview();
        refreshDashboard();
        loadPdfJs();
    }

    function loadPdfJs() {
        if (!window.pdfjsLib) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.js';
            script.onload = () => {
                if (window.pdfjsLib) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                        'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.js';
                }
            };
            document.head.appendChild(script);
        }
    }

    // ===== NAVIGATION =====
    function setupNavigation() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                navigate(item.dataset.view);
                closeMobileSidebar();
            });
        });
    }

    function setupMobileMenu() {
        const toggle = document.getElementById('menuToggle');
        const sidebar = document.getElementById('sidebar');
        if (toggle && sidebar) {
            toggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
            });
        }
    }

    function closeMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('open');
    }

    function navigate(view) {
        if (currentView === 'quiz-active' && view !== 'quiz-active') {
            if (quizTimerInterval) clearInterval(quizTimerInterval);
            optionFeedback = null;
        }

        currentView = view;

        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
        if (navItem) navItem.classList.add('active');

        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const viewEl = document.getElementById(`view-${view}`);
        if (viewEl) viewEl.classList.add('active');

        if (view === 'dashboard') refreshDashboard();
        if (view === 'questions') refreshQuestionList();
        if (view === 'stats') refreshStats();
        if (view === 'quiz') refreshQuizSetup();

        // Scroll main content to top
        const main = document.getElementById('mainContent');
        if (main) main.scrollTop = 0;
    }

    // ===== EXAM COUNTDOWN =====
    function setupExamCountdown() {
        const el = document.getElementById('examCountdown');
        const examDate = new Date('2026-03-05T08:00:00+07:00');

        function update() {
            const now = new Date();
            const diff = examDate - now;
            if (diff <= 0) {
                el.innerHTML = '<span class="countdown-days">HARI INI</span>UJIAN SEDANG BERLANGSUNG';
                return;
            }
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            el.innerHTML = `<span class="countdown-days">${days}H ${hours}J</span>MENUJU UJIAN`;
        }
        update();
        setInterval(update, 60000);
    }

    // ===== DASHBOARD =====
    function refreshDashboard() {
        const stats = Stats.getOverallStats();
        document.getElementById('totalQuestions').textContent = stats.totalQuestions;
        document.getElementById('totalSessions').textContent = stats.totalSessions;
        document.getElementById('avgAccuracy').textContent = stats.avgAccuracy !== null ? stats.avgAccuracy + '%' : '—';
        document.getElementById('weakQuestions').textContent = stats.weakCount;

        const history = Stats.getSessionHistory();
        const container = document.getElementById('sessionHistory');

        if (history.length === 0) {
            container.innerHTML = '<div class="empty-state">Belum ada sesi latihan.</div>';
            return;
        }

        container.innerHTML = history.slice(0, 10).map(s => {
            const modeName = s.mode === 'focus' ? 'FOCUS' : s.mode === 'flagged' ? 'FLAGGED' : 'ALL';
            return `
        <div class="history-item">
          <span class="history-date">${s.dateFormatted}</span>
          <span class="history-mode">${modeName}</span>
          <span class="history-score">${s.percentage}%</span>
          <span class="history-date" style="text-align:right">${s.durationFormatted}</span>
        </div>
      `;
        }).join('');
    }

    // ===== QUESTION MANAGEMENT =====
    function refreshQuestionList(filter = 'all') {
        let questions = Store.getQuestions();

        if (filter === 'pg') questions = questions.filter(q => q.type === 'pg');
        else if (filter === 'essay') questions = questions.filter(q => q.type === 'essay');
        else if (filter === 'weak') questions = Store.getWeakQuestions();
        else if (filter === 'flagged') questions = Store.getFlaggedQuestions();

        const container = document.getElementById('questionList');

        if (questions.length === 0) {
            container.innerHTML = '<div class="empty-state">Tidak ada soal.</div>';
            return;
        }

        container.innerHTML = questions.map((q, idx) => {
            const accuracy = q.stats.attempts > 0 ? Math.round((q.stats.correct / q.stats.attempts) * 100) : -1;
            const accClass = accuracy === -1 ? 'none' : accuracy >= 80 ? 'good' : accuracy >= 50 ? 'medium' : 'bad';
            const accText = accuracy === -1 ? 'NEW' : `${accuracy}%`;
            const truncatedQ = truncateText(q.question, 100);

            return `
        <div class="question-item" onclick="App.editQuestion('${q.id}')">
          <span class="q-type">${q.type}</span>
          <div class="q-body">
            <div class="q-text">${renderLatexText(truncatedQ)}</div>
            <div class="q-meta">
              <span class="q-accuracy"><span class="accuracy-dot ${accClass}"></span>${accText}</span>
              ${q.flagged ? '<span>FLAGGED</span>' : ''}
            </div>
          </div>
          <div class="q-actions">
            <button onclick="event.stopPropagation(); App.editQuestion('${q.id}')">EDIT</button>
            <button onclick="event.stopPropagation(); App.deleteQuestion('${q.id}')">HAPUS</button>
          </div>
        </div>
      `;
        }).join('');

        renderLatex();
    }

    function setupQuestionFilters() {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                refreshQuestionList(btn.dataset.filter);
            });
        });
    }

    function clearPendingQuestionImage() {
        pendingQuestionImageBlob = null;
        if (pendingQuestionImageUrl) {
            URL.revokeObjectURL(pendingQuestionImageUrl);
            pendingQuestionImageUrl = null;
        }
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
        if (bytes < 1024) return `${bytes} B`;
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    function canvasToBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (!blob) {
                    reject(new Error('Gagal kompres gambar.'));
                    return;
                }
                resolve(blob);
            }, type, quality);
        });
    }

    async function compressQuestionImage(file) {
        const image = await createImageBitmap(file);
        const maxWidth = 1600;
        const maxHeight = 1600;
        const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas tidak tersedia.');
        ctx.drawImage(image, 0, 0, width, height);

        const maxBytes = 450 * 1024;
        let quality = 0.82;
        let blob = await canvasToBlob(canvas, 'image/webp', quality);

        while (blob.size > maxBytes && quality > 0.5) {
            quality -= 0.08;
            blob = await canvasToBlob(canvas, 'image/webp', quality);
        }

        if (!blob.type || blob.type === 'application/octet-stream') {
            blob = await canvasToBlob(canvas, 'image/jpeg', 0.78);
        }

        image.close();
        return blob;
    }

    function getBlobExtension(blob) {
        const type = (blob?.type || '').toLowerCase();
        if (type.includes('png')) return 'png';
        if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
        return 'webp';
    }

    // ===== ADD/EDIT QUESTION =====
    function showAddQuestion() {
        clearPendingQuestionImage();
        editingQuestionId = null;
        document.getElementById('modalTitle').textContent = 'Tambah Soal';
        document.getElementById('questionForm').reset();
        document.getElementById('qEditId').value = '';
        document.getElementById('qImagePreview').src = '';
        document.getElementById('qImagePreview').classList.add('hidden');
        document.querySelector('.upload-placeholder').classList.remove('hidden');
        const fileInput = document.getElementById('qImage');
        if (fileInput) fileInput.value = '';
        setQuestionType('pg');
        openModal('questionModal');
        updateLatexPreview();
    }

    function editQuestion(id) {
        const q = Store.getQuestion(id);
        if (!q) return;

        clearPendingQuestionImage();
        editingQuestionId = id;
        document.getElementById('modalTitle').textContent = 'Edit Soal';
        document.getElementById('qEditId').value = id;
        document.getElementById('qText').value = q.question;
        const fileInput = document.getElementById('qImage');
        if (fileInput) fileInput.value = '';
        setQuestionType(q.type);

        if (q.type === 'pg') {
            const inputs = document.querySelectorAll('.option-input');
            const radios = document.querySelectorAll('input[name="correctOpt"]');
            q.options.forEach((opt, i) => {
                if (inputs[i]) inputs[i].value = opt;
            });
            if (radios[q.correctAnswer]) radios[q.correctAnswer].checked = true;
        } else {
            document.getElementById('qEssayAnswer').value = q.correctAnswerText || '';
        }

        if (q.imageUrl) {
            document.getElementById('qImagePreview').src = q.imageUrl;
            document.getElementById('qImagePreview').classList.remove('hidden');
            document.querySelector('.upload-placeholder').classList.add('hidden');
        } else {
            document.getElementById('qImagePreview').src = '';
            document.getElementById('qImagePreview').classList.add('hidden');
            document.querySelector('.upload-placeholder').classList.remove('hidden');
        }

        openModal('questionModal');
        updateLatexPreview();
    }

    function setupQuestionForm() {
        document.getElementById('questionForm').addEventListener('submit', (e) => {
            e.preventDefault();
            saveQuestion();
        });

        setupQuestionFilters();
    }

    async function saveQuestion() {
        const type = document.querySelector('.toggle-btn.active').dataset.type;
        const question = document.getElementById('qText').value.trim();

        if (!question) {
            toast('SOAL KOSONG', 'error');
            return;
        }

        const imgPreview = document.getElementById('qImagePreview');
        const previewVisible = !imgPreview.classList.contains('hidden');
        let imageUrl = previewVisible ? imgPreview.src : null;
        const existingQuestion = editingQuestionId ? Store.getQuestion(editingQuestionId) : null;

        const data = {
            type,
            question,
            imageUrl,
            options: [],
            correctAnswer: 0,
            correctAnswerText: ''
        };

        if (type === 'pg') {
            const inputs = document.querySelectorAll('.option-input');
            data.options = Array.from(inputs).map(i => i.value.trim());

            const filledOptions = data.options.filter(o => o);
            if (filledOptions.length < 2) {
                toast('MINIMAL 2 OPSI', 'error');
                return;
            }

            const checked = document.querySelector('input[name="correctOpt"]:checked');
            data.correctAnswer = parseInt(checked.value);
            if (!data.options[data.correctAnswer]) {
                toast('PILIH KUNCI JAWABAN', 'error');
                return;
            }
        } else {
            data.correctAnswerText = document.getElementById('qEssayAnswer').value.trim();
        }

        try {
            if (previewVisible && pendingQuestionImageBlob) {
                const uploaded = await Store.uploadQuestionImage(pendingQuestionImageBlob, {
                    questionId: editingQuestionId || Store.uuid(),
                    extension: getBlobExtension(pendingQuestionImageBlob)
                });
                imageUrl = uploaded.publicUrl;
                data.imageUrl = imageUrl;
            }

            if (editingQuestionId) {
                await Store.updateQuestion(editingQuestionId, data);
                if (existingQuestion?.imageUrl && existingQuestion.imageUrl !== data.imageUrl) {
                    await Store.deleteQuestionImageByUrl(existingQuestion.imageUrl);
                }
                toast('BERHASIL DIUPDATE', 'success');
            } else {
                await Store.addQuestion(data);
                toast('BERHASIL DITAMBAHKAN', 'success');
            }
        } catch (err) {
            toast('GAGAL: ' + err.message.toUpperCase(), 'error');
            return;
        }

        closeModal('questionModal');
        refreshQuestionList();
        refreshDashboard();
    }

    async function deleteQuestion(id) {
        if (confirm('Hapus soal ini?')) {
            try {
                await Store.deleteQuestion(id);
                toast('DIHAPUS', 'success');
                refreshQuestionList();
                refreshDashboard();
            } catch (err) {
                toast('GAGAL: ' + err.message.toUpperCase(), 'error');
            }
        }
    }

    function setQuestionType(type) {
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.toggle-btn[data-type="${type}"]`).classList.add('active');

        document.getElementById('pgOptions').classList.toggle('hidden', type === 'essay');
        document.getElementById('essayAnswer').classList.toggle('hidden', type === 'pg');
    }

    async function handleQuestionImage(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const compressed = await compressQuestionImage(file);
            clearPendingQuestionImage();
            pendingQuestionImageBlob = compressed;
            pendingQuestionImageUrl = URL.createObjectURL(compressed);

            document.getElementById('qImagePreview').src = pendingQuestionImageUrl;
            document.getElementById('qImagePreview').classList.remove('hidden');
            document.querySelector('.upload-placeholder').classList.add('hidden');

            toast(`GAMBAR DIKOMPRES ${formatBytes(file.size)} -> ${formatBytes(compressed.size)}`, 'success');
        } catch (err) {
            toast('GAGAL KOMPRES: ' + (err.message || 'UNKNOWN').toUpperCase(), 'error');
            event.target.value = '';
        }
    }

    // ===== IMPORT =====
    function showImport() {
        openModal('importModal');
        switchImportTab('paste');
    }

    function switchImportTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');
    }

    function getImportDefaultCorrectAnswer() {
        const el = document.getElementById('importDefaultKey');
        const raw = el ? parseInt(el.value, 10) : 0;
        return Math.min(4, Math.max(0, raw));
    }

    async function commitImportedQuestions(questions, parseMeta = {}) {
        await Store.addQuestionsBulk(questions);
        toast(`${questions.length} SOAL DIIMPORT`, 'success');
        closeModal('importModal');
        refreshQuestionList();
        refreshDashboard();
    }

    function parseImportText(rawText, mode = 'auto') {
        const text = rawText.trim();
        if (!text) return { ok: false, message: 'KOSONG' };

        const defaultCorrectAnswer = getImportDefaultCorrectAnswer();
        const labels = ['A', 'B', 'C', 'D', 'E'];
        const defaultAnswerLabel = labels[defaultCorrectAnswer] || 'A';
        let jsonError = null;

        const shouldTryJson = mode === 'json' || mode === 'auto';
        if (shouldTryJson) {
            try {
                const jsonResult = Parser.parseJson(text, { defaultCorrectAnswer });
                if (jsonResult.questions.length > 0) {
                    return {
                        ok: true,
                        format: 'json',
                        questions: jsonResult.questions,
                        skipped: jsonResult.skipped,
                        missingAnswerKey: jsonResult.missingAnswerKey,
                        defaultAnswerLabel
                    };
                }
                if (mode === 'json') {
                    return { ok: false, message: 'JSON VALID TAPI TIDAK ADA SOAL' };
                }
            } catch (err) {
                jsonError = err;
                if (mode === 'json') {
                    return { ok: false, message: `JSON TIDAK VALID: ${err.message}` };
                }
            }
        }

        const textResult = Parser.parseTextDetailed(text, { defaultCorrectAnswer });
        if (textResult.questions.length > 0) {
            return {
                ok: true,
                format: 'text',
                questions: textResult.questions,
                skipped: 0,
                missingAnswerKey: textResult.missingAnswerKey,
                defaultAnswerLabel
            };
        }

        if (jsonError && /^[\[{]/.test(text)) {
            return { ok: false, message: `JSON TIDAK VALID: ${jsonError.message}` };
        }

        return { ok: false, message: 'FORMAT TIDAK DIKENAL' };
    }

    async function parseAndImport() {
        const text = document.getElementById('pasteInput').value.trim();
        if (!text) {
            toast('INPUT KOSONG', 'error');
            return;
        }

        const result = parseImportText(text, 'auto');
        if (!result.ok) {
            toast(result.message, 'error');
            return;
        }

        try {
            await commitImportedQuestions(result.questions, result);
            document.getElementById('pasteInput').value = '';
        } catch (err) {
            toast('GAGAL: ' + err.message.toUpperCase(), 'error');
        }
    }

    function handleJSONFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('jsonInputText').value = e.target.result;
            toast('JSON DIMUAT', 'success');
        };
        reader.readAsText(file);
    }

    async function importJSONBulk() {
        const text = document.getElementById('jsonInputText').value.trim();
        if (!text) return;

        const result = parseImportText(text, 'json');
        if (!result.ok) {
            toast(result.message, 'error');
            return;
        }

        try {
            await commitImportedQuestions(result.questions, result);
            document.getElementById('jsonInputText').value = '';
        } catch (err) {
            toast('GAGAL: ' + err.message.toUpperCase(), 'error');
        }
    }

    async function handleOCRImage(event) {
        const files = event.target.files;
        if (!files.length) return;

        const progressEl = document.getElementById('ocrImageProgress');
        const fillEl = document.getElementById('ocrImageFill');
        const statusEl = document.getElementById('ocrImageStatus');
        const resultEl = document.getElementById('ocrImageResult');

        progressEl.classList.remove('hidden');
        resultEl.classList.add('hidden');

        try {
            const text = await OCR.recognizeImages(Array.from(files), (pct, msg) => {
                fillEl.style.width = pct + '%';
                if (msg) statusEl.textContent = msg.toUpperCase();
            });

            document.getElementById('ocrImageText').value = text;
            resultEl.classList.remove('hidden');
            progressEl.classList.add('hidden');
            toast('OCR SELESAI', 'success');
        } catch (err) {
            toast('OCR GAGAL', 'error');
            progressEl.classList.add('hidden');
        }
    }

    async function handleOCRPdf(event) {
        const file = event.target.files[0];
        if (!file) return;

        const progressEl = document.getElementById('ocrPdfProgress');
        const fillEl = document.getElementById('ocrPdfFill');
        const statusEl = document.getElementById('ocrPdfStatus');
        const resultEl = document.getElementById('ocrPdfResult');

        progressEl.classList.remove('hidden');
        resultEl.classList.add('hidden');

        try {
            const text = await OCR.recognizePdf(file, (pct, msg) => {
                fillEl.style.width = pct + '%';
                if (msg) statusEl.textContent = msg.toUpperCase();
            });

            document.getElementById('ocrPdfText').value = text;
            resultEl.classList.remove('hidden');
            progressEl.classList.add('hidden');
            toast('PDF SELESAI', 'success');
        } catch (err) {
            toast('PDF GAGAL', 'error');
            progressEl.classList.add('hidden');
        }
    }

    async function importOCRResult(textareaId) {
        const text = document.getElementById(textareaId).value.trim();
        if (!text) return;

        const result = parseImportText(text, 'auto');
        if (!result.ok) {
            toast('TIDAK ADA SOAL TERDETEKSI', 'error');
            return;
        }

        try {
            await commitImportedQuestions(result.questions, result);
            document.getElementById(textareaId).value = '';
        } catch (err) {
            toast('GAGAL', 'error');
        }
    }

    // ===== QUIZ =====
    function refreshQuizSetup() {
        const all = Store.getQuestions().length;
        const weak = Store.getWeakQuestions().length;
        const flagged = Store.getFlaggedQuestions().length;

        document.getElementById('allCount').textContent = `${all} SOAL`;
        document.getElementById('focusCount').textContent = `${weak} SOAL`;
        document.getElementById('flaggedCount').textContent = `${flagged} SOAL`;

        document.getElementById('startQuizBtn').disabled = all === 0;
    }

    function startQuiz() {
        optionFeedback = null;
        const mode = document.querySelector('input[name="quizMode"]:checked').value;
        const shuffleQ = document.getElementById('shuffleQuestions').checked;
        const hideNumbers = document.getElementById('hideNumbers').checked;
        const timerVal = document.getElementById('timerInput').value;
        const timerMinutes = timerVal ? parseInt(timerVal) : 0;

        const result = Quiz.start({ mode, shuffleQuestions: shuffleQ, hideNumbers, timerMinutes });

        if (!result.success) {
            toast(result.message.toUpperCase(), 'error');
            return;
        }

        currentView = 'quiz-active';
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('view-quiz-active').classList.add('active');
        document.getElementById('questionGrid').classList.add('hidden');

        startQuizTimer(timerMinutes);
        renderQuizQuestion();
    }

    function startFocusMode() {
        const weak = Store.getWeakQuestions();
        if (weak.length === 0) {
            toast('BELUM ADA DATA', 'error');
            return;
        }

        navigate('quiz');
        setTimeout(() => {
            const radio = document.querySelector('input[name="quizMode"][value="focus"]');
            if (radio) radio.checked = true;
        }, 100);
    }

    function startQuizTimer(minutes) {
        if (quizTimerInterval) clearInterval(quizTimerInterval);

        const startTime = Date.now();
        const limitMs = minutes * 60 * 1000;

        function updateTimer() {
            const elapsed = Date.now() - startTime;

            if (limitMs > 0) {
                const remaining = Math.max(0, limitMs - elapsed);
                const m = Math.floor(remaining / 60000);
                const s = Math.floor((remaining % 60000) / 1000);
                document.getElementById('timerDisplay').textContent =
                    `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

                if (remaining <= 0) {
                    clearInterval(quizTimerInterval);
                    endQuiz();
                }
            } else {
                const elSec = Math.floor(elapsed / 1000);
                const m = Math.floor(elSec / 60);
                const s = elSec % 60;
                document.getElementById('timerDisplay').textContent =
                    `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            }
        }

        updateTimer();
        quizTimerInterval = setInterval(updateTimer, 1000);
    }

    function renderQuizQuestion() {
        const q = Quiz.getCurrentQuestion();
        if (!q) return;

        const idx = Quiz.getCurrentIndex();
        const total = Quiz.getTotal();
        const hideNumbers = Quiz.isHideNumbers();

        const progressTextEl = document.getElementById('quizProgressText');
        const progressBarEl = document.getElementById('quizProgressBar');

        progressTextEl.textContent = hideNumbers ? 'MODE TANPA NOMOR' : `${idx + 1} / ${total}`;
        progressBarEl.style.width = `${((idx + 1) / total) * 100}%`;

        const imgEl = document.getElementById('quizQuestionImage');
        if (q.imageUrl) {
            imgEl.innerHTML = `<img src="${q.imageUrl}" alt="Soal">`;
            imgEl.classList.remove('hidden');
        } else {
            imgEl.classList.add('hidden');
        }

        document.getElementById('quizQuestionText').innerHTML = renderLatexText(q.question);

        const optionsEl = document.getElementById('quizOptions');
        const essayEl = document.getElementById('quizEssayInput');
        const feedbackEl = document.getElementById('quizAnswerFeedback');
        const userAnswer = Quiz.getAnswer(q.id);
        const feedback = optionFeedback && optionFeedback.questionId === q.id ? optionFeedback : null;

        if (q.type === 'pg') {
            essayEl.classList.add('hidden');
            optionsEl.classList.remove('hidden');

            const labels = ['A', 'B', 'C', 'D', 'E'];
            optionsEl.innerHTML = q.options
                .map((opt, i) => {
                    if (!opt) return '';
                    const selected = userAnswer === i ? 'selected' : '';
                    const correctClass = feedback && i === feedback.correct ? 'correct' : '';
                    const wrongClass = feedback && i === feedback.selected && feedback.selected !== feedback.correct ? 'wrong' : '';
                    return `<div class="quiz-option ${selected} ${correctClass} ${wrongClass}" onclick="App.selectOption(${i})">
            <strong>${labels[i]}.</strong> ${renderLatexText(opt)}
          </div>`;
                })
                .filter(Boolean)
                .join('');

            if (feedback) {
                const isCorrect = feedback.selected === feedback.correct;
                feedbackEl.className = `quiz-feedback`;
                feedbackEl.innerHTML = isCorrect ? 'BENAR' : `SALAH. JAWABAN: ${labels[feedback.correct]}`;
                feedbackEl.classList.remove('hidden');
            } else {
                feedbackEl.classList.add('hidden');
            }
        } else {
            optionsEl.classList.add('hidden');
            essayEl.classList.remove('hidden');
            document.getElementById('essayInput').value = userAnswer || '';
            feedbackEl.classList.add('hidden');
        }

        document.getElementById('flagBtn').textContent = Quiz.isFlagged(q.id) ? 'DITANDAI' : 'TANDAI';
        document.getElementById('prevBtn').disabled = idx === 0;
        document.getElementById('nextBtn').textContent = idx === total - 1 ? 'SELESAI' : 'LANJUT';
        document.getElementById('nextBtn').disabled = false;

        renderLatex();
    }

    function selectOption(idx) {
        const q = Quiz.getCurrentQuestion();
        const feedback = optionFeedback && optionFeedback.questionId === q?.id ? optionFeedback : null;
        if (!q || q.type !== 'pg' || feedback) return;

        Quiz.setAnswer(q.id, idx);
        optionFeedback = { questionId: q.id, selected: idx, correct: q.correctAnswer };
        renderQuizQuestion();
    }

    function saveEssayAnswer() {
        const q = Quiz.getCurrentQuestion();
        if (q && q.type === 'essay') {
            Quiz.setAnswer(q.id, document.getElementById('essayInput').value);
        }
    }

    function nextQuestion() {
        saveEssayAnswer();
        optionFeedback = null;
        if (Quiz.getCurrentIndex() === Quiz.getTotal() - 1) {
            if (confirm('Selesai?')) endQuiz();
        } else {
            Quiz.next();
            renderQuizQuestion();
        }
    }

    function prevQuestion() {
        saveEssayAnswer();
        optionFeedback = null;
        Quiz.prev();
        renderQuizQuestion();
    }

    function toggleFlag() {
        const q = Quiz.getCurrentQuestion();
        if (q) {
            Quiz.toggleFlag(q.id);
            document.getElementById('flagBtn').textContent = Quiz.isFlagged(q.id) ? 'DITANDAI' : 'TANDAI';
        }
    }

    function toggleGrid() {
        const grid = document.getElementById('questionGrid');
        grid.classList.toggle('hidden');
        if (!grid.classList.contains('hidden')) renderGrid();
    }

    function renderGrid() {
        const total = Quiz.getTotal();
        const currentIdx = Quiz.getCurrentIndex();
        const container = document.getElementById('gridItems');
        const state = Quiz.getState();

        container.innerHTML = state.questions.map((q, i) => {
            const classes = [
                'grid-item',
                i === currentIdx ? 'current' : '',
                Quiz.isAnswered(q.id) ? 'answered' : '',
                Quiz.isFlagged(q.id) ? 'flagged' : ''
            ].filter(Boolean).join(' ');
            return `<div class="${classes}" onclick="App.goToQuestion(${i})">${i + 1}</div>`;
        }).join('');
    }

    function goToQuestion(idx) {
        saveEssayAnswer();
        optionFeedback = null;
        Quiz.goTo(idx);
        renderQuizQuestion();
        document.getElementById('questionGrid').classList.add('hidden');
    }

    async function endQuiz() {
        saveEssayAnswer();
        if (quizTimerInterval) clearInterval(quizTimerInterval);
        currentResults = await Quiz.finish();
        showResults();
    }

    function showResults() {
        navigate('results');
        const r = currentResults;
        document.getElementById('scorePercent').textContent = r.percentage + '%';
        document.getElementById('resCorrect').textContent = r.correct;
        document.getElementById('resWrong').textContent = r.wrong;
        document.getElementById('resSkipped').textContent = r.skipped;
        document.getElementById('resTime').textContent = Stats.formatDuration(r.duration);
    }

    function reviewAnswers() {
        const section = document.getElementById('reviewSection');
        section.classList.remove('hidden');
        const questions = Store.getQuestions();
        const labels = ['A', 'B', 'C', 'D', 'E'];

        section.innerHTML = currentResults.answers.map((a, index) => {
            const q = questions.find(qu => qu.id === a.questionId);
            if (!q) return '';

            let statusBadge = '';
            let borderColor = '';

            if (a.status === 'correct') {
                statusBadge = '<span class="review-badge correct">BENAR</span>';
                borderColor = 'var(--text)';
            } else if (a.status === 'skipped') {
                statusBadge = '<span class="review-badge skipped">DILEWATI</span>';
                borderColor = 'var(--text-3)';
            } else {
                statusBadge = '<span class="review-badge wrong">SALAH</span>';
                borderColor = '#ff3333';
            }

            let userAnswerHtml = '';
            let correctAnswerHtml = '';

            if (q.type === 'pg') {
                const hasAnswer = a.userAnswer !== null && a.userAnswer !== undefined && a.userAnswer !== '';
                const userAnsLabel = hasAnswer ? labels[a.userAnswer] : '-';
                const userAnsText = hasAnswer ? renderLatexText(q.options[a.userAnswer] || '') : 'Kosong';
                const correctAnsLabel = labels[q.correctAnswer];
                const correctAnsText = renderLatexText(q.options[q.correctAnswer] || '');

                userAnswerHtml = `
                    <div class="review-answer-box ${a.status}">
                        <div class="ans-label">JAWABAN ANDA:</div>
                        <div class="ans-content"><strong>${userAnsLabel}.</strong> ${userAnsText}</div>
                    </div>`;
                correctAnswerHtml = `
                    <div class="review-answer-box correct">
                        <div class="ans-label">KUNCI JAWABAN:</div>
                        <div class="ans-content"><strong>${correctAnsLabel}.</strong> ${correctAnsText}</div>
                    </div>`;
            } else {
                const hasAnswer = a.userAnswer !== null && a.userAnswer !== undefined && a.userAnswer !== '';
                const userAnsText = hasAnswer ? a.userAnswer : '-';
                const correctAnsText = q.correctAnswerText || '';

                userAnswerHtml = `
                    <div class="review-answer-box ${a.status}">
                        <div class="ans-label">JAWABAN ANDA:</div>
                        <div class="ans-content">${renderLatexText(userAnsText)}</div>
                    </div>`;
                correctAnswerHtml = `
                    <div class="review-answer-box correct">
                        <div class="ans-label">KUNCI JAWABAN:</div>
                        <div class="ans-content">${renderLatexText(correctAnsText)}</div>
                    </div>`;
            }

            let imageHtml = '';
            if (q.imageUrl) {
                imageHtml = `<div class="review-img-wrapper"><img src="${q.imageUrl}" class="review-question-img" alt="Soal Image" /></div>`;
            }

            return `
        <div class="review-card" style="border-left: 6px solid ${borderColor}">
          <div class="review-card-header">
            <span class="review-q-num">SOAL ${index + 1}</span>
            ${statusBadge}
          </div>
          <div class="review-question">
            ${imageHtml}
            <div class="review-q-text">${renderLatexText(q.question)}</div>
          </div>
          <div class="review-answers-grid">
            ${userAnswerHtml}
            ${correctAnswerHtml}
          </div>
        </div>
      `;
        }).join('');
        renderLatex();
    }

    function refreshStats() {
        const overall = Stats.getOverallStats();
        document.getElementById('statTotalAttempts').textContent = overall.totalSessions;
        document.getElementById('statBestScore').textContent = overall.bestScore !== null ? overall.bestScore + '%' : '—';
        document.getElementById('statAvgScore').textContent = overall.avgAccuracy !== null ? overall.avgAccuracy + '%' : '—';
        document.getElementById('statMastered').textContent = overall.masteredCount;

        const habit = Stats.getHabitInsights();
        const habitEl = document.getElementById('habitInsights');
        if (!habit || !habit.hasData) {
            habitEl.innerHTML = '<div class="empty-state">BELUM ADA DATA</div>';
        } else {
            habitEl.innerHTML = `
        <div class="habit-card"><span class="habit-label">TIPE TERULIT</span><span class="habit-value">${habit.hardestLabel || '—'}</span></div>
        <div class="habit-card"><span class="habit-label">KECEPATAN</span><span class="habit-value">${habit.avgResponseSec || '0.0'}S</span></div>
        <div class="habit-card"><span class="habit-label">TREM 5 SESI</span><span class="habit-value">${habit.lastFiveAvg || 0}%</span></div>
      `;
        }

        const perQ = Stats.getPerQuestionStats();
        const container = document.getElementById('perQuestionStats');
        container.innerHTML = perQ.map(q => `
      <div class="pq-stat-item">
        <span class="pq-stat-text">${renderLatexText(truncateText(q.question, 60))}</span>
        <div class="pq-stat-bar-container">
          <div class="pq-stat-bar-fill" style="width: ${q.accuracy === -1 ? 0 : q.accuracy}%"></div>
        </div>
        <span class="pq-stat-pct">${q.accuracy === -1 ? '—' : q.accuracy + '%'}</span>
      </div>
    `).join('');
        renderLatex();
    }

    function updateLatexPreview() {
        const text = document.getElementById('qText').value;
        const preview = document.getElementById('qPreview');
        if (text.includes('$') || /\\begin\{/.test(text)) {
            preview.innerHTML = renderLatexText(text);
            preview.classList.add('has-content');
            renderLatex();
        } else {
            preview.classList.remove('has-content');
        }
    }

    function setupLatexPreview() {
        document.getElementById('qText').addEventListener('input', updateLatexPreview);
    }

    function renderLatexText(text) {
        if (!text) return '';
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }

    function renderLatex() {
        if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
            mathRenderQueue = mathRenderQueue.then(() => window.MathJax.typesetPromise()).catch(() => null);
        } else if (typeof renderMathInElement === 'function') {
            renderMathInElement(document.body, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false }
                ],
                throwOnError: false
            });
        }
    }

    function openModal(id) { document.getElementById(id).classList.add('active'); }
    function closeModal(id) {
        document.getElementById(id).classList.remove('active');
        if (id === 'questionModal') {
            clearPendingQuestionImage();
            const fileInput = document.getElementById('qImage');
            if (fileInput) fileInput.value = '';
        }
    }

    function toast(message, type = 'success') {
        const el = document.getElementById('toast');
        el.textContent = message;
        el.classList.add('visible');
        setTimeout(() => el.classList.remove('visible'), 2000);
    }

    function truncateText(text, max) { return text.length <= max ? text : text.slice(0, max) + '...'; }

    document.addEventListener('DOMContentLoaded', init);

    return {
        navigate, showAddQuestion, editQuestion, deleteQuestion,
        setQuestionType, handleQuestionImage,
        showImport, switchImportTab, parseAndImport, handleJSONFile, importJSONBulk,
        handleOCRImage, handleOCRPdf, importOCRResult,
        startQuiz, startFocusMode,
        selectOption, nextQuestion, prevQuestion,
        toggleFlag, toggleGrid, goToQuestion, endQuiz,
        reviewAnswers, closeModal, openModal, renderLatex
    };
})();
