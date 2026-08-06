const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const yts = require('yt-search');
const logEvent = require('./logger');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const roomQueues = {};

io.on('connection', (socket) => {
  logEvent('CONNECT', { socketId: socket.id });

  socket.on('joinRoom', (roomCode) => {
    if (!roomCode) return;
    socket.join(roomCode);
    socket.roomCode = roomCode;

    if (!roomQueues[roomCode]) {
      roomQueues[roomCode] = [];
    }

    logEvent('ROOM_JOIN', { socketId: socket.id, roomCode });
    socket.emit('updateQueue', roomQueues[roomCode]);
  });

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

  socket.on('addSong', async (data) => {
    const room = socket.roomCode || data.room;
    const videoId = data.input || data.id;
    let songTitle = data.title;

    if (!room || !videoId) return;

    if (!songTitle || songTitle.startsWith('Song (') || songTitle === videoId) {
      try {
        const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        if (response.ok) {
          const info = await response.json();
          songTitle = info.title;
        }
      } catch (err) {
        songTitle = `Song (${videoId})`;
      }
    }

    const newSong = {
      id: videoId,
      title: songTitle || `Song (${videoId})`,
      user: data.userName || data.user || 'Guest'
    };

    if (!roomQueues[room]) roomQueues[room] = [];
    roomQueues[room].push(newSong);

    logEvent('SONG_QUEUED', { room, title: newSong.title, user: newSong.user });
    io.to(room).emit('updateQueue', roomQueues[room]);
  });

  socket.on('nextSong', () => {
    const room = socket.roomCode;
    if (room && roomQueues[room] && roomQueues[room].length > 0) {
      const finishedSong = roomQueues[room].shift();
      logEvent('SONG_FINISHED', { room, title: finishedSong.title });
      io.to(room).emit('updateQueue', roomQueues[room]);
    }
  });

  socket.on('removeSong', (index) => {
    const room = socket.roomCode;
    if (room && roomQueues[room] && roomQueues[room][index]) {
      const removed = roomQueues[room].splice(index, 1);
      logEvent('SONG_REMOVED', { room, title: removed[0]?.title });
      io.to(room).emit('updateQueue', roomQueues[room]);
    }
  });

  socket.on('updateTicker', (data) => {
    const room = socket.roomCode || (typeof data === 'object' ? data.roomCode : null);
    const text = typeof data === 'object' ? data.text : data;
    if (room && text) {
      logEvent('TICKER_UPDATED', { room, text });
      io.to(room).emit('tickerUpdated', text);
    }
  });

  socket.on('playSound', (data) => {
    const room = socket.roomCode || (typeof data === 'object' ? data.roomCode : null);
    const sound = typeof data === 'object' ? data.sound : data;
    if (room && sound) {
      logEvent('SOUND_TRIGGERED', { room, sound });
      io.to(room).emit('playSound', sound);
    }
  });

  socket.on('sendEmoji', (data) => {
    const room = socket.roomCode || (typeof data === 'object' ? data.roomCode : null);
    const emoji = typeof data === 'object' ? data.emoji : data;
    if (room && emoji) {
      logEvent('EMOJI_TRIGGERED', { room, emoji });
      io.to(room).emit('triggerEmoji', emoji);
    }
  });

  socket.on('disconnect', () => {
    logEvent('DISCONNECT', { socketId: socket.id });
  });
});

server.listen(PORT, () => {
  logEvent('SYSTEM_START', { port: PORT, status: 'Server initialized and running' });
  console.log(`🎤 Mars KTV Server running on http://localhost:${PORT}`);
});