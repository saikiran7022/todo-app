const express = require('express');
const http = require('http');
const path = require('path');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/lists', require('./routes/lists'));
app.use('/api/tasks', require('./routes/tasks'));

// Catch-all → SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

require('./realtime').setup(server);

db.ready().then(() => {
  server.listen(PORT, () => {
    console.log(`Together running at http://localhost:${PORT}`);
  });
});

module.exports = { app, server };
