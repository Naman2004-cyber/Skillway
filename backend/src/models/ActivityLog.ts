import mongoose, { Schema, Document } from 'mongoose';

export interface IActivityLog extends Document {
    schoolId: number;
    userId: number;
    action: string;
    description: string;
    createdAt: Date;
}

const ActivityLogSchema: Schema = new Schema({
    schoolId: { type: Number, required: true },
    userId: { type: Number, required: true },
    action: { type: String, required: true },
    description: { type: String },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IActivityLog>('ActivityLog', ActivityLogSchema);
