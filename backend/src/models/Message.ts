import mongoose, { Schema, Document } from 'mongoose';

export interface IAttachment {
    filename: string;        // stored filename on disk
    originalName: string;    // user's original filename
    mimeType: string;
    size: number;            // bytes
}

export interface IMessage extends Document {
    conversationId: mongoose.Types.ObjectId;
    senderId: number;        // PostgreSQL user ID
    senderName: string;
    senderRole: string;      // 'TEACHER' | 'STUDENT'
    content: string;
    attachments: IAttachment[];
    readBy: number[];        // user IDs who have read this message
    deletedFor: number[];    // user IDs who have deleted this message for themselves
    isDeleted: boolean;      // true if deleted for everyone
    createdAt: Date;
}

const AttachmentSchema = new Schema({
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true }
}, { _id: false });

const MessageSchema: Schema = new Schema({
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    senderId: { type: Number, required: true },
    senderName: { type: String, required: true },
    senderRole: { type: String, enum: ['TEACHER', 'STUDENT', 'ADMIN'], required: true },
    content: { type: String, default: '' },
    attachments: { type: [AttachmentSchema], default: [] },
    readBy: { type: [Number], default: [] },
    deletedFor: { type: [Number], default: [] },
    isDeleted: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// Compound index for fetching messages in a conversation sorted by time
MessageSchema.index({ conversationId: 1, createdAt: 1 });

export default mongoose.model<IMessage>('Message', MessageSchema);
