/**
 * stats.js — Statistics engine
 */
const Stats = (() => {

    function getOverallStats() {
        const sessions = Store.getSessions();
        const questions = Store.getQuestions();

        if (sessions.length === 0) {
            return {
                totalSessions: 0,
                totalAttempts: 0,
                avgAccuracy: null,
                bestScore: null,
                weakCount: Store.getWeakQuestions().length,
                masteredCount: Store.getMasteredQuestions().length,
                totalQuestions: questions.length
            };
        }

        const totalAttempts = sessions.reduce((sum, s) => sum + s.totalQuestions, 0);
        const totalCorrect = sessions.reduce((sum, s) => sum + s.correct, 0);
        const avgAccuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;
        const bestScore = Math.max(...sessions.map(s =>
            s.totalQuestions > 0 ? Math.round((s.correct / s.totalQuestions) * 100) : 0
        ));

        return {
            totalSessions: sessions.length,
            totalAttempts,
            avgAccuracy,
            bestScore,
            weakCount: Store.getWeakQuestions().length,
            masteredCount: Store.getMasteredQuestions().length,
            totalQuestions: questions.length
        };
    }

    function getPerQuestionStats() {
        const questions = Store.getQuestions();
        return questions.map(q => {
            const accuracy = q.stats.attempts > 0
                ? Math.round((q.stats.correct / q.stats.attempts) * 100)
                : -1;  // -1 means never attempted
            return {
                id: q.id,
                question: q.question,
                type: q.type,
                attempts: q.stats.attempts,
                correct: q.stats.correct,
                accuracy,
                flagged: q.flagged
            };
        }).sort((a, b) => {
            // Sort: unattempted first, then by accuracy ascending (weakest first)
            if (a.accuracy === -1 && b.accuracy !== -1) return -1;
            if (a.accuracy !== -1 && b.accuracy === -1) return 1;
            return a.accuracy - b.accuracy;
        });
    }

    function getSessionHistory() {
        return Store.getSessions().reverse().map(s => {
            const pct = s.totalQuestions > 0 ? Math.round((s.correct / s.totalQuestions) * 100) : 0;
            return {
                ...s,
                percentage: pct,
                dateFormatted: formatDate(s.date),
                durationFormatted: formatDuration(s.duration)
            };
        });
    }

    function getHabitInsights() {
        const sessions = Store.getSessions();
        const questions = Store.getQuestions();
        if (sessions.length === 0) {
            return { hasData: false };
        }

        const questionMap = new Map(questions.map(q => [q.id, q]));
        const answered = sessions
            .flatMap(s => (Array.isArray(s.answers) ? s.answers : []))
            .filter(a => a.status === 'correct' || a.status === 'wrong');

        if (answered.length === 0) {
            return { hasData: false };
        }

        const wrongCountByQuestion = new Map();
        answered.forEach(a => {
            if (a.status === 'wrong') {
                wrongCountByQuestion.set(a.questionId, (wrongCountByQuestion.get(a.questionId) || 0) + 1);
            }
        });

        let mostWrongQuestionId = null;
        let mostWrongCount = 0;
        wrongCountByQuestion.forEach((count, qid) => {
            if (count > mostWrongCount) {
                mostWrongCount = count;
                mostWrongQuestionId = qid;
            }
        });

        const responseSamples = answered
            .map(a => Number.isInteger(a.responseMs) ? a.responseMs : null)
            .filter(v => v !== null && v >= 0);
        const avgResponseMs = responseSamples.length > 0
            ? Math.round(responseSamples.reduce((sum, v) => sum + v, 0) / responseSamples.length)
            : 0;

        const fastWindowMs = 7000;
        const fastSamples = answered.filter(a => Number.isInteger(a.responseMs) && a.responseMs > 0 && a.responseMs <= fastWindowMs);
        const fastMistakeRate = fastSamples.length > 0
            ? Math.round((fastSamples.filter(a => a.status === 'wrong').length / fastSamples.length) * 100)
            : 0;

        const hourCount = new Map();
        sessions.forEach(s => {
            const d = new Date(s.date);
            if (!Number.isNaN(d.getTime())) {
                const h = d.getHours();
                hourCount.set(h, (hourCount.get(h) || 0) + 1);
            }
        });
        let peakHour = null;
        let peakHourCount = 0;
        hourCount.forEach((count, hour) => {
            if (count > peakHourCount) {
                peakHourCount = count;
                peakHour = hour;
            }
        });

        const hardestQuestion = mostWrongQuestionId ? questionMap.get(mostWrongQuestionId) : null;
        const hardestLabel = hardestQuestion
            ? `${truncateText(hardestQuestion.question, 58)} (${mostWrongCount}x salah)`
            : 'Belum ada pola soal salah dominan';

        let paceLabel = 'Ritme stabil';
        if (fastSamples.length >= 5 && fastMistakeRate >= 60) paceLabel = 'Sering terburu-buru';
        else if (avgResponseMs >= 25000) paceLabel = 'Cenderung lambat tapi teliti';

        const worstStreak = questions.reduce((max, q) => Math.max(max, q?.stats?.worstStreak || 0), 0);
        const lastFive = sessions.slice(-5);
        const lastFiveAvg = lastFive.length > 0
            ? Math.round(lastFive.reduce((sum, s) => {
                if ((s.totalQuestions || 0) === 0) return sum;
                return sum + Math.round((s.correct / s.totalQuestions) * 100);
            }, 0) / lastFive.length)
            : 0;

        return {
            hasData: true,
            hardestLabel,
            paceLabel,
            avgResponseSec: (avgResponseMs / 1000).toFixed(1),
            fastMistakeRate,
            peakHourLabel: peakHour === null ? 'Belum terdeteksi' : `${String(peakHour).padStart(2, '0')}:00`,
            worstStreak,
            lastFiveAvg
        };
    }

    function truncateText(text, max) {
        if (!text) return '';
        if (text.length <= max) return text;
        return text.slice(0, max) + '...';
    }

    function formatDate(iso) {
        const d = new Date(iso);
        const now = new Date();
        const diff = now - d;

        if (diff < 60000) return 'Baru saja';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} menit lalu`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} jam lalu`;

        return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }

    function formatDuration(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    return { getOverallStats, getPerQuestionStats, getSessionHistory, getHabitInsights, formatDuration };
})();
