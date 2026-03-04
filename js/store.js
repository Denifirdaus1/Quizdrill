/**
 * store.js — Supabase-backed data layer for QuizDrill
 */
const Store = (() => {
    const SUPABASE_URL = 'https://vsiljkluzhkvcpgupdhy.supabase.co';
    const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_zcwGGukywCCYUgvS4JWeHA_VsWEYKUV';

    const TABLES = {
        questions: 'qd_questions',
        sessions: 'qd_sessions',
        settings: 'qd_settings',
        answerEvents: 'qd_answer_events'
    };

    const STORAGE = {
        questionImagesBucket: 'qd-question-images'
    };

    const KEYS = {
        deviceId: 'qd_device_id',
        questions: 'qd_questions',
        sessions: 'qd_sessions',
        settings: 'qd_settings',
        migratedToSupabase: 'qd_migrated_to_supabase_v1'
    };

    const state = {
        initialized: false,
        deviceId: null,
        questions: [],
        sessions: [],
        settings: {}
    };

    const client = (window.supabase && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)
        ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        })
        : null;

    function _get(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    }

    function _set(key, val) {
        localStorage.setItem(key, JSON.stringify(val));
    }

    function uuid() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    function getOrCreateDeviceId() {
        const params = new URLSearchParams(window.location.search);
        const fromQuery = (params.get('workspace') || '').trim();
        if (fromQuery) {
            localStorage.setItem(KEYS.deviceId, fromQuery);
            return fromQuery;
        }

        const existing = localStorage.getItem(KEYS.deviceId);
        if (existing) return existing;

        // Shared default workspace so data can be accessed from multiple devices without login.
        const id = 'quizdrill-main';
        localStorage.setItem(KEYS.deviceId, id);
        return id;
    }

    function padOptions(options = []) {
        const arr = Array.isArray(options) ? [...options] : [];
        while (arr.length < 5) arr.push('');
        return arr.slice(0, 5).map(opt => String(opt || ''));
    }

    function rowToQuestion(row) {
        return {
            id: row.id,
            type: row.type,
            question: row.question_text,
            imageUrl: row.image_url,
            options: row.type === 'pg' ? padOptions(row.options || []) : [],
            correctAnswer: row.type === 'pg' ? (Number.isInteger(row.correct_answer) ? row.correct_answer : 0) : -1,
            correctAnswerText: row.correct_answer_text || '',
            flagged: !!row.flagged,
            stats: {
                attempts: Number.isInteger(row.stats_attempts) ? row.stats_attempts : 0,
                correct: Number.isInteger(row.stats_correct) ? row.stats_correct : 0,
                wrong: Number.isInteger(row.stats_wrong) ? row.stats_wrong : 0,
                wrongStreak: Number.isInteger(row.stats_wrong_streak) ? row.stats_wrong_streak : 0,
                worstStreak: Number.isInteger(row.stats_worst_streak) ? row.stats_worst_streak : 0,
                totalResponseMs: Number.isInteger(row.stats_total_response_ms) ? row.stats_total_response_ms : 0,
                avgResponseMs: Number.isInteger(row.stats_avg_response_ms) ? row.stats_avg_response_ms : 0,
                lastAttempt: row.stats_last_attempt || null
            },
            createdAt: row.created_at || new Date().toISOString()
        };
    }

    function questionToRow(q) {
        return {
            device_id: state.deviceId,
            type: q.type,
            question_text: q.question,
            image_url: q.imageUrl || null,
            options: q.type === 'pg' ? padOptions(q.options || []) : [],
            correct_answer: q.type === 'pg'
                ? (Number.isInteger(q.correctAnswer) ? q.correctAnswer : 0)
                : -1,
            correct_answer_text: q.correctAnswerText || '',
            flagged: !!q.flagged,
            stats_attempts: Number.isInteger(q?.stats?.attempts) ? q.stats.attempts : 0,
            stats_correct: Number.isInteger(q?.stats?.correct) ? q.stats.correct : 0,
            stats_wrong: Number.isInteger(q?.stats?.wrong) ? q.stats.wrong : 0,
            stats_wrong_streak: Number.isInteger(q?.stats?.wrongStreak) ? q.stats.wrongStreak : 0,
            stats_worst_streak: Number.isInteger(q?.stats?.worstStreak) ? q.stats.worstStreak : 0,
            stats_total_response_ms: Number.isInteger(q?.stats?.totalResponseMs) ? q.stats.totalResponseMs : 0,
            stats_avg_response_ms: Number.isInteger(q?.stats?.avgResponseMs) ? q.stats.avgResponseMs : 0,
            stats_last_attempt: q?.stats?.lastAttempt || null
        };
    }

    function rowToSession(row) {
        return {
            id: row.id,
            totalQuestions: row.total_questions,
            correct: row.correct,
            wrong: row.wrong,
            skipped: row.skipped,
            duration: row.duration,
            mode: row.mode,
            answers: Array.isArray(row.answers) ? row.answers : [],
            date: row.date
        };
    }

    function sessionToRow(session) {
        return {
            device_id: state.deviceId,
            total_questions: Number.isInteger(session.totalQuestions) ? session.totalQuestions : 0,
            correct: Number.isInteger(session.correct) ? session.correct : 0,
            wrong: Number.isInteger(session.wrong) ? session.wrong : 0,
            skipped: Number.isInteger(session.skipped) ? session.skipped : 0,
            duration: Number.isInteger(session.duration) ? session.duration : 0,
            mode: session.mode || 'all',
            answers: Array.isArray(session.answers) ? session.answers : [],
            date: session.date || new Date().toISOString()
        };
    }

    function guessImageExtension(contentType = '') {
        const type = String(contentType || '').toLowerCase();
        if (type.includes('png')) return 'png';
        if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
        if (type.includes('gif')) return 'gif';
        return 'webp';
    }

    function parseImagePathFromUrl(url) {
        if (!url || typeof url !== 'string') return null;
        try {
            const parsed = new URL(url);
            const marker = `/storage/v1/object/public/${STORAGE.questionImagesBucket}/`;
            const idx = parsed.pathname.indexOf(marker);
            if (idx === -1) return null;
            const rawPath = parsed.pathname.slice(idx + marker.length);
            return decodeURIComponent(rawPath);
        } catch {
            return null;
        }
    }

    async function uploadQuestionImage(blob, options = {}) {
        if (!client) throw new Error('Supabase client tidak tersedia.');
        if (!(blob instanceof Blob)) throw new Error('File gambar tidak valid.');

        const questionId = options.questionId || uuid();
        const ext = options.extension || guessImageExtension(blob.type);
        const filePath = `${state.deviceId}/${questionId}-${Date.now()}.${ext}`;
        const contentType = blob.type || `image/${ext}`;

        const { error } = await client
            .storage
            .from(STORAGE.questionImagesBucket)
            .upload(filePath, blob, {
                cacheControl: '3600',
                upsert: false,
                contentType
            });

        if (error) throw error;

        const { data } = client
            .storage
            .from(STORAGE.questionImagesBucket)
            .getPublicUrl(filePath);

        return {
            path: filePath,
            publicUrl: data?.publicUrl || null
        };
    }

    async function deleteQuestionImageByUrl(url) {
        if (!client || !url) return;
        const path = parseImagePathFromUrl(url);
        if (!path) return;

        const { error } = await client
            .storage
            .from(STORAGE.questionImagesBucket)
            .remove([path]);

        if (error) {
            console.warn('Gagal hapus file gambar:', error.message || error);
        }
    }

    function normalizeQuestionInput(q) {
        return {
            id: uuid(),
            type: q.type || 'pg',
            question: q.question || '',
            imageUrl: q.imageUrl || null,
            options: q.type === 'essay' ? [] : padOptions(q.options || []),
            correctAnswer: q.type === 'essay' ? -1 : (Number.isInteger(q.correctAnswer) ? q.correctAnswer : 0),
            correctAnswerText: q.correctAnswerText || '',
            flagged: !!q.flagged,
            stats: {
                attempts: Number.isInteger(q?.stats?.attempts) ? q.stats.attempts : 0,
                correct: Number.isInteger(q?.stats?.correct) ? q.stats.correct : 0,
                wrong: Number.isInteger(q?.stats?.wrong) ? q.stats.wrong : 0,
                wrongStreak: Number.isInteger(q?.stats?.wrongStreak) ? q.stats.wrongStreak : 0,
                worstStreak: Number.isInteger(q?.stats?.worstStreak) ? q.stats.worstStreak : 0,
                totalResponseMs: Number.isInteger(q?.stats?.totalResponseMs) ? q.stats.totalResponseMs : 0,
                avgResponseMs: Number.isInteger(q?.stats?.avgResponseMs) ? q.stats.avgResponseMs : 0,
                lastAttempt: q?.stats?.lastAttempt || null
            },
            createdAt: new Date().toISOString()
        };
    }

    function persistCache() {
        _set(KEYS.questions, state.questions);
        _set(KEYS.sessions, state.sessions);
        _set(KEYS.settings, state.settings || {});
    }

    async function fetchRemoteSnapshot() {
        const [qRes, sRes, stRes] = await Promise.all([
            client.from(TABLES.questions)
                .select('*')
                .eq('device_id', state.deviceId)
                .order('created_at', { ascending: true }),
            client.from(TABLES.sessions)
                .select('*')
                .eq('device_id', state.deviceId)
                .order('date', { ascending: true }),
            client.from(TABLES.settings)
                .select('*')
                .eq('device_id', state.deviceId)
                .maybeSingle()
        ]);

        if (qRes.error) throw qRes.error;
        if (sRes.error) throw sRes.error;
        if (stRes.error) throw stRes.error;

        return {
            questions: (qRes.data || []).map(rowToQuestion),
            sessions: (sRes.data || []).map(rowToSession),
            settings: stRes.data?.payload || {}
        };
    }

    async function migrateLegacyDataIfNeeded(remote) {
        if (!client) return remote;
        if (_get(KEYS.migratedToSupabase) === true) return remote;

        const localQuestions = _get(KEYS.questions) || [];
        const localSessions = _get(KEYS.sessions) || [];
        const localSettings = _get(KEYS.settings) || {};

        if (localQuestions.length === 0 && localSessions.length === 0) {
            _set(KEYS.migratedToSupabase, true);
            return remote;
        }

        if (remote.questions.length > 0 || remote.sessions.length > 0) {
            _set(KEYS.migratedToSupabase, true);
            return remote;
        }

        const idMap = new Map();
        const questionRows = localQuestions.map(raw => {
            const newId = uuid();
            idMap.set(raw.id, newId);
            const normalized = {
                id: newId,
                type: raw.type || 'pg',
                question: raw.question || '',
                imageUrl: raw.imageUrl || null,
                options: raw.type === 'essay' ? [] : padOptions(raw.options || []),
                correctAnswer: Number.isInteger(raw.correctAnswer) ? raw.correctAnswer : 0,
                correctAnswerText: raw.correctAnswerText || '',
                flagged: !!raw.flagged,
                stats: {
                    attempts: Number.isInteger(raw?.stats?.attempts) ? raw.stats.attempts : 0,
                    correct: Number.isInteger(raw?.stats?.correct) ? raw.stats.correct : 0,
                    wrong: Number.isInteger(raw?.stats?.wrong) ? raw.stats.wrong : 0,
                    wrongStreak: Number.isInteger(raw?.stats?.wrongStreak) ? raw.stats.wrongStreak : 0,
                    worstStreak: Number.isInteger(raw?.stats?.worstStreak) ? raw.stats.worstStreak : 0,
                    totalResponseMs: Number.isInteger(raw?.stats?.totalResponseMs) ? raw.stats.totalResponseMs : 0,
                    avgResponseMs: Number.isInteger(raw?.stats?.avgResponseMs) ? raw.stats.avgResponseMs : 0,
                    lastAttempt: raw?.stats?.lastAttempt || null
                }
            };
            return { id: newId, ...questionToRow(normalized) };
        });

        if (questionRows.length > 0) {
            const { error } = await client.from(TABLES.questions).insert(questionRows);
            if (error) throw error;
        }

        const sessionRows = localSessions.map(raw => {
            const normalizedAnswers = Array.isArray(raw.answers)
                ? raw.answers.map(answer => ({
                    ...answer,
                    questionId: idMap.get(answer.questionId) || answer.questionId
                }))
                : [];
            return {
                id: uuid(),
                ...sessionToRow({
                    ...raw,
                    answers: normalizedAnswers,
                    date: raw.date || new Date().toISOString()
                })
            };
        });

        if (sessionRows.length > 0) {
            const { error } = await client.from(TABLES.sessions).insert(sessionRows);
            if (error) throw error;
        }

        if (localSettings && typeof localSettings === 'object' && Object.keys(localSettings).length > 0) {
            const { error } = await client.from(TABLES.settings).upsert({
                device_id: state.deviceId,
                payload: localSettings
            });
            if (error) throw error;
        }

        _set(KEYS.migratedToSupabase, true);
        return fetchRemoteSnapshot();
    }

    async function init() {
        if (state.initialized) return;

        state.deviceId = getOrCreateDeviceId();
        state.questions = _get(KEYS.questions) || [];
        state.sessions = _get(KEYS.sessions) || [];
        state.settings = _get(KEYS.settings) || {};

        if (!client) {
            state.initialized = true;
            return;
        }

        try {
            const remote = await fetchRemoteSnapshot();
            const merged = await migrateLegacyDataIfNeeded(remote);
            state.questions = merged.questions;
            state.sessions = merged.sessions;
            state.settings = merged.settings || {};
            persistCache();
        } catch (err) {
            console.error('Gagal sync Supabase, pakai cache lokal:', err);
        } finally {
            state.initialized = true;
        }
    }

    function getQuestions() {
        return [...state.questions];
    }

    async function saveQuestions(questions) {
        state.questions = Array.isArray(questions) ? questions.map(q => ({ ...q })) : [];
        persistCache();

        if (!client) return;

        const rows = state.questions.map(q => ({ id: q.id || uuid(), ...questionToRow(q) }));
        const { error: deleteError } = await client.from(TABLES.questions)
            .delete()
            .eq('device_id', state.deviceId);
        if (deleteError) throw deleteError;
        if (rows.length > 0) {
            const { error: insertError } = await client.from(TABLES.questions).insert(rows);
            if (insertError) throw insertError;
        }
    }

    async function addQuestion(q) {
        const normalized = normalizeQuestionInput(q);

        if (client) {
            const { data, error } = await client.from(TABLES.questions)
                .insert({ id: normalized.id, ...questionToRow(normalized) })
                .select('*')
                .single();
            if (error) throw error;
            state.questions.push(rowToQuestion(data));
        } else {
            state.questions.push(normalized);
        }

        persistCache();
        return state.questions[state.questions.length - 1];
    }

    async function addQuestionsBulk(questions = []) {
        const normalizedList = questions.map(normalizeQuestionInput);
        if (normalizedList.length === 0) return [];

        if (client) {
            const rows = normalizedList.map(item => ({ id: item.id, ...questionToRow(item) }));
            const { data, error } = await client.from(TABLES.questions)
                .insert(rows)
                .select('*');
            if (error) throw error;
            const saved = (data || []).map(rowToQuestion);
            state.questions.push(...saved);
            persistCache();
            return saved;
        }

        state.questions.push(...normalizedList);
        persistCache();
        return normalizedList;
    }

    async function updateQuestion(id, updates) {
        const idx = state.questions.findIndex(q => q.id === id);
        if (idx === -1) return null;

        const current = state.questions[idx];
        const merged = {
            ...current,
            ...updates,
            stats: updates.stats ? { ...current.stats, ...updates.stats } : current.stats
        };

        if (merged.type === 'pg') {
            merged.options = padOptions(merged.options || []);
            if (!Number.isInteger(merged.correctAnswer)) merged.correctAnswer = 0;
        } else {
            merged.options = [];
            merged.correctAnswer = -1;
        }

        if (client) {
            const { data, error } = await client.from(TABLES.questions)
                .update(questionToRow(merged))
                .eq('id', id)
                .eq('device_id', state.deviceId)
                .select('*')
                .single();
            if (error) throw error;
            state.questions[idx] = rowToQuestion(data);
        } else {
            state.questions[idx] = merged;
        }

        persistCache();
        return state.questions[idx];
    }

    async function deleteQuestion(id) {
        const existing = getQuestion(id);

        if (client) {
            const { error } = await client.from(TABLES.questions)
                .delete()
                .eq('id', id)
                .eq('device_id', state.deviceId);
            if (error) throw error;
        }

        state.questions = state.questions.filter(q => q.id !== id);
        persistCache();

        if (existing?.imageUrl) {
            await deleteQuestionImageByUrl(existing.imageUrl);
        }
    }

    function getQuestion(id) {
        return state.questions.find(q => q.id === id) || null;
    }

    async function toggleFlag(id) {
        const q = getQuestion(id);
        if (!q) return false;
        const next = !q.flagged;
        await updateQuestion(id, { flagged: next });
        return next;
    }

    async function updateQuestionStats(id, isCorrect, responseMs = 0) {
        const q = getQuestion(id);
        if (!q) return;

        const oldStats = q.stats || {};
        const attempts = (oldStats.attempts || 0) + 1;
        const correct = (oldStats.correct || 0) + (isCorrect ? 1 : 0);
        const wrong = (oldStats.wrong || 0) + (isCorrect ? 0 : 1);
        const wrongStreak = isCorrect ? 0 : (oldStats.wrongStreak || 0) + 1;
        const worstStreak = Math.max(oldStats.worstStreak || 0, wrongStreak);
        const safeResponseMs = Math.max(0, Number.isInteger(responseMs) ? responseMs : 0);
        const totalResponseMs = (oldStats.totalResponseMs || 0) + safeResponseMs;
        const avgResponseMs = attempts > 0 ? Math.round(totalResponseMs / attempts) : 0;

        const stats = {
            attempts,
            correct,
            wrong,
            wrongStreak,
            worstStreak,
            totalResponseMs,
            avgResponseMs,
            lastAttempt: new Date().toISOString()
        };

        await updateQuestion(id, { stats });
    }

    function getSessions() {
        return [...state.sessions];
    }

    async function addSession(session) {
        const normalized = {
            id: uuid(),
            totalQuestions: Number.isInteger(session.totalQuestions) ? session.totalQuestions : 0,
            correct: Number.isInteger(session.correct) ? session.correct : 0,
            wrong: Number.isInteger(session.wrong) ? session.wrong : 0,
            skipped: Number.isInteger(session.skipped) ? session.skipped : 0,
            duration: Number.isInteger(session.duration) ? session.duration : 0,
            mode: session.mode || 'all',
            answers: Array.isArray(session.answers) ? session.answers : [],
            date: new Date().toISOString()
        };

        if (client) {
            const { data, error } = await client.from(TABLES.sessions)
                .insert({ id: normalized.id, ...sessionToRow(normalized) })
                .select('*')
                .single();
            if (error) throw error;
            state.sessions.push(rowToSession(data));
        } else {
            state.sessions.push(normalized);
        }

        persistCache();
        return state.sessions[state.sessions.length - 1];
    }

    async function addAnswerEvents(events = []) {
        if (!Array.isArray(events) || events.length === 0) return;
        if (!client) return;

        const rows = events.map(evt => ({
            id: evt.id || uuid(),
            device_id: state.deviceId,
            session_id: evt.sessionId || null,
            question_id: evt.questionId || null,
            question_type: evt.questionType || 'pg',
            selected_answer: evt.selectedAnswer ?? null,
            correct_answer: evt.correctAnswer ?? null,
            is_correct: !!evt.isCorrect,
            status: evt.status || (evt.isCorrect ? 'correct' : 'wrong'),
            response_ms: Math.max(0, Number.isInteger(evt.responseMs) ? evt.responseMs : 0)
        }));

        const { error } = await client.from(TABLES.answerEvents).insert(rows);
        if (error) throw error;
    }

    function getWeakQuestions() {
        return getQuestions().filter(q => {
            if ((q.stats?.attempts || 0) === 0) return false;
            return (q.stats.correct / q.stats.attempts) < 0.5;
        });
    }

    function getFlaggedQuestions() {
        return getQuestions().filter(q => q.flagged);
    }

    function getMasteredQuestions() {
        return getQuestions().filter(q => {
            if ((q.stats?.attempts || 0) < 2) return false;
            return (q.stats.correct / q.stats.attempts) >= 0.8;
        });
    }

    function getSettings() {
        return { ...(state.settings || {}) };
    }

    async function saveSettings(settings) {
        state.settings = { ...(state.settings || {}), ...(settings || {}) };
        persistCache();

        if (!client) return state.settings;

        const { error } = await client.from(TABLES.settings).upsert({
            device_id: state.deviceId,
            payload: state.settings
        });
        if (error) throw error;
        return state.settings;
    }

    return {
        init,
        getQuestions, saveQuestions, addQuestion, updateQuestion, deleteQuestion,
        addQuestionsBulk,
        getQuestion, toggleFlag, updateQuestionStats,
        uploadQuestionImage, deleteQuestionImageByUrl,
        getSessions, addSession, addAnswerEvents,
        getWeakQuestions, getFlaggedQuestions, getMasteredQuestions,
        getSettings, saveSettings,
        uuid
    };
})();
