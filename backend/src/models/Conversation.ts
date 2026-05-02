import mongoose, { Schema, Document } from 'mongoose';

export interface IConversation extends Document {
    schoolId: number;
    participants: number[];          // PostgreSQL user IDs
    participantNames: Record<string, string>;  // { "userId": "Name" }
    participantRoles: Record<string, string>;  // { "userId": "TEACHER" | "STUDENT" }
    lastMessage: string;
    lastMessageAt: Date;
    deletedFor: number[];
    createdAt: Date;
}

const ConversationSchema: Schema = new Schema({
    schoolId: { type: Number, required: true, index: true },
    participants: { type: [Number], required: true, index: true },
    participantNames: { type: Schema.Types.Mixed, default: {} },
    participantRoles: { type: Schema.Types.Mixed, default: {} },
    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now },
    deletedFor: { type: [Number], default: [] },
    createdAt: { type: Date, default: Date.now }
});

// Index for quick lookup of conversations by participant
ConversationSchema.index({ participants: 1, schoolId: 1 });

export default mongoose.model<IConversation>('Conversation', ConversationSchema);
