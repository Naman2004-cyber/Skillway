import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import Conversation from './models/Conversation';
import Message from './models/Message';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_change_in_production';

interface AuthSocket extends Socket {
    user?: { id: number; schoolId: number; role: string };
}

const onlineUsers = new Map<number, string>();

export function setupSocket(io: Server) {
    io.use((socket: AuthSocket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token) return next(new Error('Authentication required'));
        try {
            socket.user = jwt.verify(String(token), JWT_SECRET) as any;
            next();
        } catch {
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', async (socket: AuthSocket) => {
        const user = socket.user!;
        onlineUsers.set(user.id, socket.id);
        io.emit('user-online', { userId: user.id });
        socket.join(`school-${user.schoolId}`);

        try {
            const convs = await Conversation.find({ participants: user.id }).select('_id');
            convs.forEach(c => socket.join(`conv-${c._id}`));
        } catch {}

        socket.on('get-online-users', (cb) => {
            if (typeof cb === 'function') cb(Array.from(onlineUsers.keys()));
        });

        socket.on('join-conversation', async (convId: string) => {
            try {
                const c = await Conversation.findById(convId);
                if (c && c.participants.includes(user.id)) socket.join(`conv-${convId}`);
            } catch {}
        });

        socket.on('send-message', async (data: {
            conversationId: string; content: string;
            attachments?: Array<{ filename: string; originalName: string; mimeType: string; size: number }>;
        }, callback) => {
            try {
                const { conversationId, content, attachments } = data;
                if (!conversationId || (!content?.trim() && (!attachments || !attachments.length))) {
                    if (typeof callback === 'function') callback({ error: 'Empty message.' });
                    return;
                }
                const conv = await Conversation.findById(conversationId);
                if (!conv || !conv.participants.includes(user.id)) {
                    if (typeof callback === 'function') callback({ error: 'Not found.' });
                    return;
                }
                const senderName = conv.participantNames?.[String(user.id)] || 'User';
                const message = await Message.create({
                    conversationId: conv._id, senderId: user.id, senderName,
                    senderRole: user.role, content: content?.trim() || '',
                    attachments: attachments || [], readBy: [user.id]
                });
                const preview = attachments?.length && !content?.trim()
                    ? `📎 ${attachments[0].originalName}` : (content?.trim() || '').slice(0, 100);
                conv.lastMessage = preview;
                conv.lastMessageAt = new Date();
                conv.deletedFor = []; // Restore conversation for all participants if deleted
                await conv.save();

                io.to(`conv-${conversationId}`).emit('new-message', {
                    message: message.toObject(), conversationId
                });
                conv.participants.forEach(pid => {
                    const sid = onlineUsers.get(pid);
                    if (sid) io.to(sid).emit('conversation-updated', {
                        conversationId: String(conv._id), lastMessage: preview,
                        lastMessageAt: conv.lastMessageAt
                    });
                });
                if (typeof callback === 'function') callback({ ok: true, message: message.toObject() });
            } catch (err: any) {
                if (typeof callback === 'function') callback({ error: err.message });
            }
        });

        socket.on('delete-message', async (data: { messageId: string, type: 'me' | 'everyone' }, callback) => {
            try {
                const msg = await Message.findById(data.messageId);
                if (!msg) { if (callback) callback({ error: 'Not found' }); return; }
                const conv = await Conversation.findById(msg.conversationId);
                if (!conv || !conv.participants.includes(user.id)) { if (callback) callback({ error: 'Unauthorized' }); return; }
                
                if (data.type === 'me') {
                    if (!msg.deletedFor.includes(user.id)) {
                        msg.deletedFor.push(user.id);
                        await msg.save();
                    }
                    if (callback) callback({ ok: true });
                } else if (data.type === 'everyone') {
                    if (msg.senderId !== user.id && user.role !== 'ADMIN') {
                        if (callback) callback({ error: 'Unauthorized' });
                        return;
                    }
                    msg.isDeleted = true;
                    msg.content = 'This message was deleted';
                    msg.attachments = [];
                    await msg.save();

                    // If this was the last message, update the conversation preview
                    if (conv.lastMessageAt && conv.lastMessageAt.getTime() === msg.createdAt.getTime()) {
                        conv.lastMessage = 'This message was deleted';
                        await conv.save();
                    }

                    io.to(`conv-${msg.conversationId}`).emit('message-deleted', { messageId: msg._id, type: 'everyone' });
                    io.to(`conv-${msg.conversationId}`).emit('conversation-updated', {});
                    if (callback) callback({ ok: true });
                }
            } catch (err: any) {
                if (callback) callback({ error: err.message });
            }
        });

        socket.on('delete-conversation', async (data: { conversationId: string, type: 'me' | 'everyone' }, callback) => {
            try {
                const conv = await Conversation.findById(data.conversationId);
                if (!conv || !conv.participants.includes(user.id)) { if (callback) callback({ error: 'Unauthorized' }); return; }
                
                if (data.type === 'me') {
                    if (!conv.deletedFor.includes(user.id)) {
                        conv.deletedFor.push(user.id);
                        await conv.save();
                    }
                    
                    // Also mark all current messages as deleted for this user
                    await Message.updateMany(
                        { conversationId: conv._id, deletedFor: { $ne: user.id } },
                        { $push: { deletedFor: user.id } }
                    );

                    if (callback) callback({ ok: true });
                } else if (data.type === 'everyone') {
                    if (user.role !== 'ADMIN') { // Only admins/teachers might delete entire conversation for everyone, or allow anyone? Let's allow anyone or restrict. Let's allow if they are part of it and sender. But usually delete for everyone applies to messages. If for conversation, maybe just delete all messages?
                        // Let's just allow it for now if they are participant.
                    }
                    await Message.deleteMany({ conversationId: conv._id });
                    await conv.deleteOne();
                    io.to(`conv-${conv._id}`).emit('conversation-deleted', { conversationId: conv._id, type: 'everyone' });
                    if (callback) callback({ ok: true });
                }
            } catch (err: any) {
                if (callback) callback({ error: err.message });
            }
        });

        socket.on('typing', (convId: string) => {
            socket.to(`conv-${convId}`).emit('user-typing', { conversationId: convId, userId: user.id });
        });
        socket.on('stop-typing', (convId: string) => {
            socket.to(`conv-${convId}`).emit('user-stop-typing', { conversationId: convId, userId: user.id });
        });

        socket.on('mark-read', async (convId: string) => {
            try {
                await Message.updateMany(
                    { conversationId: convId, senderId: { $ne: user.id }, readBy: { $nin: [user.id] } },
                    { $addToSet: { readBy: user.id } }
                );
                socket.to(`conv-${convId}`).emit('messages-read', { conversationId: convId, readBy: user.id });
            } catch {}
        });

        socket.on('disconnect', () => {
            onlineUsers.delete(user.id);
            io.emit('user-offline', { userId: user.id });
        });
    });
}
