import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pgPool } from '../db/pg';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_change_in_production';

const normalizeEmail = (email: unknown): string =>
    String(email ?? '')
        .trim()
        .toLowerCase();

// Register a new School
router.post('/register-school', async (req: Request, res: Response) => {
    const { name, adminName, adminPassword } = req.body;
    const adminEmail = normalizeEmail(req.body.adminEmail);

    // Validation
    if (!name || name.trim().length < 3) {
        return res.status(400).json({ error: 'School name must be at least 3 characters long.' });
    }
    if (!adminName || adminName.trim().length < 2) {
        return res.status(400).json({ error: 'Admin name is required.' });
    }
    if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
        return res.status(400).json({ error: 'A valid admin email is required.' });
    }
    if (!adminPassword || adminPassword.length < 6) {
        return res.status(400).json({ error: 'Admin password must be at least 6 characters.' });
    }

    try {
        const regCode = 'SCH-' + Math.random().toString(36).substr(2, 6).toUpperCase();
        
        // Transaction
        const client = await pgPool.connect();
        try {
            await client.query('BEGIN');
            const schoolRes = await client.query(
                'INSERT INTO schools (name, registration_code) VALUES ($1, $2) RETURNING id',
                [name.trim(), regCode]
            );
            const schoolId = schoolRes.rows[0].id;

            const hash = await bcrypt.hash(adminPassword, 10);
            await client.query(
                'INSERT INTO users (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
                [schoolId, adminName.trim(), adminEmail, hash, 'ADMIN']
            );
            await client.query('COMMIT');
            
            res.json({ message: 'School created successfully', schoolId, registrationCode: regCode });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Signup for Teachers/Students
router.post('/signup', async (req: Request, res: Response) => {
    const { name, password, role } = req.body;
    const email = normalizeEmail(req.body.email);
    const registrationCode = String(req.body.registrationCode ?? '')
        .trim()
        .toUpperCase();

    // Validation
    if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: 'Name is required.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Valid email is required.' });
    }
    if (!password || password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (!['STUDENT', 'TEACHER'].includes(role?.toUpperCase())) {
        return res.status(400).json({ error: 'Invalid role specified.' });
    }
    if (!registrationCode.startsWith('SCH-')) {
        return res.status(400).json({ error: 'Invalid registration code format.' });
    }

    try {
        const schoolRes = await pgPool.query('SELECT id FROM schools WHERE UPPER(TRIM(registration_code)) = $1', [
            registrationCode,
        ]);
        if (schoolRes.rows.length === 0) return res.status(400).json({ error: 'Invalid registration code' });
        
        const schoolId = schoolRes.rows[0].id;
        const hash = await bcrypt.hash(password, 10);

        await pgPool.query(
            'INSERT INTO users (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
            [schoolId, name.trim(), email, hash, role.toUpperCase()]
        );

        // Notify school admins
        try {
            await pgPool.query(
                `INSERT INTO notifications (user_id, title, message, type)
                 SELECT id, 'New User Joined', $1, 'GENERAL'
                 FROM users WHERE school_id = $2 AND role = 'ADMIN'`,
                [`${name.trim()} (${role.toUpperCase()}) has joined your school using the registration code.`, schoolId]
            );
        } catch (notifErr) {
            console.error('Failed to send admin notification:', notifErr);
        }

        res.json({ message: 'Account created successfully' });
    } catch (err: any) {
        if (err.code === '23505') { // Unique constraint violation (email)
            return res.status(400).json({ error: 'This email is already registered.' });
        }
        res.status(500).json({ error: err.message });
    }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!password) {
        return res.status(400).json({ error: 'Password is required' });
    }

    try {
        const userRes = await pgPool.query(
            'SELECT * FROM users WHERE LOWER(TRIM(email)) = $1',
            [email]
        );
        if (userRes.rows.length === 0) {
            return res.status(400).json({
                error:
                    'No account found for this email. Check your spelling or sign up with your school code.',
            });
        }
        
        const user = userRes.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(400).json({ error: 'Invalid password. Please try again.' });

        const token = jwt.sign({ id: user.id, schoolId: user.school_id, role: user.role }, JWT_SECRET);
        res.json({ token, role: user.role, name: user.name });
    } catch (err: any) {
        res.status(500).json({ error: 'Database Error: ' + err.message });
    }
});

export default router;
