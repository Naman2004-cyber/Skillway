import mongoose, { Schema, Document } from 'mongoose';

export interface IVideoLibrary extends Document {
    courseId: number;
    title: string;
    embedUrl: string;
    description: string;
    chapters: Array<{ time: string; title: string }>;
    createdAt: Date;
}

const VideoLibrarySchema: Schema = new Schema({
    courseId: { type: Number, required: true }, // Links to PostgreSQL course.id
    title: { type: String, required: true },
    embedUrl: { type: String, required: true },
    description: { type: String },
    chapters: [{
        time: { type: String, required: true },
        title: { type: String, required: true }
    }],
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IVideoLibrary>('VideoLibrary', VideoLibrarySchema);
