/**
 * parser.js — Parse pasted text/JSON into structured questions
 */
const Parser = (() => {
    const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'];

    function isObject(val) {
        return val && typeof val === 'object' && !Array.isArray(val);
    }

    function pickField(obj, keys) {
        for (const key of keys) {
            if (obj[key] !== undefined && obj[key] !== null) return obj[key];
        }
        return null;
    }

    function clampAnswerIndex(value) {
        if (!Number.isInteger(value)) return 0;
        if (value < 0) return 0;
        if (value >= OPTION_LABELS.length) return OPTION_LABELS.length - 1;
        return value;
    }

    function parseOrderIndex(value) {
        if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
            return value;
        }

        if (typeof value === 'string') {
            const parsed = parseInt(value.trim(), 10);
            if (Number.isInteger(parsed) && parsed > 0) return parsed;
        }

        return null;
    }

    function normalizeOptionMap(rawOptions) {
        const mapped = {};

        if (Array.isArray(rawOptions)) {
            rawOptions.slice(0, OPTION_LABELS.length).forEach((opt, idx) => {
                if (typeof opt === 'string' && opt.trim()) {
                    mapped[OPTION_LABELS[idx]] = opt.trim();
                }
            });
            return mapped;
        }

        if (!isObject(rawOptions)) return mapped;

        let fallbackIndex = 0;
        Object.entries(rawOptions).forEach(([key, value]) => {
            if (value === undefined || value === null) return;
            const text = String(value).trim();
            if (!text) return;

            const upperKey = String(key).trim().toUpperCase();
            if (/^[A-E]$/.test(upperKey)) {
                mapped[upperKey] = text;
                return;
            }

            if (/^[1-5]$/.test(upperKey)) {
                mapped[OPTION_LABELS[parseInt(upperKey, 10) - 1]] = text;
                return;
            }

            while (fallbackIndex < OPTION_LABELS.length && mapped[OPTION_LABELS[fallbackIndex]]) {
                fallbackIndex++;
            }
            if (fallbackIndex < OPTION_LABELS.length) {
                mapped[OPTION_LABELS[fallbackIndex]] = text;
            }
        });

        return mapped;
    }

    function resolveCorrectAnswerIndex(answerRaw, options) {
        if (typeof answerRaw === 'number' && Number.isInteger(answerRaw)) {
            if (answerRaw >= 0 && answerRaw < OPTION_LABELS.length) return answerRaw;
            if (answerRaw >= 1 && answerRaw <= OPTION_LABELS.length) return answerRaw - 1;
        }

        if (typeof answerRaw !== 'string') return -1;

        const answer = answerRaw.trim();
        if (!answer) return -1;

        if (/^[A-Ea-e]$/.test(answer)) {
            return answer.toUpperCase().charCodeAt(0) - 65;
        }

        if (/^[1-5]$/.test(answer)) {
            return parseInt(answer, 10) - 1;
        }

        const normalized = answer.toLowerCase();
        for (let i = 0; i < options.length; i++) {
            if ((options[i] || '').trim().toLowerCase() === normalized) return i;
        }

        return -1;
    }

    function buildQuestionFromJson(raw, config = {}) {
        const defaultCorrectAnswer = clampAnswerIndex(config.defaultCorrectAnswer ?? 0);
        const textRaw = pickField(raw, ['teks', 'question', 'soal', 'pertanyaan', 'text', 'stem']);
        const questionText = textRaw !== null ? String(textRaw).trim() : '';
        if (!questionText) return null;
        const orderIndex = parseOrderIndex(
            pickField(raw, ['order_index', 'orderIndex', 'urutan', 'nomor', 'no', 'number', 'order'])
        );

        const answerRaw = pickField(raw, [
            'jawaban',
            'jawaban_benar',
            'kunci',
            'kunci_jawaban',
            'correct_answer',
            'answer',
            'correctAnswer'
        ]);

        const rawOptions = pickField(raw, ['pilihan_jawaban', 'options', 'pilihan', 'choices', 'answers']);
        const optionMap = normalizeOptionMap(rawOptions);
        const optionList = OPTION_LABELS.map(label => optionMap[label] || '');
        const optionCount = optionList.filter(Boolean).length;

        if (optionCount >= 2) {
            const correctAnswer = resolveCorrectAnswerIndex(answerRaw, optionList);
            return {
                question: {
                    type: 'pg',
                    question: questionText,
                    options: optionList,
                    correctAnswer: correctAnswer >= 0 ? correctAnswer : defaultCorrectAnswer,
                    correctAnswerText: '',
                    imageUrl: null,
                    orderIndex
                },
                missingAnswerKey: correctAnswer < 0
            };
        }

        return {
            question: {
                type: 'essay',
                question: questionText,
                options: [],
                correctAnswer: -1,
                correctAnswerText: answerRaw !== null ? String(answerRaw).trim() : '',
                imageUrl: null,
                orderIndex
            },
            missingAnswerKey: false
        };
    }

    function extractJsonEntries(payload) {
        if (Array.isArray(payload)) {
            return payload.map((item, idx) => [`item_${idx + 1}`, item]);
        }

        if (!isObject(payload)) return [];

        if (Array.isArray(payload.questions)) {
            return payload.questions.map((item, idx) => [`questions_${idx + 1}`, item]);
        }

        if (isObject(payload.questions)) {
            return Object.entries(payload.questions);
        }

        const directArrayEntries = Object.entries(payload)
            .filter(([, value]) => Array.isArray(value))
            .flatMap(([key, arr]) => arr.map((item, idx) => [`${key}_${idx + 1}`, item]));
        if (directArrayEntries.length > 0) {
            return directArrayEntries;
        }

        const nestedArrayEntries = Object.entries(payload)
            .filter(([, value]) => isObject(value))
            .flatMap(([parentKey, nested]) =>
                Object.entries(nested)
                    .filter(([, value]) => Array.isArray(value))
                    .flatMap(([childKey, arr]) => arr.map((item, idx) => [`${parentKey}_${childKey}_${idx + 1}`, item]))
            );
        if (nestedArrayEntries.length > 0) {
            return nestedArrayEntries;
        }

        return Object.entries(payload);
    }

    /**
     * Parse text into question objects
     * Supports format:
     *   1. Question text
     *   A. Option A
     *   B. Option B
     *   C. Option C
     *   D. Option D
     *   E. Option E
     *   Jawaban: C
     *
     *   For essay:
     *   1. Question text
     *   Jawaban: answer text
     */
    function parseTextDetailed(text, options = {}) {
        const defaultCorrectAnswer = clampAnswerIndex(options.defaultCorrectAnswer ?? 0);
        const questions = [];
        let missingAnswerKey = 0;
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);

        let i = 0;
        while (i < lines.length) {
            const line = lines[i];

            // Detect question start: number followed by dot or parenthesis
            const qMatch = line.match(/^(\d+)\s*[.)]\s*(.+)/);
            if (qMatch) {
                const questionText = qMatch[2];
                const orderIndex = parseOrderIndex(qMatch[1]);
                const options = [];
                let correctAnswer = -1;
                let correctAnswerText = '';
                let isEssay = false;
                i++;

                // Collect options
                while (i < lines.length) {
                    const optMatch = lines[i].match(/^([A-Ea-e])\s*[.)]\s*(.+)/);
                    const ansMatch = lines[i].match(/^(?:jawaban|answer|kunci|key)\s*[:=]\s*(.+)/i);

                    if (optMatch) {
                        options.push(optMatch[2]);
                        i++;
                    } else if (ansMatch) {
                        const ansVal = ansMatch[1].trim();
                        const pgIndex = resolveCorrectAnswerIndex(ansVal, options);
                        if (pgIndex >= 0 && options.length >= 2) {
                            correctAnswer = pgIndex;
                        } else {
                            // Essay answer
                            correctAnswerText = ansVal;
                            isEssay = true;
                        }
                        i++;
                        break;
                    } else {
                        // Might be continuation or next question
                        break;
                    }
                }

                if (options.length >= 2 && !isEssay) {
                    // PG question
                    // Pad to 5 options if needed
                    while (options.length < 5) options.push('');
                    if (correctAnswer < 0) missingAnswerKey += 1;
                    questions.push({
                        type: 'pg',
                        question: questionText,
                        options: options.slice(0, 5),
                        correctAnswer: correctAnswer >= 0 ? correctAnswer : defaultCorrectAnswer,
                        correctAnswerText: '',
                        imageUrl: null,
                        orderIndex
                    });
                } else {
                    // Essay question
                    questions.push({
                        type: 'essay',
                        question: questionText,
                        options: [],
                        correctAnswer: -1,
                        correctAnswerText: correctAnswerText || '',
                        imageUrl: null,
                        orderIndex
                    });
                }
            } else {
                i++;
            }
        }

        return { questions, missingAnswerKey };
    }

    function parseText(text, options = {}) {
        return parseTextDetailed(text, options).questions;
    }

    function sanitizeJsonString(input) {
        if (typeof input !== 'string') return input;
        return input
            .replace(/\uFEFF/g, '')
            .replace(/[\u00A0\u2007\u202F]/g, ' ');
    }

    function parseJson(input, options = {}) {
        const defaultCorrectAnswer = clampAnswerIndex(options.defaultCorrectAnswer ?? 0);
        const rawData = typeof input === 'string'
            ? JSON.parse(sanitizeJsonString(input))
            : input;
        const entries = extractJsonEntries(rawData);
        const questions = [];
        let skipped = 0;
        let missingAnswerKey = 0;

        entries.forEach(([, raw]) => {
            if (!isObject(raw)) {
                skipped += 1;
                return;
            }

            const built = buildQuestionFromJson(raw, { defaultCorrectAnswer });
            if (!built) {
                skipped += 1;
                return;
            }

            questions.push(built.question);
            if (built.missingAnswerKey) missingAnswerKey += 1;
        });

        return {
            questions,
            skipped,
            missingAnswerKey
        };
    }

    return { parseText, parseTextDetailed, parseJson };
})();
