import path from 'path';
import { config } from 'dotenv';

/** Load `.env` from project root before any other app modules read `process.env`. */
config({
    path: path.resolve(__dirname, '../.env'),
    // If Windows has an empty GROQ_API_KEY (etc.), defaults would block .env — project file wins.
    override: true,
});

if (!process.env.GROQ_API_KEY?.trim()) {
    console.warn('⚠️ GROQ_API_KEY is missing or empty — AI counselor will return 503 until set in .env');
}
