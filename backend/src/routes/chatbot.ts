import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import ChatHistory from '../models/ChatHistory';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_change_in_production';

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

const COUNSELOR_SYSTEM = `You are the Skillway Tracker AI counselor: warm, concise, and appropriate for secondary or university students.
You help with study habits, time management, stress, course choices, and general career curiosity — not therapy or crisis care.
If a student seems in crisis, urge them to talk to a trusted adult or school counselor immediately.
Format every answer for chat readability:
- Start with a 1-line direct answer.
- Then use short bullet points (3-7 bullets), each ideally one sentence.
- Use mini sections only when useful (e.g., "Try this today", "Next 7 days").
- Prefer numbered steps for action plans.
- Keep paragraphs very short (1-2 lines), never one long wall of text.
- Ask one follow-up question at the end when it helps personalize guidance.
Keep answers focused and under about 180 words unless they ask for detail.`;

interface ChatReq extends Request {
    user?: { id: number; schoolId: number; role: string };
}

const verifyStudentForChat = (req: ChatReq, res: Response, next: NextFunction) => {
    const raw = req.get('Authorization');
    const token = raw?.startsWith('Bearer ') ? raw.slice(7) : raw?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { id: number; schoolId: number; role: string };
        if (decoded.role !== 'STUDENT') {
            return res.status(403).json({ error: 'Student counselor is for student accounts.' });
        }
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

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
            max_tokens: 1024,
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

router.post('/discuss', verifyStudentForChat, async (req: ChatReq, res: Response) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    if (!process.env.GROQ_API_KEY?.trim()) {
        return res.status(503).json({
            error: 'AI counselor is not configured. Add GROQ_API_KEY to your server .env and restart.',
        });
    }

    let history = null;
    try {
        history = await ChatHistory.findOne({ userId: req.user!.id });
        if (!history) {
            history = new ChatHistory({ userId: req.user!.id, messages: [] });
        }
    } catch {
        history = null;
    }

    const prior: GroqMsg[] = [{ role: 'system', content: COUNSELOR_SYSTEM }];

    if (history?.messages?.length) {
        const recent = history.messages.slice(-24);
        for (const m of recent) {
            if (m.role === 'user' || m.role === 'assistant') {
                prior.push({ role: m.role, content: String(m.content || '').slice(0, 8000) });
            }
        }
    }

    prior.push({ role: 'user', content: message.slice(0, 12000) });

    let aiResponse: string;
    try {
        aiResponse = await callGroq(prior);
    } catch (e: any) {
        const errMsg = e?.message || String(e);
        if (errMsg === 'GROQ_API_KEY_MISSING') {
            return res.status(503).json({ error: 'GROQ_API_KEY is not set.' });
        }
        return res.status(502).json({ error: 'Groq: ' + errMsg });
    }

    try {
        if (history) {
            history.messages.push({ role: 'user', content: message, timestamp: new Date() });
            history.messages.push({ role: 'assistant', content: aiResponse, timestamp: new Date() });
            if (history.messages.length > 100) {
                history.messages = history.messages.slice(-100);
            }
            await history.save();
        }
    } catch {
        /* Mongo optional for reply delivery */
    }

    res.json({ reply: aiResponse });
});

export default router;
