import { Router, Request, Response, NextFunction } from 'express';
import { pgPool } from '../db/pg';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_change_in_production';

export type AuthUser = { id: number; schoolId: number; role: string };

export interface TeacherRequest extends Request {
    user?: AuthUser;
}

const verifyTeacher = (req: TeacherRequest, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
        if (decoded.role !== 'TEACHER' && decoded.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Forbidden. Teacher access only.' });
        }
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

async function assertStudentInSchool(studentId: number, schoolId: number): Promise<boolean> {
    const r = await pgPool.query(
        `SELECT 1 FROM users WHERE id = $1 AND school_id = $2 AND role = 'STUDENT'`,
        [studentId, schoolId]
    );
    return r.rows.length > 0;
}

const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

function normalizeWeekday(value: unknown): (typeof WEEKDAYS)[number] | null {
    const day = String(value ?? '').trim().toUpperCase();
    return WEEKDAYS.includes(day as (typeof WEEKDAYS)[number]) ? (day as (typeof WEEKDAYS)[number]) : null;
}

function parseYoutubePlaylistId(value: unknown): string | null {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (/^[a-zA-Z0-9_-]{10,64}$/.test(raw)) return raw;
    try {
        const u = new URL(raw);
        const list = u.searchParams.get('list');
        if (list && /^[a-zA-Z0-9_-]{10,64}$/.test(list)) return list;
    } catch {
        return null;
    }
    return null;
}

router.get('/me', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const u = req.user!;
    try {
        const r = await pgPool.query(
            `SELECT u.name, u.email, u.role, s.name AS school_name, s.registration_code
             FROM users u JOIN schools s ON s.id = u.school_id
             WHERE u.id = $1`,
            [u.id]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ ...r.rows[0], schoolId: u.schoolId });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/dashboard-data', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;

    try {
        const studentCountRes = await pgPool.query(
            `SELECT COUNT(*)::int AS c FROM users WHERE school_id = $1 AND role = 'STUDENT'`,
            [schoolId]
        );
        const totalStudents = studentCountRes.rows[0].c;

        const attendanceRes = await pgPool.query(
            `SELECT COUNT(*)::int AS num_present
             FROM attendance a
             JOIN users u ON a.student_id = u.id
             WHERE u.school_id = $1 AND a.date = CURRENT_DATE AND a.status = 'PRESENT'`,
            [schoolId]
        );
        const presentToday = attendanceRes.rows[0].num_present;

        const fallingBehindRes = await pgPool.query(
            `SELECT COUNT(DISTINCT g.student_id)::int AS num_falling
             FROM grades g
             JOIN users u ON g.student_id = u.id
             WHERE u.school_id = $1 AND g.score < 60`,
            [schoolId]
        );
        const alerts = fallingBehindRes.rows[0].num_falling;

        const pendingGradesRes = await pgPool.query(
            `SELECT COUNT(*)::int AS c
             FROM users u
             WHERE u.school_id = $1 AND u.role = 'STUDENT'
               AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.student_id = u.id)`,
            [schoolId]
        );
        const pendingGrades = pendingGradesRes.rows[0].c;

        let attendancePercent = '0%';
        if (totalStudents > 0) {
            attendancePercent = Math.round((presentToday / totalStudents) * 100) + '%';
        }

        const studentsRes = await pgPool.query(
            `SELECT u.id, u.name,
                    (SELECT a.status FROM attendance a
                     WHERE a.student_id = u.id AND a.date = CURRENT_DATE
                     ORDER BY a.id DESC LIMIT 1) AS today_status
             FROM users u
             WHERE u.school_id = $1 AND u.role = 'STUDENT'
             ORDER BY u.name
             LIMIT 50`,
            [schoolId]
        );

        const students = studentsRes.rows.map((s, index) => ({
            id: s.id,
            name: s.name,
            roll: index + 1,
            todayStatus: s.today_status || null,
        }));

        res.json({
            alerts,
            attendancePercent,
            pendingGrades,
            students,
            totalStudents,
        });
    } catch (err: any) {
        res.status(500).json({ error: 'Database Error: ' + err.message });
    }
});

router.get('/students', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

    try {
        const r = await pgPool.query(
            `SELECT u.id, u.name, u.email,
                    a.status AS attendance_status
             FROM users u
             LEFT JOIN attendance a ON a.student_id = u.id AND a.date = $2::date
             WHERE u.school_id = $1 AND u.role = 'STUDENT'
             ORDER BY u.name`,
            [schoolId, date]
        );
        res.json({ date, students: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/classes', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    try {
        const r = await pgPool.query(
            `SELECT c.id, c.name, c.teacher_id, t.name AS teacher_name
             FROM classes c
             LEFT JOIN users t ON t.id = c.teacher_id
             WHERE c.school_id = $1
             ORDER BY c.id DESC`,
            [schoolId]
        );
        res.json({ classes: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/classes', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId, id, role } = req.user!;
    const name = String(req.body.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'Class name is required' });

    const teacherId = role === 'ADMIN' ? (req.body.teacherId ?? null) : id;

    try {
        const ins = await pgPool.query(
            `INSERT INTO classes (school_id, name, teacher_id) VALUES ($1, $2, $3) RETURNING id, name, teacher_id`,
            [schoolId, name, teacherId]
        );
        res.json(ins.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/classes/:classId/claim', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId, id, role } = req.user!;
    if (role === 'ADMIN') return res.status(400).json({ error: 'Admins assign teachers from class settings if needed.' });

    const classId = parseInt(String(req.params.classId), 10);
    if (Number.isNaN(classId)) return res.status(400).json({ error: 'Invalid class' });

    try {
        const u = await pgPool.query(
            `UPDATE classes SET teacher_id = $1
             WHERE id = $2 AND school_id = $3 AND (teacher_id IS NULL OR teacher_id = $1)
             RETURNING id, name, teacher_id`,
            [id, classId, schoolId]
        );
        if (u.rows.length === 0) return res.status(404).json({ error: 'Class not found or already assigned' });
        res.json(u.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/activities/students', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    try {
        const r = await pgPool.query(
            `SELECT id, name
             FROM users
             WHERE school_id = $1 AND role = 'STUDENT'
             ORDER BY name`,
            [schoolId]
        );
        res.json({ students: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/activities', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    try {
        const r = await pgPool.query(
            `SELECT a.id, a.activity_name, a.activity_type, a.activity_date, a.achievement, a.description, a.created_at,
                    s.id AS student_id, s.name AS student_name,
                    t.id AS teacher_id, t.name AS teacher_name
             FROM activity_logs a
             JOIN users s ON s.id = a.student_id
             JOIN users t ON t.id = a.teacher_id
             WHERE a.school_id = $1
             ORDER BY a.activity_date DESC, a.created_at DESC, a.id DESC`,
            [schoolId]
        );
        res.json({ activities: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/activities', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId, id: teacherId } = req.user!;
    const studentId = parseInt(String(req.body.studentId ?? ''), 10);
    const activityName = String(req.body.activityName ?? '').trim();
    const activityType = String(req.body.activityType ?? '').trim();
    const activityDate = String(req.body.activityDate ?? '').trim();
    const achievement = String(req.body.achievement ?? '').trim();
    const description = String(req.body.description ?? '').trim();

    if (Number.isNaN(studentId)) {
        return res.status(400).json({ error: 'Student is required.' });
    }
    if (!activityName) {
        return res.status(400).json({ error: 'Activity name is required.' });
    }
    if (!activityType) {
        return res.status(400).json({ error: 'Activity type is required.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) {
        return res.status(400).json({ error: 'Activity date must be in YYYY-MM-DD format.' });
    }

    const ok = await assertStudentInSchool(studentId, schoolId);
    if (!ok) return res.status(404).json({ error: 'Student not found in your school' });

    try {
        const ins = await pgPool.query(
            `INSERT INTO activity_logs (school_id, student_id, teacher_id, activity_name, activity_type, activity_date, achievement, description)
             VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8)
             RETURNING id, school_id, student_id, teacher_id, activity_name, activity_type, activity_date, achievement, description, created_at`,
            [
                schoolId,
                studentId,
                teacherId,
                activityName,
                activityType,
                activityDate,
                achievement || null,
                description || null,
            ]
        );

        try {
            const studentRes = await pgPool.query(
                `SELECT name FROM users WHERE id = $1`,
                [studentId]
            );
            const studentName = studentRes.rows[0]?.name || 'student';
            const achievementText = achievement ? ` Achievement: ${achievement}.` : '';
            await pgPool.query(
                `INSERT INTO notifications (user_id, title, message, type)
                 VALUES ($1, 'New Activity Logged', $2, 'ACTIVITY')`,
                [
                    studentId,
                    `A new ${activityType} activity "${activityName}" was logged for ${studentName} on ${activityDate}.${achievementText}`
                ]
            );
        } catch (notifErr) {
            console.error('Failed to send activity notification:', notifErr);
        }

        res.status(201).json(ins.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/activities/:activityId', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId, id: teacherId, role } = req.user!;
    const activityId = parseInt(String(req.params.activityId), 10);
    if (Number.isNaN(activityId)) return res.status(400).json({ error: 'Invalid activity id' });

    try {
        const del = await pgPool.query(
            `DELETE FROM activity_logs
             WHERE id = $1 AND school_id = $2 AND ($3::text = 'ADMIN' OR teacher_id = $4)
             RETURNING id`,
            [activityId, schoolId, role, teacherId]
        );
        if (del.rows.length === 0) {
            return res.status(404).json({ error: 'Activity not found or you do not have permission to delete it.' });
        }
        res.json({ ok: true, id: del.rows[0].id });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


router.post('/attendance', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    const studentId = parseInt(req.body.studentId, 10);
    const status = String(req.body.status ?? '').toUpperCase();
    const dateStr = (req.body.date as string) || new Date().toISOString().slice(0, 10);

    if (!['PRESENT', 'ABSENT', 'LATE'].includes(status)) {
        return res.status(400).json({ error: 'status must be PRESENT, ABSENT, or LATE' });
    }
    if (Number.isNaN(studentId)) return res.status(400).json({ error: 'studentId required' });

    const ok = await assertStudentInSchool(studentId, schoolId);
    if (!ok) return res.status(404).json({ error: 'Student not found in your school' });

    try {
        await pgPool.query(
            `INSERT INTO attendance (student_id, date, status)
             VALUES ($1, $2::date, $3)
             ON CONFLICT (student_id, date) DO UPDATE SET status = EXCLUDED.status`,
            [studentId, dateStr, status]
        );
        res.json({ ok: true, studentId, date: dateStr, status });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/grades', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 500);

    try {
        const r = await pgPool.query(
            `SELECT g.id, g.student_id, u.name AS student_name, g.subject, g.score, g.exam_type, g.created_at
             FROM grades g
             JOIN users u ON u.id = g.student_id
             WHERE u.school_id = $1
             ORDER BY g.created_at DESC
             LIMIT $2`,
            [schoolId, limit]
        );
        res.json({ grades: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/** LMS-style courses: visible to all students in the same school (see GET /api/student/courses). */
router.get('/courses', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    try {
        const r = await pgPool.query(
            `SELECT id, title, description, youtube_playlist_id, playlist_video_count, created_at
             FROM courses WHERE school_id = $1
             ORDER BY id DESC`,
            [schoolId]
        );
        res.json({ courses: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/courses', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    const title = String(req.body.title ?? '').trim();
    const description = req.body.description != null ? String(req.body.description).trim() : '';
    const youtubePlaylistId = parseYoutubePlaylistId(req.body.youtubePlaylistUrl ?? req.body.youtubePlaylistId);
    const playlistVideoCountRaw = req.body.playlistVideoCount;
    let playlistVideoCount: number | null = null;
    if (playlistVideoCountRaw !== undefined && playlistVideoCountRaw !== null && String(playlistVideoCountRaw).trim() !== '') {
        const parsed = parseInt(String(playlistVideoCountRaw), 10);
        if (Number.isNaN(parsed) || parsed < 0) {
            return res.status(400).json({ error: 'playlistVideoCount must be a non-negative number.' });
        }
        playlistVideoCount = parsed;
    }
    if (!title) return res.status(400).json({ error: 'Course title is required' });
    if (req.body.youtubePlaylistUrl && !youtubePlaylistId) {
        return res.status(400).json({ error: 'Invalid YouTube playlist URL.' });
    }

    try {
        const ins = await pgPool.query(
            `INSERT INTO courses (school_id, title, description, youtube_playlist_id, playlist_video_count)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, title, description, youtube_playlist_id, playlist_video_count, created_at`,
            [schoolId, title, description || null, youtubePlaylistId, playlistVideoCount]
        );
        res.status(201).json(ins.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/courses/:courseId', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    const courseId = parseInt(String(req.params.courseId), 10);
    if (Number.isNaN(courseId)) return res.status(400).json({ error: 'Invalid course id' });

    try {
        const del = await pgPool.query(
            `DELETE FROM courses WHERE id = $1 AND school_id = $2 RETURNING id`,
            [courseId, schoolId]
        );
        if (del.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
        res.json({ ok: true, id: del.rows[0].id });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

const MCQ_ALLOWED_COUNTS = [5, 10, 15, 20] as const;

function validateMcqQuestionsPayload(
    questions: unknown,
    expectedCount: number
): { error: string } | null {
    if (!Array.isArray(questions) || questions.length !== expectedCount) {
        return { error: `Provide exactly ${expectedCount} questions.` };
    }
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i] as Record<string, unknown>;
        const prompt = String(q.prompt ?? '').trim();
        if (!prompt) return { error: `Question ${i + 1}: prompt is required.` };
        const opts = q.options;
        if (!Array.isArray(opts) || opts.length !== 4) {
            return { error: `Question ${i + 1}: exactly four options are required.` };
        }
        for (let j = 0; j < 4; j++) {
            if (String(opts[j] ?? '').trim() === '') {
                return { error: `Question ${i + 1}: option ${j + 1} cannot be empty.` };
            }
        }
        const ci = parseInt(String(q.correctIndex), 10);
        if (Number.isNaN(ci) || ci < 0 || ci > 3) {
            return { error: `Question ${i + 1}: correct option must be 0–3 (A–D).` };
        }
        const marks = parseFloat(String(q.marks));
        if (Number.isNaN(marks) || marks <= 0) {
            return { error: `Question ${i + 1}: marks must be a positive number.` };
        }
    }
    return null;
}

async function assertMcqTestAccess(
    testId: number,
    schoolId: number,
    teacherId: number,
    role: string
): Promise<{ ok: boolean }> {
    const r = await pgPool.query(
        `SELECT id FROM mcq_tests WHERE id = $1 AND school_id = $2 AND ($3::text = 'ADMIN' OR teacher_id = $4)`,
        [testId, schoolId, role, teacherId]
    );
    return { ok: r.rows.length > 0 };
}

/** Create a manual MCQ test (5, 10, 15, or 20 questions). */
router.post('/mcq-tests', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId, id: teacherId, role } = req.user!;
    const title = String(req.body.title ?? '').trim();
    const questionCount = parseInt(String(req.body.questionCount ?? ''), 10);

    if (!title) return res.status(400).json({ error: 'Title is required.' });
    if (!MCQ_ALLOWED_COUNTS.includes(questionCount as (typeof MCQ_ALLOWED_COUNTS)[number])) {
        return res.status(400).json({ error: 'questionCount must be 5, 10, 15, or 20.' });
    }

    const err = validateMcqQuestionsPayload(req.body.questions, questionCount);
    if (err) return res.status(400).json({ error: err.error });

    const questions = req.body.questions as Array<{
        prompt: string;
        options: string[];
        correctIndex: number;
        marks: number;
    }>;

    const client = await pgPool.connect();
    try {
        await client.query('BEGIN');
        const testIns = await client.query(
            `INSERT INTO mcq_tests (school_id, teacher_id, title, question_count)
             VALUES ($1, $2, $3, $4) RETURNING id, title, question_count, created_at`,
            [schoolId, teacherId, title, questionCount]
        );
        const test = testIns.rows[0];
        const testId = test.id as number;

        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            await client.query(
                `INSERT INTO mcq_questions (test_id, position, prompt, options, correct_index, marks)
                 VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
                [
                    testId,
                    i + 1,
                    String(q.prompt).trim(),
                    JSON.stringify(q.options.map((o) => String(o).trim())),
                    parseInt(String(q.correctIndex), 10),
                    parseFloat(String(q.marks)),
                ]
            );
        }
        await client.query('COMMIT');
        
        // Notify all students in the school
        try {
            await pgPool.query(
                `INSERT INTO notifications (user_id, title, message, type)
                 SELECT id, 'New Quiz Published', $1, 'TEST'
                 FROM users WHERE school_id = $2 AND role = 'STUDENT'`,
                [`A new quiz "${title}" has been published. Good luck!`, schoolId]
            );
        } catch (notifErr) {
            console.error('Failed to send quiz notification:', notifErr);
        }

        res.status(201).json({ ...test, id: testId });
    } catch (e: any) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

router.get('/mcq-tests', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId, id: teacherId, role } = req.user!;
    try {
        const r = await pgPool.query(
            `SELECT t.id, t.title, t.question_count, t.created_at, t.teacher_id,
                    u.name AS teacher_name,
                    (SELECT COUNT(*)::int FROM mcq_attempts a WHERE a.test_id = t.id) AS attempt_count
             FROM mcq_tests t
             JOIN users u ON u.id = t.teacher_id
             WHERE t.school_id = $1 AND ($2::text = 'ADMIN' OR t.teacher_id = $3)
             ORDER BY t.id DESC`,
            [schoolId, role, teacherId]
        );
        res.json({ tests: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

type GroqMsg = { role: 'system' | 'user' | 'assistant'; content: string };

async function callGroq(messages: GroqMsg[]): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey?.trim()) {
        throw new Error('GROQ_API_KEY_MISSING');
    }

    const model = process.env.GROQ_MODEL?.trim() || 'llama-3.1-8b-instant';

    const res = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages,
            temperature: 0.65,
            max_tokens: 2048, // Increased for longer test generations
        }),
    });

    const data = (await res.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
    };

    if (!res.ok) {
        const msg = data.error?.message || `Groq HTTP ${res.status}`;
        throw new Error(msg);
    }

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty reply from Groq');
    return text;
}

router.post('/mcq-tests/ai-generate', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { title, prompt, count } = req.body;
    const questionCount = parseInt(String(count ?? '10'), 10);
    
    if (!title || !prompt) {
        return res.status(400).json({ error: 'Title and Generator Prompt are required.' });
    }

    if (!process.env.GROQ_API_KEY?.trim()) {
        return res.status(503).json({ error: 'AI features are not configured. Please add GROQ_API_KEY to .env' });
    }

    const systemPrompt = `You are a professional educational assessment creator. 
Generate exactly ${questionCount} multiple-choice questions for a test titled "${title}" based on this topic/description: "${prompt}".
Return the response as a RAW JSON ARRAY of objects. Do not include any explanatory text, markdown formatting like \`\`\`json, or prefixes.
Each object in the array must have this exact structure:
{
  "prompt": "The question text",
  "options": ["Choice A", "Choice B", "Choice C", "Choice D"],
  "correctIndex": 0,
  "marks": 1
}
Ensure choices are clear and distinct. correctIndex must be 0, 1, 2, or 3 corresponding to index of options.`;

    try {
        const rawContent = await callGroq([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Generate the ${questionCount} questions now.` }
        ]);

        // Try to parse the JSON. If LLM included markdown blocks, strip them.
        let jsonStr = rawContent.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/```$/, '').trim();
        }

        const questions = JSON.parse(jsonStr);
        if (!Array.isArray(questions)) {
            throw new Error('AI returned an invalid format (not an array).');
        }

        res.json({ questions: questions.slice(0, questionCount) });
    } catch (err: any) {
        console.error('AI Test Gen Error:', err);
        res.status(500).json({ error: 'Failed to generate test: ' + err.message });
    }
});

router.get('/mcq-tests/:testId', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId, id: teacherId, role } = req.user!;
    const testId = parseInt(String(req.params.testId), 10);
    if (Number.isNaN(testId)) return res.status(400).json({ error: 'Invalid test id.' });

    const access = await assertMcqTestAccess(testId, schoolId, teacherId, role);
    if (!access.ok) return res.status(404).json({ error: 'Test not found.' });

    try {
        const t = await pgPool.query(
            `SELECT t.id, t.title, t.question_count, t.created_at, t.teacher_id
             FROM mcq_tests t WHERE t.id = $1`,
            [testId]
        );
        const q = await pgPool.query(
            `SELECT id, position, prompt, options, correct_index, marks
             FROM mcq_questions WHERE test_id = $1 ORDER BY position ASC`,
            [testId]
        );
        res.json({ test: t.rows[0], questions: q.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/mcq-tests/:testId', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId, id: teacherId, role } = req.user!;
    const testId = parseInt(String(req.params.testId), 10);
    if (Number.isNaN(testId)) return res.status(400).json({ error: 'Invalid test id.' });

    try {
        const del = await pgPool.query(
            `DELETE FROM mcq_tests WHERE id = $1 AND school_id = $2 AND ($3::text = 'ADMIN' OR teacher_id = $4)
             RETURNING id`,
            [testId, schoolId, role, teacherId]
        );
        if (del.rows.length === 0) return res.status(404).json({ error: 'Test not found.' });
        res.json({ ok: true, id: del.rows[0].id });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/grades', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    const studentId = parseInt(req.body.studentId, 10);
    const subject = String(req.body.subject ?? '').trim();
    const score = parseFloat(req.body.score);
    const examType = req.body.examType ? String(req.body.examType).trim() : null;

    if (Number.isNaN(studentId) || !subject) {
        return res.status(400).json({ error: 'studentId and subject are required' });
    }
    if (Number.isNaN(score) || score < 0 || score > 100) {
        return res.status(400).json({ error: 'score must be a number between 0 and 100' });
    }

    const ok = await assertStudentInSchool(studentId, schoolId);
    if (!ok) return res.status(404).json({ error: 'Student not found in your school' });

    try {
        const ins = await pgPool.query(
            `INSERT INTO grades (student_id, subject, score, exam_type) VALUES ($1, $2, $3, $4)
             RETURNING id, student_id, subject, score, exam_type, created_at`,
            [studentId, subject, score, examType]
        );

        // Notify student
        try {
            await pgPool.query(
                `INSERT INTO notifications (user_id, title, message, type)
                 VALUES ($1, 'New Grade Added', $2, 'GRADE')`,
                [studentId, `You received a score of ${score}% in ${subject} (${examType || 'General'}).`]
            );
        } catch (notifErr) {
            console.error('Failed to send grade notification:', notifErr);
        }

        res.json(ins.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/timetable', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;

    try {
        const r = await pgPool.query(
            `SELECT st.id, st.day_of_week, st.subject, st.start_time::text, st.end_time::text, st.room, st.created_at
             FROM school_timetable st
             WHERE st.school_id = $1
             ORDER BY
                CASE st.day_of_week
                    WHEN 'MONDAY' THEN 1
                    WHEN 'TUESDAY' THEN 2
                    WHEN 'WEDNESDAY' THEN 3
                    WHEN 'THURSDAY' THEN 4
                    WHEN 'FRIDAY' THEN 5
                    WHEN 'SATURDAY' THEN 6
                    WHEN 'SUNDAY' THEN 7
                    ELSE 99
                END,
                st.start_time ASC,
                st.id ASC`,
            [schoolId]
        );
        res.json({ entries: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/timetable', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    const dayOfWeek = normalizeWeekday(req.body.dayOfWeek);
    const subject = String(req.body.subject ?? '').trim();
    const startTime = String(req.body.startTime ?? '').trim();
    const endTime = String(req.body.endTime ?? '').trim();
    const room = String(req.body.room ?? '').trim();

    if (!dayOfWeek) return res.status(400).json({ error: 'dayOfWeek must be MONDAY to SUNDAY' });
    if (!subject) return res.status(400).json({ error: 'subject is required' });
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
        return res.status(400).json({ error: 'startTime and endTime must be in HH:MM format' });
    }
    if (startTime >= endTime) return res.status(400).json({ error: 'endTime must be after startTime' });

    try {
        const ins = await pgPool.query(
            `INSERT INTO school_timetable (school_id, day_of_week, subject, start_time, end_time, room)
             VALUES ($1, $2, $3, $4::time, $5::time, $6)
             RETURNING id, day_of_week, subject, start_time::text, end_time::text, room, created_at`,
            [schoolId, dayOfWeek, subject, startTime, endTime, room || null]
        );
        res.status(201).json(ins.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/timetable/:entryId', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    const entryId = parseInt(String(req.params.entryId), 10);
    if (Number.isNaN(entryId)) return res.status(400).json({ error: 'Invalid timetable entry id' });

    try {
        const del = await pgPool.query(
            `DELETE FROM school_timetable st
             WHERE st.id = $1
               AND st.school_id = $2
             RETURNING st.id`,
            [entryId, schoolId]
        );
        if (del.rows.length === 0) return res.status(404).json({ error: 'Timetable entry not found' });
        res.json({ ok: true, id: del.rows[0].id });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/search', verifyTeacher, async (req: TeacherRequest, res: Response) => {
    const { schoolId } = req.user!;
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ students: [], classes: [], tests: [] });

    const searchPattern = `%${q}%`;
    try {
        const [students, classes, tests] = await Promise.all([
            pgPool.query(
                "SELECT id, name, email FROM users WHERE school_id = $1 AND role = 'STUDENT' AND (name ILIKE $2 OR email ILIKE $2) LIMIT 10",
                [schoolId, searchPattern]
            ),
            pgPool.query(
                "SELECT id, name FROM classes WHERE school_id = $1 AND name ILIKE $2 LIMIT 10",
                [schoolId, searchPattern]
            ),
            pgPool.query(
                "SELECT id, title FROM mcq_tests WHERE school_id = $1 AND title ILIKE $2 LIMIT 10",
                [schoolId, searchPattern]
            )
        ]);
        res.json({
            students: students.rows,
            classes: classes.rows,
            tests: tests.rows
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
