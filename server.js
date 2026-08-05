const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const yts = require('yt-search');

app.use(express.static('public'));

// Store state per room
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
    currentRoom = roomCode;
    socket.join(roomCode);
    const room = getRoom(currentRoom);
    io.to(currentRoom).emit('updateQueue', room.queue);
  });

  socket.on('searchSong', async (query) => {
    try {
      const r = await yts(query);
      const videos = r.videos.slice(0, 5).map(v => ({
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

    if (!data.input.includes('http') && data.input.length !== 11) {
      const r = await yts(data.input);
      if (r.videos.length > 0) {
        songId = r.videos[0].videoId;
        songTitle = r.videos[0].title;
      }
    } else {
      const r = await yts({ videoId: data.input });
      if (r) songTitle = r.title;
    }

    room.queue.push({ id: songId, title: songTitle, user: data.userName });
    io.to(currentRoom).emit('updateQueue', room.queue);
  });

  /* Playback Control Handlers */
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
      const finishedSong = room.queue.shift();
      room.playedHistory.push(finishedSong);
      io.to(currentRoom).emit('updateQueue', room.queue);
    }
  });

  socket.on('prevSong', () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (room.playedHistory.length > 0) {
      const previousSong = room.playedHistory.pop();
      room.queue.unshift(previousSong); // Put previous song back at the top of the queue
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