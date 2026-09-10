const express = require('express');
const path = require('path');
const { attachChessServer } = require('./chess-server');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Time & Age Calculator running on port ${PORT}`);
});

attachChessServer(server);
