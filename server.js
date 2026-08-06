const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const yts = require('yt-search');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// In-memory queue state per room: { 'ROOM-1234': [ { id, title, user } ] }
const rooms = {};

io.on('connection', (socket) => {
  // Join KTV Room
  socket.on('joinRoom', (roomCode) => {
    socket.join(roomCode);
    socket.roomCode = roomCode;
    if (!rooms[roomCode]) {
      rooms[roomCode] = [];
    }
    socket.emit('updateQueue', rooms[roomCode]);
  });

  // YouTube Song Search
  socket.on('searchSong', async (query) => {
    try {
      const searchResult = await yts(query);
      const videos = searchResult.videos.slice(0, 10).map(v => ({
        id: v.videoId,
        title: v.title,
        thumbnail: v.thumbnail
      }));
      socket.emit('searchResults', videos);
    } catch (err) {
      console.error('YouTube Search Error:', err);
      socket.emit('searchResults', []);
    }
  });

  // Add Song to Queue
  socket.on('addSong', async (data) => {
    const room = socket.roomCode;
    if (!room) return;

    const videoId = data.input;
    let songTitle = 'Requested Song';

    try {
      const videoInfo = await yts({ videoId: videoId });
      if (videoInfo && videoInfo.title) {
        songTitle = videoInfo.title;
      }
    } catch (e) {
      songTitle = `Song (${videoId})`;
    }

    const song = {
      id: videoId,
      title: songTitle,
      user: data.userName || 'Guest'
    };

    rooms[room].push(song);
    io.to(room).emit('updateQueue', rooms[room]);
  });

  // Play Next Song / Skip
  socket.on('nextSong', () => {
    const room = socket.roomCode;
    if (room && rooms[room] && rooms[room].length > 0) {
      rooms[room].shift();
      io.to(room).emit('updateQueue', rooms[room]);
    }
  });

  // Remove Specific Song from Queue
  socket.on('removeSong', (index) => {
    const room = socket.roomCode;
    if (room && rooms[room] && rooms[room][index]) {
      rooms[room].splice(index, 1);
      io.to(room).emit('updateQueue', rooms[room]);
    }
  });

  // Broadcast Marquee Ticker Text Update
  socket.on('updateTicker', (data) => {
    const room = socket.roomCode || (typeof data === 'object' ? data.roomCode : null);
    const text = typeof data === 'object' ? data.text : data;
    if (room && text) {
      io.to(room).emit('tickerUpdated', text);
    }
  });

  // Relay Sound Effects
  socket.on('playSound', (data) => {
    const room = socket.roomCode || (typeof data === 'object' ? data.roomCode : null);
    const sound = typeof data === 'object' ? data.sound : data;
    if (room && sound) {
      io.to(room).emit('playSound', sound);
    }
  });

  // Relay Floating Emojis
  socket.on('sendEmoji', (data) => {
    const room = socket.roomCode || (typeof data === 'object' ? data.roomCode : null);
    const emoji = typeof data === 'object' ? data.emoji : data;
    if (room && emoji) {
      io.to(room).emit('triggerEmoji', emoji);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎙️ Mars KTV Server running on port ${PORT}`);
});