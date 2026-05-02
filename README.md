# 🚀 Skillway — Academic Progress Platform

[![Fullstack](https://img.shields.io/badge/Stack-Fullstack-blueviolet?style=for-the-badge)](https://github.com/Naman2004-cyber/Skillway)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)

**Skillway** is a premium, full-stack academic management platform designed to bridge the gap between teachers and students. It provides a unified ecosystem for tracking attendance, managing grades, logging extracurricular activities, and leveraging AI to generate assessments.

---

## ✨ Key Features

### 👨‍🏫 Teacher Portal
- **Real-Time Communication**: Integrated chat system to communicate instantly with students, complete with file sharing and granular message deletion.
- **AI Test Generator**: Build comprehensive MCQ tests in seconds using the integrated AI engine.
- **Activity Logging**: Record and manage student extracurricular activities, sports, and achievements.
- **Smart Gradebook**: Seamlessly track student performance across subjects with automated "falling behind" alerts.
- **Attendance Management**: Quick-mark attendance for today or manage historical records with a few clicks.
- **Course Publishing**: Share learning materials and YouTube playlists directly with your classes.

### 🎓 Student Portal
- **Real-Time Chat**: Stay connected with teachers, receive documents, and access historical conversations seamlessly.
- **Interactive Dashboard**: Get a 7-day momentum chart tracking your study habits and progress.
- **Learning Coach**: A private AI-powered chat partner for study tips, goal setting, and stress management.
- **Quiz Hub**: Take teacher-assigned tests and review performance results instantly.
- **Extracurricular Portfolio**: View your logged achievements and activity history in a professional layout.
- **Learning Plan**: Personalize your week with a built-in task manager and progress tracker.

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | HTML5, Vanilla CSS (Glassmorphism UI), JavaScript (ES6+), Socket.io Client |
| **Backend** | Node.js, Express.js, TypeScript, Socket.io |
| **Databases** | PostgreSQL (Relational Data), MongoDB (Unstructured Analytics & Chat Logs) |
| **Cloud Storage** | Cloudinary (Media CDN & File Hosting), Multer |
| **AI/ML** | Groq AI (Llama 3.1) for Test Generation & Coaching |
| **Auth** | JWT (JSON Web Tokens) with Bcrypt Hashing |

---

## 📂 Project Structure

```text
├── backend/                # Express & TypeScript server
│   ├── src/
│   │   ├── routes/         # API endpoints (Auth, Teacher, Student, AI)
│   │   ├── models/         # Database schemas
│   │   ├── db/             # PG & Mongo connection managers
│   │   └── index.ts        # Server entry point
│   └── .env                # Environment variables (DB URLs, AI Keys)
├── frontend/
│   └── public/             # Static web assets
│       ├── auth/           # Login & Signup pages
│       ├── teacher/        # Teacher portal dashboard
│       └── student/        # Student portal dashboard
└── README.md               # You are here!
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- PostgreSQL & MongoDB instances
- A [Groq API Key](https://console.groq.com/) (for AI features)
- A [Cloudinary Account](https://cloudinary.com/) (for chat file attachments)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Naman2004-cyber/Skillway.git
   cd Skillway
   ```

2. **Backend Setup:**
   ```bash
   cd backend
   npm install
   ```
   - Create a `.env` file in the `backend` folder and populate it with your database URIs and JWT secret.

3. **Run the Application:**
   ```bash
   # From the backend directory
   npm run dev
   ```
   - The server will start on `http://localhost:4000`.
   - The frontend is served automatically at the same address.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
*Developed with ❤️ by Naman*
