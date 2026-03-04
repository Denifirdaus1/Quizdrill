/**
 * quiz.js — Quiz engine with shuffling, timer, scoring
 */
const Quiz = (() => {
    let state = {
        questions: [],      // Shuffled copy
        currentIndex: 0,
        answers: {},         // { questionId: userAnswer }
        flags: new Set(),
        startTime: null,
        timerInterval: null,
        timerSeconds: 0,
        timerLimit: 0,       // 0 = no limit
        mode: 'all',
        hideNumbers: true,
        questionStartedAt: null,
        questionDurations: {} // { questionId: milliseconds }
    };

    /**
     * Fisher-Yates shuffle
     */
    function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    /**
     * Initialize and start a new quiz
     */
    function start(options = {}) {
        const { mode = 'all', shuffleQuestions = true, hideNumbers = true, timerMinutes = 0 } = options;

        let questions;
        if (mode === 'focus') {
            questions = Store.getWeakQuestions();
        } else if (mode === 'flagged') {
            questions = Store.getFlaggedQuestions();
        } else {
            questions = Store.getQuestions();
        }

        if (questions.length === 0) {
            return { success: false, message: 'Tidak ada soal untuk mode ini!' };
        }

        state.questions = shuffleQuestions ? shuffle(questions) : [...questions];
        state.currentIndex = 0;
        state.answers = {};
        state.flags = new Set(questions.filter(q => q.flagged).map(q => q.id));
        state.startTime = Date.now();
        state.mode = mode;
        state.hideNumbers = hideNumbers;
        state.timerLimit = timerMinutes * 60;
        state.timerSeconds = 0;
        state.questionDurations = {};
        state.questionStartedAt = Date.now();

        return { success: true, total: state.questions.length };
    }

    function getCurrentQuestion() {
        return state.questions[state.currentIndex] || null;
    }

    function getCurrentIndex() {
        return state.currentIndex;
    }

    function getTotal() {
        return state.questions.length;
    }

    function setAnswer(questionId, answer) {
        state.answers[questionId] = answer;
    }

    function getAnswer(questionId) {
        return state.answers[questionId] ?? null;
    }

    function captureTimeForCurrentQuestion() {
        const q = state.questions[state.currentIndex];
        if (!q || !state.questionStartedAt) return;
        const elapsed = Math.max(0, Date.now() - state.questionStartedAt);
        state.questionDurations[q.id] = (state.questionDurations[q.id] || 0) + elapsed;
    }

    function resetQuestionTimer() {
        state.questionStartedAt = Date.now();
    }

    function freezeCurrentQuestionTimer() {
        captureTimeForCurrentQuestion();
        state.questionStartedAt = null;
    }

    function getQuestionDurationMs(questionId) {
        return state.questionDurations[questionId] || 0;
    }

    function goTo(index) {
        if (index >= 0 && index < state.questions.length) {
            captureTimeForCurrentQuestion();
            state.currentIndex = index;
            resetQuestionTimer();
        }
    }

    function next() {
        if (state.currentIndex < state.questions.length - 1) {
            captureTimeForCurrentQuestion();
            state.currentIndex++;
            resetQuestionTimer();
            return true;
        }
        return false;
    }

    function prev() {
        if (state.currentIndex > 0) {
            captureTimeForCurrentQuestion();
            state.currentIndex--;
            resetQuestionTimer();
            return true;
        }
        return false;
    }

    function isAnswered(questionId) {
        return state.answers[questionId] !== undefined && state.answers[questionId] !== null;
    }

    function isFlagged(questionId) {
        return state.flags.has(questionId);
    }

    function toggleFlag(questionId) {
        if (state.flags.has(questionId)) {
            state.flags.delete(questionId);
        } else {
            state.flags.add(questionId);
        }
        // Also persist
        Store.toggleFlag(questionId).catch(err => {
            console.error('Gagal sync flag ke Supabase:', err);
        });
    }

    function getElapsedSeconds() {
        return Math.floor((Date.now() - state.startTime) / 1000);
    }

    function getTimerLimit() {
        return state.timerLimit;
    }

    function isHideNumbers() {
        return state.hideNumbers;
    }

    /**
     * Calculate results
     */
    async function finish() {
        captureTimeForCurrentQuestion();
        const duration = getElapsedSeconds();
        let correct = 0;
        let wrong = 0;
        let skipped = 0;
        const detailed = [];
        const statsTasks = [];
        const answerEvents = [];
        const labels = ['A', 'B', 'C', 'D', 'E'];

        state.questions.forEach(q => {
            const userAnswer = state.answers[q.id];
            let isCorrect = false;
            const responseMs = getQuestionDurationMs(q.id);
            const correctAnswerLabel = q.type === 'pg' ? (labels[q.correctAnswer] || '') : (q.correctAnswerText || '');

            if (userAnswer === undefined || userAnswer === null || userAnswer === '') {
                skipped++;
                detailed.push({ questionId: q.id, userAnswer: null, isCorrect: false, status: 'skipped', responseMs });
                answerEvents.push({
                    questionId: q.id,
                    questionType: q.type,
                    selectedAnswer: null,
                    correctAnswer: correctAnswerLabel,
                    isCorrect: false,
                    status: 'skipped',
                    responseMs
                });
            } else {
                if (q.type === 'pg') {
                    isCorrect = userAnswer === q.correctAnswer;
                } else {
                    // Essay: compare lowercased trimmed
                    const normalize = s => s.toLowerCase().trim().replace(/\s+/g, ' ');
                    isCorrect = normalize(userAnswer) === normalize(q.correctAnswerText);
                }

                if (isCorrect) {
                    correct++;
                } else {
                    wrong++;
                }

                // Update per-question stats
                statsTasks.push(Store.updateQuestionStats(q.id, isCorrect, responseMs));

                detailed.push({
                    questionId: q.id,
                    userAnswer,
                    isCorrect,
                    status: isCorrect ? 'correct' : 'wrong',
                    responseMs
                });

                answerEvents.push({
                    questionId: q.id,
                    questionType: q.type,
                    selectedAnswer: q.type === 'pg' ? (labels[userAnswer] || null) : String(userAnswer),
                    correctAnswer: correctAnswerLabel,
                    isCorrect,
                    status: isCorrect ? 'correct' : 'wrong',
                    responseMs
                });
            }
        });

        const session = {
            totalQuestions: state.questions.length,
            correct,
            wrong,
            skipped,
            duration,
            mode: state.mode,
            answers: detailed
        };

        await Promise.all(statsTasks);
        const savedSession = await Store.addSession(session);
        await Store.addAnswerEvents(
            answerEvents.map(evt => ({ ...evt, sessionId: savedSession.id }))
        );

        return {
            ...savedSession,
            percentage: state.questions.length > 0 ? Math.round((correct / state.questions.length) * 100) : 0
        };
    }

    function getState() {
        return state;
    }

    return {
        start, getCurrentQuestion, getCurrentIndex, getTotal,
        setAnswer, getAnswer, goTo, next, prev,
        isAnswered, isFlagged, toggleFlag,
        getElapsedSeconds, getTimerLimit, isHideNumbers,
        freezeCurrentQuestionTimer,
        finish, getState, shuffle
    };
})();
