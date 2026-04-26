import { Router, Request, Response, NextFunction } from 'express';
import { pgPool } from '../db/pg';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_change_in_production';

interface AuthUser { id: number; schoolId: number; role: string }
interface AuthRequest extends Request { user?: AuthUser }

const verifyUser = (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

router.get('/', verifyUser, async (req: AuthRequest, res: Response) => {
    const userId = req.user!.id;
    try {
        const r = await pgPool.query(
            'SELECT id, title, message, type, is_read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
            [userId]
        );
        res.json({ notifications: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:id/read', verifyUser, async (req: AuthRequest, res: Response) => {
    const userId = req.user!.id;
    const notifIdParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const notifId = parseInt(notifIdParam, 10);
    try {
        await pgPool.query(
            'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2',
            [notifId, userId]
        );
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/clear-all', verifyUser, async (req: AuthRequest, res: Response) => {
    const userId = req.user!.id;
    try {
        await pgPool.query(
            'DELETE FROM notifications WHERE user_id = $1',
            [userId]
        );
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
