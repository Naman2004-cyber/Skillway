import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

export const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/academic_tracker',
});

export const initPostgres = async () => {
    try {
        await pgPool.query('SELECT NOW()');
        const initSqlPath = fs.existsSync(path.join(__dirname, 'init.sql'))
            ? path.join(__dirname, 'init.sql')
            : path.resolve(__dirname, '../../src/db/init.sql');
        const initSql = fs.readFileSync(initSqlPath).toString();
        await pgPool.query(initSql);
        // Safety migration: ensure timetable table exists even when dist init.sql is stale.
        await pgPool.query(`
            CREATE TABLE IF NOT EXISTS school_timetable (
                id SERIAL PRIMARY KEY,
                school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
                day_of_week VARCHAR(10) NOT NULL CHECK (day_of_week IN ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY')),
                subject VARCHAR(255) NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                room VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CHECK (start_time < end_time)
            );
            CREATE INDEX IF NOT EXISTS school_timetable_school_day_time_idx
                ON school_timetable (school_id, day_of_week, start_time);
        `);
        await pgPool.query(`
            ALTER TABLE courses
            ADD COLUMN IF NOT EXISTS youtube_playlist_id VARCHAR(64);
            ALTER TABLE courses
            ADD COLUMN IF NOT EXISTS playlist_video_count INTEGER;
            CREATE TABLE IF NOT EXISTS student_course_progress (
                id SERIAL PRIMARY KEY,
                student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
                completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (student_id, course_id)
            );
            CREATE INDEX IF NOT EXISTS student_course_progress_student_idx
                ON student_course_progress (student_id);
            CREATE INDEX IF NOT EXISTS student_course_progress_course_idx
                ON student_course_progress (course_id);
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                type VARCHAR(50) DEFAULT 'GENERAL',
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id);
            CREATE TABLE IF NOT EXISTS activity_logs (
                id SERIAL PRIMARY KEY,
                school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                activity_name VARCHAR(255) NOT NULL,
                activity_type VARCHAR(100) NOT NULL,
                activity_date DATE NOT NULL,
                achievement VARCHAR(255),
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS activity_logs_school_created_idx
                ON activity_logs (school_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS activity_logs_student_date_idx
                ON activity_logs (student_id, activity_date DESC);
        `);
        console.log('✅ PostgreSQL connected successfully & schema initialized');
    } catch (err) {
        console.error('❌ PostgreSQL Initialization failed:', err);
    }
};
