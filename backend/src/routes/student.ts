import { Router, Request, Response, NextFunction } from 'express';
import { pgPool } from '../db/pg';
import jwt from 'jsonwebtoken';
import VideoLibrary from '../models/VideoLibrary';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_change_in_production';

export type AuthUser = { id: number; schoolId: number; role: string };

export interface StudentRequest extends Request {
    user?: AuthUser;
}

const verifyStudent = (req: StudentRequest, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
        if (decoded.role !== 'STUDENT') {
            return res.status(403).json({ error: 'Student access only.' });
        }
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

function playlistWatchUrl(playlistId: string | null): string | null {
    if (!playlistId) return null;
    return `https://www.youtube.com/watch?v=&list=${playlistId}`;
}

router.get('/me', verifyStudent, async (req: StudentRequest, res: Response) => {
    const u = req.user!;
    try {
        const r = await pgPool.query(
            `SELECT u.name, u.email, s.name AS school_name
             FROM users u JOIN schools s ON s.id = u.school_id
             WHERE u.id = $1 AND u.role = 'STUDENT'`,
            [u.id]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
        res.json({ ...r.rows[0], schoolId: u.schoolId });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/dashboard', verifyStudent, async (req: StudentRequest, res: Response) => {
    const studentId = req.user!.id;

    try {
        const gradeAgg = await pgPool.query(
            `SELECT
                COUNT(*)::int AS n,
                COALESCE(AVG(score), 0)::numeric(6,2) AS avg_score,
                MAX(score)::numeric AS high_score
             FROM grades WHERE student_id = $1`,
            [studentId]
        );
        const g = gradeAgg.rows[0];

        const recentGrades = await pgPool.query(
            `SELECT id, subject, score, exam_type, created_at
             FROM grades WHERE student_id = $1
             ORDER BY created_at DESC LIMIT 8`,
            [studentId]
        );

        const bySubject = await pgPool.query(
            `SELECT subject,
                    ROUND(AVG(score)::numeric, 1)::float AS avg,
                    COUNT(*)::int AS entries,
                    (SELECT exam_type FROM grades g2 WHERE g2.student_id = $1 AND g2.subject = grades.subject ORDER BY g2.created_at DESC LIMIT 1) AS last_exam_type
             FROM grades WHERE student_id = $1
             GROUP BY subject
             ORDER BY AVG(score) DESC`,
            [studentId]
        );

        const att30 = await pgPool.query(
            `SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'PRESENT')::int AS present,
                COUNT(*) FILTER (WHERE status = 'LATE')::int AS late,
                COUNT(*) FILTER (WHERE status = 'ABSENT')::int AS absent
             FROM attendance
             WHERE student_id = $1 AND date >= CURRENT_DATE - INTERVAL '30 days'`,
            [studentId]
        );
        const a30 = att30.rows[0];
        const marked = a30.present + a30.late + a30.absent;
        let attendanceRate: number | null = null;
        if (marked > 0) {
            attendanceRate = Math.round(((a30.present + a30.late * 0.85) / marked) * 100);
        }

        const trend = await pgPool.query(
            `WITH days AS (
                SELECT generate_series(CURRENT_DATE - 6, CURRENT_DATE, '1 day'::interval)::date AS d
            )
            SELECT days.d::text AS day,
                   a.status AS attendance_status,
                   (SELECT COUNT(*)::int FROM mcq_attempts t WHERE t.student_id = $1 AND t.created_at::date = days.d) AS tests_count
            FROM days
            LEFT JOIN attendance a ON a.date = days.d AND a.student_id = $1
            ORDER BY days.d`,
            [studentId]
        );

        const allTimePresent = await pgPool.query(
            `SELECT COUNT(*)::int AS c FROM attendance WHERE student_id = $1 AND status = 'PRESENT'`,
            [studentId]
        );

        const courses = await pgPool.query(
            `SELECT c.id, c.title, c.description, c.youtube_playlist_id, c.playlist_video_count,
                    COALESCE(p.completed_count, 0)::int AS completed_count
             FROM courses c
             LEFT JOIN student_course_progress p
                ON p.course_id = c.id AND p.student_id = $2
             WHERE c.school_id = $1
             ORDER BY c.id DESC
             LIMIT 12`,
            [req.user!.schoolId, studentId]
        );

        const timetable = await pgPool.query(
            `SELECT id, day_of_week, subject, start_time::text, end_time::text, room
             FROM school_timetable
             WHERE school_id = $1
             ORDER BY
                CASE day_of_week
                    WHEN 'MONDAY' THEN 1
                    WHEN 'TUESDAY' THEN 2
                    WHEN 'WEDNESDAY' THEN 3
                    WHEN 'THURSDAY' THEN 4
                    WHEN 'FRIDAY' THEN 5
                    WHEN 'SATURDAY' THEN 6
                    WHEN 'SUNDAY' THEN 7
                    ELSE 99
                END,
                start_time ASC,
                id ASC`,
            [req.user!.schoolId]
        );

        const activities = await pgPool.query(
            `SELECT a.id, a.activity_name, a.activity_type, a.activity_date, a.achievement, a.description, a.created_at,
                    t.name AS teacher_name
             FROM activity_logs a
             JOIN users t ON t.id = a.teacher_id
             WHERE a.student_id = $1 AND a.school_id = $2
             ORDER BY a.activity_date DESC, a.created_at DESC, a.id DESC
             LIMIT 6`,
            [studentId, req.user!.schoolId]
        );

        res.json({
            metrics: {
                gradeCount: g.n,
                avgScore: g.n > 0 ? parseFloat(String(g.avg_score)) : null,
                highScore: g.n > 0 ? parseFloat(String(g.high_score)) : null,
                daysPresent: allTimePresent.rows[0].c,
                attendanceLast30: {
                    present: a30.present,
                    late: a30.late,
                    absent: a30.absent,
                    markedDays: marked,
                },
                attendanceRate,
            },
            recentGrades: recentGrades.rows,
            gradesBySubject: bySubject.rows,
            attendanceTrend: trend.rows,
            courses: courses.rows,
            timetable: timetable.rows,
            activities: activities.rows,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/timetable', verifyStudent, async (req: StudentRequest, res: Response) => {
    try {
        const r = await pgPool.query(
            `SELECT id, day_of_week, subject, start_time::text, end_time::text, room
             FROM school_timetable
             WHERE school_id = $1
             ORDER BY
                CASE day_of_week
                    WHEN 'MONDAY' THEN 1
                    WHEN 'TUESDAY' THEN 2
                    WHEN 'WEDNESDAY' THEN 3
                    WHEN 'THURSDAY' THEN 4
                    WHEN 'FRIDAY' THEN 5
                    WHEN 'SATURDAY' THEN 6
                    WHEN 'SUNDAY' THEN 7
                    ELSE 99
                END,
                start_time ASC,
                id ASC`,
            [req.user!.schoolId]
        );
        res.json({ entries: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/grades', verifyStudent, async (req: StudentRequest, res: Response) => {
    try {
        const r = await pgPool.query(
            `SELECT id, subject, score, exam_type, created_at
             FROM grades WHERE student_id = $1
             ORDER BY created_at DESC`,
            [req.user!.id]
        );
        res.json({ grades: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/attendance', verifyStudent, async (req: StudentRequest, res: Response) => {
    try {
        const r = await pgPool.query(
            `SELECT date::text, status, created_at
             FROM attendance
             WHERE student_id = $1
             ORDER BY date DESC
             LIMIT 90`,
            [req.user!.id]
        );
        res.json({ entries: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/activities', verifyStudent, async (req: StudentRequest, res: Response) => {
    try {
        const r = await pgPool.query(
            `SELECT a.id, a.activity_name, a.activity_type, a.activity_date, a.achievement, a.description, a.created_at,
                    t.name AS teacher_name
             FROM activity_logs a
             JOIN users t ON t.id = a.teacher_id
             WHERE a.student_id = $1 AND a.school_id = $2
             ORDER BY a.activity_date DESC, a.created_at DESC, a.id DESC`,
            [req.user!.id, req.user!.schoolId]
        );
        res.json({ activities: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/courses', verifyStudent, async (req: StudentRequest, res: Response) => {
    try {
        const r = await pgPool.query(
            `SELECT c.id, c.title, c.description, c.youtube_playlist_id, c.playlist_video_count, c.created_at,
                    COALESCE(p.completed_count, 0)::int AS completed_count
             FROM courses c
             LEFT JOIN student_course_progress p
                ON p.course_id = c.id AND p.student_id = $2
             WHERE c.school_id = $1
             ORDER BY c.title`,
            [req.user!.schoolId, req.user!.id]
        );
        const courses = r.rows.map((row) => ({
            ...row,
            youtube_playlist_url: playlistWatchUrl(row.youtube_playlist_id as string | null),
        }));
        res.json({ courses });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/courses/:courseId/progress', verifyStudent, async (req: StudentRequest, res: Response) => {
    const courseId = parseInt(String(req.params.courseId), 10);
    if (Number.isNaN(courseId)) return res.status(400).json({ error: 'Invalid course id' });
    try {
        const r = await pgPool.query(
            `SELECT c.id, c.title, c.youtube_playlist_id, c.playlist_video_count,
                    COALESCE(p.completed_count, 0)::int AS completed_count
             FROM courses c
             LEFT JOIN student_course_progress p
                ON p.course_id = c.id AND p.student_id = $2
             WHERE c.id = $1 AND c.school_id = $3`,
            [courseId, req.user!.id, req.user!.schoolId]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
        const row = r.rows[0];
        const total = row.playlist_video_count == null ? null : parseInt(String(row.playlist_video_count), 10);
        const completed = parseInt(String(row.completed_count), 10) || 0;
        const safeTotal = total != null && total > 0 ? total : null;
        const percent = safeTotal ? Math.min(100, Math.round((completed / safeTotal) * 100)) : 0;
        res.json({
            courseId: row.id,
            title: row.title,
            youtubePlaylistId: row.youtube_playlist_id || null,
            youtubePlaylistUrl: playlistWatchUrl(row.youtube_playlist_id || null),
            totalVideos: safeTotal,
            completedVideos: completed,
            percent,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/courses/:courseId/progress/complete', verifyStudent, async (req: StudentRequest, res: Response) => {
    const courseId = parseInt(String(req.params.courseId), 10);
    if (Number.isNaN(courseId)) return res.status(400).json({ error: 'Invalid course id' });
    try {
        const c = await pgPool.query(
            `SELECT id, playlist_video_count
             FROM courses
             WHERE id = $1 AND school_id = $2`,
            [courseId, req.user!.schoolId]
        );
        if (c.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
        const totalRaw = c.rows[0].playlist_video_count;
        const total = totalRaw == null ? null : parseInt(String(totalRaw), 10);
        const up = await pgPool.query(
            `INSERT INTO student_course_progress (student_id, course_id, completed_count, updated_at)
             VALUES ($1, $2, 1, CURRENT_TIMESTAMP)
             ON CONFLICT (student_id, course_id)
             DO UPDATE
             SET completed_count = CASE
                    WHEN $3::int IS NOT NULL AND student_course_progress.completed_count >= $3::int THEN student_course_progress.completed_count
                    ELSE student_course_progress.completed_count + 1
                 END,
                 updated_at = CURRENT_TIMESTAMP
             RETURNING completed_count`,
            [req.user!.id, courseId, total]
        );
        const completed = parseInt(String(up.rows[0].completed_count), 10) || 0;
        const percent = total && total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
        res.json({ courseId, totalVideos: total, completedVideos: completed, percent });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/courses/:courseId/progress/reset', verifyStudent, async (req: StudentRequest, res: Response) => {
    const courseId = parseInt(String(req.params.courseId), 10);
    if (Number.isNaN(courseId)) return res.status(400).json({ error: 'Invalid course id' });
    try {
        const c = await pgPool.query(
            `SELECT id, playlist_video_count
             FROM courses
             WHERE id = $1 AND school_id = $2`,
            [courseId, req.user!.schoolId]
        );
        if (c.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
        await pgPool.query(
            `INSERT INTO student_course_progress (student_id, course_id, completed_count, updated_at)
             VALUES ($1, $2, 0, CURRENT_TIMESTAMP)
             ON CONFLICT (student_id, course_id)
             DO UPDATE SET completed_count = 0, updated_at = CURRENT_TIMESTAMP`,
            [req.user!.id, courseId]
        );
        res.json({ courseId, completedVideos: 0, totalVideos: c.rows[0].playlist_video_count || null, percent: 0 });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/videos', verifyStudent, async (_req: StudentRequest, res: Response) => {
    try {
        const videos = await VideoLibrary.find({}).sort({ createdAt: -1 }).limit(40).lean();
        res.json(videos);
    } catch {
        res.json([]);
    }
});

/** MCQ tests published for the student's school (one attempt per test). */
router.get('/mcq-tests', verifyStudent, async (req: StudentRequest, res: Response) => {
    const studentId = req.user!.id;
    const schoolId = req.user!.schoolId;
    try {
        const r = await pgPool.query(
            `SELECT t.id, t.title, t.question_count, t.created_at,
                    u.name AS teacher_name,
                    a.score_earned, a.max_score, a.created_at AS submitted_at
             FROM mcq_tests t
             JOIN users u ON u.id = t.teacher_id
             LEFT JOIN mcq_attempts a ON a.test_id = t.id AND a.student_id = $1
             WHERE t.school_id = $2
             ORDER BY t.id DESC`,
            [studentId, schoolId]
        );
        res.json({ tests: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/** Test paper for taking — no correct answers exposed. */
router.get('/mcq-tests/:testId', verifyStudent, async (req: StudentRequest, res: Response) => {
    const studentId = req.user!.id;
    const schoolId = req.user!.schoolId;
    const testId = parseInt(String(req.params.testId), 10);
    if (Number.isNaN(testId)) return res.status(400).json({ error: 'Invalid test id.' });

    try {
        const t = await pgPool.query(
            `SELECT t.id, t.title, t.question_count, t.created_at
             FROM mcq_tests t WHERE t.id = $1 AND t.school_id = $2`,
            [testId, schoolId]
        );
        if (t.rows.length === 0) return res.status(404).json({ error: 'Test not found.' });

        const att = await pgPool.query(
            `SELECT score_earned, max_score, created_at FROM mcq_attempts WHERE test_id = $1 AND student_id = $2`,
            [testId, studentId]
        );
        if (att.rows.length > 0) {
            return res.json({
                alreadySubmitted: true,
                attempt: att.rows[0],
                test: t.rows[0],
                questions: [],
            });
        }

        const q = await pgPool.query(
            `SELECT id, position, prompt, options, marks FROM mcq_questions WHERE test_id = $1 ORDER BY position ASC`,
            [testId]
        );
        const questions = q.rows.map((row) => ({
            id: row.id,
            position: row.position,
            prompt: row.prompt,
            marks: parseFloat(String(row.marks)),
            options: row.options,
        }));
        res.json({ alreadySubmitted: false, test: t.rows[0], questions });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/mcq-tests/:testId/submit', verifyStudent, async (req: StudentRequest, res: Response) => {
    const studentId = req.user!.id;
    const schoolId = req.user!.schoolId;
    const testId = parseInt(String(req.params.testId), 10);
    if (Number.isNaN(testId)) return res.status(400).json({ error: 'Invalid test id.' });

    const answersIn = req.body.answers;
    if (!answersIn || typeof answersIn !== 'object' || Array.isArray(answersIn)) {
        return res.status(400).json({ error: 'answers must be an object mapping question id to selected option index (0–3).' });
    }

    const client = await pgPool.connect();
    try {
        await client.query('BEGIN');

        const t = await client.query(
            `SELECT id, title, question_count FROM mcq_tests WHERE id = $1 AND school_id = $2 FOR UPDATE`,
            [testId, schoolId]
        );
        if (t.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Test not found.' });
        }
        const testRow = t.rows[0];

        const existing = await client.query(
            `SELECT id FROM mcq_attempts WHERE test_id = $1 AND student_id = $2`,
            [testId, studentId]
        );
        if (existing.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'You have already submitted this test.' });
        }

        const qrows = await client.query(
            `SELECT id, correct_index, marks FROM mcq_questions WHERE test_id = $1 ORDER BY position ASC`,
            [testId]
        );
        if (qrows.rows.length !== testRow.question_count) {
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'Test data is inconsistent.' });
        }

        let earned = 0;
        let maxScore = 0;
        const storedAnswers: Record<string, number> = {};

        for (const row of qrows.rows) {
            const qid = row.id as number;
            maxScore += parseFloat(String(row.marks));
            const key = String(qid);
            const raw = answersIn[key];
            if (raw === undefined || raw === null) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Missing answer for question ${key}.` });
            }
            const sel = parseInt(String(raw), 10);
            if (Number.isNaN(sel) || sel < 0 || sel > 3) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Invalid option for question ${key}.` });
            }
            storedAnswers[key] = sel;
            if (sel === Number(row.correct_index)) {
                earned += parseFloat(String(row.marks));
            }
        }

        await client.query(
            `INSERT INTO mcq_attempts (test_id, student_id, score_earned, max_score, answers)
             VALUES ($1, $2, $3, $4, $5::jsonb)`,
            [testId, studentId, earned, maxScore, JSON.stringify(storedAnswers)]
        );

        const pct = maxScore > 0 ? Math.round((earned / maxScore) * 10000) / 100 : 0;
        const title = String(testRow.title).trim();
        const subject = ('MCQ: ' + title).slice(0, 100);
        await client.query(
            `INSERT INTO grades (student_id, subject, score, exam_type) VALUES ($1, $2, $3, $4)`,
            [studentId, subject, pct, 'MCQ Test']
        );

        await client.query('COMMIT');

        // Notify the teacher who created the test
        try {
            const testInfoRes = await pgPool.query(
                `SELECT t.teacher_id, t.title, u.name as student_name 
                 FROM mcq_tests t
                 CROSS JOIN (SELECT name FROM users WHERE id = $2) u
                 WHERE t.id = $1`,
                [testId, studentId]
            );
            if (testInfoRes.rows.length > 0) {
                const { teacher_id, title: testTitle, student_name } = testInfoRes.rows[0];
                await pgPool.query(
                    `INSERT INTO notifications (user_id, title, message, type)
                     VALUES ($1, 'New Test Submission', $2, 'TEST')`,
                    [teacher_id, `${student_name} has submitted their attempt for the quiz "${testTitle}". Score: ${earned}/${maxScore}.`]
                );
            }
        } catch (notifErr) {
            console.error('Failed to send teacher notification:', notifErr);
        }

        res.json({
            scoreEarned: earned,
            maxScore,
            percent: pct,
            correctTotal: qrows.rows.filter((row) => {
                const qid = String(row.id);
                return storedAnswers[qid] === Number(row.correct_index);
            }).length,
            questionCount: qrows.rows.length,
        });
    } catch (e: any) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

router.post('/profile/update', verifyStudent, async (req: StudentRequest, res: Response) => {
    const studentId = req.user!.id;
    const { email, password } = req.body;
    
    if (!email && !password) {
        return res.status(400).json({ error: 'No update data provided.' });
    }

    try {
        const updates: string[] = [];
        const params: any[] = [];
        let paramIdx = 1;

        if (email) {
            const cleanEmail = String(email).trim();
            // Check if email is already taken by someone else (case-insensitive check)
            const check = await pgPool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2', [cleanEmail, studentId]);
            if (check.rows.length > 0) {
                return res.status(400).json({ error: 'This email is already associated with another account.' });
            }
            updates.push(`email = $${paramIdx++}`);
            params.push(cleanEmail);
        }

        if (password) {
            if (String(password).length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters.' });
            }
            const hash = await require('bcrypt').hash(password, 10);
            updates.push(`password_hash = $${paramIdx++}`);
            params.push(hash);
        }

        params.push(studentId);
        await pgPool.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
            params
        );

        res.json({ message: 'Profile updated successfully.' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/** Quiz review — question-by-question answers + AI analysis */
router.get('/mcq-tests/:testId/review', verifyStudent, async (req: StudentRequest, res: Response) => {
    const studentId = req.user!.id;
    const schoolId = req.user!.schoolId;
    const testId = parseInt(String(req.params.testId), 10);
    if (Number.isNaN(testId)) return res.status(400).json({ error: 'Invalid test id.' });

    try {
        // Verify test belongs to school
        const t = await pgPool.query(
            `SELECT t.id, t.title, t.question_count, t.created_at
             FROM mcq_tests t WHERE t.id = $1 AND t.school_id = $2`,
            [testId, schoolId]
        );
        if (t.rows.length === 0) return res.status(404).json({ error: 'Test not found.' });

        // Verify student has submitted
        const att = await pgPool.query(
            `SELECT score_earned, max_score, answers, created_at
             FROM mcq_attempts WHERE test_id = $1 AND student_id = $2`,
            [testId, studentId]
        );
        if (att.rows.length === 0) {
            return res.status(400).json({ error: 'You have not submitted this test yet.' });
        }

        const attempt = att.rows[0];
        const studentAnswers: Record<string, number> = typeof attempt.answers === 'string'
            ? JSON.parse(attempt.answers)
            : attempt.answers;

        // Get all questions with correct answers
        const q = await pgPool.query(
            `SELECT id, position, prompt, options, correct_index, marks
             FROM mcq_questions WHERE test_id = $1 ORDER BY position ASC`,
            [testId]
        );

        const letters = ['A', 'B', 'C', 'D'];
        let correctCount = 0;
        let wrongCount = 0;
        const wrongTopics: string[] = [];
        const correctTopics: string[] = [];

        const questions = q.rows.map((row) => {
            const qid = String(row.id);
            const studentAnswer = studentAnswers[qid] ?? -1;
            const correctIndex = Number(row.correct_index);
            const isCorrect = studentAnswer === correctIndex;
            const opts = Array.isArray(row.options) ? row.options : [];

            if (isCorrect) {
                correctCount++;
                correctTopics.push(String(row.prompt).slice(0, 80));
            } else {
                wrongCount++;
                wrongTopics.push(String(row.prompt).slice(0, 80));
            }

            return {
                id: row.id,
                position: row.position,
                prompt: row.prompt,
                options: opts,
                marks: parseFloat(String(row.marks)),
                correctIndex,
                correctLetter: letters[correctIndex] || '?',
                studentAnswer,
                studentLetter: studentAnswer >= 0 && studentAnswer <= 3 ? letters[studentAnswer] : '—',
                isCorrect,
            };
        });

        const earned = parseFloat(String(attempt.score_earned));
        const maxScore = parseFloat(String(attempt.max_score));
        const percent = maxScore > 0 ? Math.round((earned / maxScore) * 1000) / 10 : 0;

        // Build AI analysis
        let aiAnalysis = null;
        const groqKey = process.env.GROQ_API_KEY?.trim();
        if (groqKey) {
            try {
                const model = process.env.GROQ_MODEL?.trim() || 'llama-3.1-8b-instant';
                const analysisPrompt = `You are an educational performance analyst. A student completed a quiz titled "${t.rows[0].title}".

Results: ${correctCount} correct out of ${questions.length} questions (${percent}%).

Questions they got WRONG:
${wrongTopics.length > 0 ? wrongTopics.map((t, i) => `${i + 1}. ${t}`).join('\n') : 'None — perfect score!'}

Questions they got RIGHT:
${correctTopics.length > 0 ? correctTopics.map((t, i) => `${i + 1}. ${t}`).join('\n') : 'None.'}

Based on this data, provide a JSON object with these exact keys:
{
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
  "overallRemark": "A brief 1-2 sentence motivational remark about their performance"
}

Rules:
- strengths: 2-3 specific areas where the student did well based on correct answers
- weaknesses: 1-3 specific areas to improve based on wrong answers (empty array if perfect score)
- suggestions: 2-3 actionable study tips specific to their weak areas
- overallRemark: encouraging, specific to their score range
- Return ONLY the raw JSON object, no markdown, no explanation`;

                const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${groqKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model,
                        messages: [
                            { role: 'system', content: 'You are an educational analyst. Return only valid JSON.' },
                            { role: 'user', content: analysisPrompt },
                        ],
                        temperature: 0.5,
                        max_tokens: 512,
                    }),
                });

                const groqData = await groqRes.json().catch(() => ({})) as any;
                if (groqRes.ok && groqData.choices?.[0]?.message?.content) {
                    let raw = groqData.choices[0].message.content.trim();
                    if (raw.startsWith('```')) {
                        raw = raw.replace(/^```json\n?/, '').replace(/```$/, '').trim();
                    }
                    aiAnalysis = JSON.parse(raw);
                }
            } catch (aiErr) {
                console.error('AI analysis error (non-fatal):', aiErr);
            }
        }

        res.json({
            test: t.rows[0],
            attempt: {
                scoreEarned: earned,
                maxScore,
                percent,
                submittedAt: attempt.created_at,
            },
            summary: {
                totalQuestions: questions.length,
                correctCount,
                wrongCount,
            },
            questions,
            aiAnalysis,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/search', verifyStudent, async (req: StudentRequest, res: Response) => {
    const { schoolId } = req.user!;
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ courses: [], tests: [] });

    const searchPattern = `%${q}%`;
    try {
        const [courses, tests] = await Promise.all([
            pgPool.query(
                "SELECT id, title, description FROM courses WHERE school_id = $1 AND (title ILIKE $2 OR description ILIKE $2) LIMIT 10",
                [schoolId, searchPattern]
            ),
            pgPool.query(
                "SELECT id, title FROM mcq_tests WHERE school_id = $1 AND title ILIKE $2 LIMIT 10",
                [schoolId, searchPattern]
            )
        ]);
        res.json({
            courses: courses.rows,
            tests: tests.rows
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
