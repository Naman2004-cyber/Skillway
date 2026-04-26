import mongoose, { Schema, Document } from 'mongoose';

export interface IAnnouncement extends Document {
    schoolId: number;
    title: string;
    content: string;
    authorId: number;
    createdAt: Date;
}

const AnnouncementSchema: Schema = new Schema({
    schoolId: { type: Number, required: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    authorId: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IAnnouncement>('Announcement', AnnouncementSchema);
