# ✅ Todo App

A simple full-stack Todo List app built with Node.js + Express.

## Features

- ➕ Add todos
- ✅ Mark as complete/incomplete
- 🗑️ Delete todos
- 🔍 Filter: All / Active / Completed
- 🧹 Clear all completed at once

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/todos | Get all todos |
| POST | /api/todos | Create a todo `{ "text": "..." }` |
| PATCH | /api/todos/:id | Update a todo `{ "completed": true }` |
| DELETE | /api/todos/:id | Delete a todo |
