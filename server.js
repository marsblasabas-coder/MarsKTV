const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const yts = require('yt-search');

app.use(express.static('public'));

const rooms = {};

function getRoom(roomCode) {
  if (!rooms[roomCode]) {
    rooms[roomCode] = {
      queue: [],
      playedHistory: []
    };
  }
  return rooms[roomCode];
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('joinRoom', (roomCode) => {
    if (!roomCode) return;
    currentRoom = roomCode.trim().toUpperCase();
    socket.join(currentRoom);
    const room = getRoom(currentRoom);
    io.to(currentRoom).emit('updateQueue', room.queue);
  });

  socket.on('searchSong', async (query) => {
    try {
      const r = await yts(query);
      const videos = (r.videos || []).slice(0, 5).map(v => ({
        id: v.videoId,
        title: v.title,
        thumbnail: v.thumbnail
      }));
      socket.emit('searchResults', videos);
    } catch (err) {
      socket.emit('searchResults', []);
    }
  });

  socket.on('addSong', async (data) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    let songId = data.input;
    let songTitle = "Unknown Song";

    try {
      if (typeof data.input === 'string' && data.input.length === 11) {
        const video = await yts({ videoId: data.input });
        if (video) songTitle = video.title;
      } else {
        const r = await yts(data.input);
        if (r && r.videos && r.videos.length > 0) {
          songId = r.videos[0].videoId;
          songTitle = r.videos[0].title;
        }
      }

      room.queue.push({
        id: songId,
        title: songTitle,
        user: data.userName || 'Guest'
      });

      io.to(currentRoom).emit('updateQueue', room.queue);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('playSong', () => {
    if (currentRoom) io.to(currentRoom).emit('playerPlay');
  });

  socket.on('pauseSong', () => {
    if (currentRoom) io.to(currentRoom).emit('playerPause');
  });

  socket.on('nextSong', () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (room.queue.length > 0) {
      const finished = room.queue.shift();
      room.playedHistory.push(finished);
      io.to(currentRoom).emit('updateQueue', room.queue);
    }
  });

  socket.on('prevSong', () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (room.playedHistory.length > 0) {
      const prev = room.playedHistory.pop();
      room.queue.unshift(prev);
      io.to(currentRoom).emit('updateQueue', room.queue);
    }
  });

  socket.on('removeSong', (index) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (index >= 0 && index < room.queue.length) {
      room.queue.splice(index, 1);
      io.to(currentRoom).emit('updateQueue', room.queue);
    }
  });

  socket.on('reorderQueue', ({ fromIndex, toIndex }) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (fromIndex >= 0 && fromIndex < room.queue.length && toIndex >= 0 && toIndex < room.queue.length) {
      const [movedItem] = room.queue.splice(fromIndex, 1);
      room.queue.splice(toIndex, 0, movedItem);
      io.to(currentRoom).emit('updateQueue', room.queue);
    }
  });

  socket.on('playSound', (sound) => {
    if (currentRoom) io.to(currentRoom).emit('triggerSound', sound);
  });

  socket.on('setVolume', (vol) => {
    if (currentRoom) io.to(currentRoom).emit('updateVolume', vol);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));