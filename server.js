const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

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

// Fast search helper using public Invidious instances
async function searchYouTube(query) {
  try {
    const res = await fetch(`https://inv.api.store/api/v1/search?q=${encodeURIComponent(query)}&type=video`);
    if (!res.ok) throw new Error('Search API request failed');
    const data = await res.json();
    return data.slice(0, 5).map(v => ({
      id: v.videoId,
      title: v.title,
      thumbnail: v.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
    }));
  } catch (err) {
    // Fallback instance if primary is busy
    try {
      const fallbackRes = await fetch(`https://vid.puffyan.us/api/v1/search?q=${encodeURIComponent(query)}&type=video`);
      const fallbackData = await fallbackRes.json();
      return fallbackData.slice(0, 5).map(v => ({
        id: v.videoId,
        title: v.title,
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
      }));
    } catch (fallbackErr) {
      console.error('All search mirrors failed:', fallbackErr);
      return [];
    }
  }
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
    if (!query || !query.trim()) return socket.emit('searchResults', []);
    const results = await searchYouTube(query);
    socket.emit('searchResults', results);
  });

  socket.on('addSong', async (data) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    
    let songId = data.input;
    let songTitle = data.title || "Unknown Song";

    // If only query text was provided without title
    if (!data.title && typeof data.input === 'string' && data.input.length !== 11) {
      const results = await searchYouTube(data.input);
      if (results.length > 0) {
        songId = results[0].id;
        songTitle = results[0].title;
      }
    }

    room.queue.push({
      id: songId,
      title: songTitle,
      user: data.userName || 'Guest'
    });

    // Instantly sync room queue across monitor and remotes
    io.to(currentRoom).emit('updateQueue', room.queue);
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