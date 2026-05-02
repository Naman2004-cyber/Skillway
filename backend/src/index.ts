import './env';
import express, { Express, Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import mongoose from 'mongoose';
import path from 'path';
import { Server } from 'socket.io';

// Import our newly created modules
import { initPostgres } from './db/pg';
import authRouter from './routes/auth';
import teacherRouter from './routes/teacher';
import studentRouter from './routes/student';
import chatbotRouter from './routes/chatbot';
import notificationsRouter from './routes/notifications';
import chatRouter from './routes/chat';
import { setupSocket } from './socket';

const app: Express = express();
const httpServer = http.createServer(app);
const port = process.env.PORT || 4000;

// Socket.IO
const io = new Server(httpServer, { cors: { origin: '*' } });
setupSocket(io);

// Middleware
app.use(cors());
app.use(express.json());

// Serve Static Frontend Pages
app.use(express.static(path.join(__dirname, '../../frontend/public')));

// Serve uploaded chat files
app.use('/uploads/chat', express.static(path.join(__dirname, '../uploads/chat')));

// Connect Routers
app.use('/api/auth', authRouter);
app.use('/api/teacher', teacherRouter);
app.use('/api/student', studentRouter);
app.use('/api/chatbot', chatbotRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/chat', chatRouter);

// Database Connection Manager
const connectDatabases = async () => {
    // 1. Init PostgreSQL
    await initPostgres();

    // 2. Init MongoDB
    if (process.env.MONGODB_URI) {
        try {
            await mongoose.connect(process.env.MONGODB_URI);
            console.log('✅ MongoDB connected successfully');
        } catch (error) {
            console.error('❌ MongoDB connection failed:', error);
        }
    } else {
        console.warn('⚠️ MONGODB_URI not provided. Skipping MongoDB connection temporarily.');
    }
};

// Basic Status Route
app.get('/api/status', (req: Request, res: Response) => {
    res.json({ status: 'Academic Progress Tracker API is running' });
});

// Start Server
httpServer.listen(port, async () => {
    console.log(`🚀 Server is running on port ${port}`);
    await connectDatabases();
});
