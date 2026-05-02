import { Router, Request, Response, NextFunction } from 'express';
import { pgPool } from '../db/pg';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Conversation from '../models/Conversation';
import Message from '../models/Message';

import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_change_in_production';

/* ── Storage setup (Cloudinary or Local Fallback) ── */
let storage: any;

if (process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    storage = new CloudinaryStorage({
        cloudinary: cloudinary,
        params: async (req, file) => ({
            folder: 'skillway_chat',
            resource_type: 'auto',
            public_id: Date.now() + '-' + Math.round(Math.random() * 1e9)
        })
    });
} else {
    const uploadDir = path.join(__dirname, '../../uploads/chat');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    
    storage = multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir),
        filename: (_req, file, cb) => {
            const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
            cb(null, unique + path.extname(file.originalname));
        }
    });
}

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = [
            'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        cb(null, ok.includes(file.mimetype));
    }
});

/* ── Auth middleware (both roles) ── */
interface ChatRequest extends Request {
    user?: { id: number; schoolId: number; role: string };
}

const verifyUser = (req: ChatRequest, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(token, JWT_SECRET) as any;
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

/* ── GET /conversations ── */
router.get('/conversations', verifyUser, async (req: ChatRequest, res: Response) => {
    try {
        const convs = await Conversation.find({
            schoolId: req.user!.schoolId,
            participants: req.user!.id,
            deletedFor: { $ne: req.user!.id }
        }).sort({ lastMessageAt: -1 }).limit(50).lean();

        const withUnread = await Promise.all(convs.map(async (c) => {
            const unreadCount = await Message.countDocuments({
                conversationId: c._id,
                senderId: { $ne: req.user!.id },
                readBy: { $nin: [req.user!.id] },
                deletedFor: { $ne: req.user!.id }
            });

            // Get the actual last message the user can see
            const actualLastMsg = await Message.findOne({
                conversationId: c._id,
                deletedFor: { $ne: req.user!.id }
            }).sort({ createdAt: -1 });

            let lastMessage = 'No messages yet';
            if (actualLastMsg) {
                if (actualLastMsg.isDeleted) {
                    lastMessage = 'This message was deleted';
                } else {
                    lastMessage = actualLastMsg.attachments && actualLastMsg.attachments.length > 0 
                        ? `📎 ${actualLastMsg.attachments[0].originalName}` 
                        : (actualLastMsg.content?.slice(0, 100) || '');
                }
            }

            return { ...c, unreadCount, lastMessage };
        }));
        res.json({ conversations: withUnread });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/* ── POST /conversations ── */
router.post('/conversations', verifyUser, async (req: ChatRequest, res: Response) => {
    const { participantId } = req.body;
    if (!participantId) return res.status(400).json({ error: 'participantId required' });
    const myId = req.user!.id;
    const schoolId = req.user!.schoolId;
    if (participantId === myId) return res.status(400).json({ error: 'Cannot chat with yourself.' });

    try {
        const pCheck = await pgPool.query(
            'SELECT id, name, role FROM users WHERE id = $1 AND school_id = $2',
            [participantId, schoolId]
        );
        if (pCheck.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
        const partner = pCheck.rows[0];

        const meCheck = await pgPool.query('SELECT name, role FROM users WHERE id = $1', [myId]);
        const me = meCheck.rows[0];

        let conv = await Conversation.findOne({
            schoolId,
            participants: { $all: [myId, participantId], $size: 2 }
        });

        if (!conv) {
            conv = await Conversation.create({
                schoolId,
                participants: [myId, participantId],
                participantNames: { [String(myId)]: me.name, [String(participantId)]: partner.name },
                participantRoles: { [String(myId)]: me.role, [String(participantId)]: partner.role },
                lastMessage: '', lastMessageAt: new Date(), deletedFor: []
            });
        } else if (conv.deletedFor && conv.deletedFor.includes(myId)) {
            // Restore it for me if I try to start it again
            conv.deletedFor = conv.deletedFor.filter(id => id !== myId);
            await conv.save();
        }
        res.json({ conversation: conv });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/* ── GET /conversations/:id/messages ── */
router.get('/conversations/:id/messages', verifyUser, async (req: ChatRequest, res: Response) => {
    try {
        const conv = await Conversation.findById(req.params.id);
        if (!conv || !conv.participants.includes(req.user!.id))
            return res.status(404).json({ error: 'Not found.' });

        const query: any = { conversationId: req.params.id, deletedFor: { $ne: req.user!.id } };
        if (req.query.before) query.createdAt = { $lt: new Date(req.query.before as string) };

        const msgs = await Message.find(query).sort({ createdAt: -1 })
            .limit(Math.min(parseInt(String(req.query.limit || '50'), 10), 100)).lean();

        await Message.updateMany(
            { conversationId: req.params.id, senderId: { $ne: req.user!.id }, readBy: { $nin: [req.user!.id] } },
            { $addToSet: { readBy: req.user!.id } }
        );
        res.json({ messages: msgs.reverse() });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/* ── GET /users ── */
router.get('/users', verifyUser, async (req: ChatRequest, res: Response) => {
    try {
        const roleFilter = req.user!.role === 'STUDENT' ? "AND role IN ('TEACHER','ADMIN')" : '';
        const r = await pgPool.query(
            `SELECT id, name, role FROM users WHERE school_id = $1 AND id != $2 ${roleFilter} ORDER BY role, name LIMIT 100`,
            [req.user!.schoolId, req.user!.id]
        );
        res.json({ users: r.rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/* ── POST /upload ── */
router.post('/upload', verifyUser, (req: ChatRequest, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: any) => {
        if (err) {
            console.error('Upload Error:', err);
            return res.status(500).json({ error: 'Storage error: ' + err.message });
        }
        next();
    });
}, async (req: ChatRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    
    // Cloudinary puts the full URL in req.file.path. Local storage puts filename in req.file.filename.
    const fileUrl = process.env.CLOUDINARY_CLOUD_NAME ? req.file.path : req.file.filename;

    res.json({
        filename: fileUrl,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
    });
});

export default router;
