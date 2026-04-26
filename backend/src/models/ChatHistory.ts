import mongoose, { Schema, Document } from 'mongoose';

export interface IChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export interface IChatHistory extends Document {
    userId: number;
    messages: IChatMessage[];
    createdAt: Date;
}

const ChatMessageSchema = new Schema({
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const ChatHistorySchema: Schema = new Schema({
    userId: { type: Number, required: true }, // Links to PostgreSQL users.id
    messages: [ChatMessageSchema],
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IChatHistory>('ChatHistory', ChatHistorySchema);
