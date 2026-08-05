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

// Multi-Mirror YouTube Search Function
async function searchYouTube(query) {
  const cleanQuery = encodeURIComponent(query.trim());
  
  // Provider 1: Piped API Primary Mirror
  try {
    const res = await fetch(`https://pipedapi.kavin.rocks/search?q=${cleanQuery}&filter=videos`);
    if (res.ok) {
      const data = await res.json();
      if (data.items && data.items.length > 0) {
        return data.items.slice(0, 5).map(v => ({
          id: v.url.split('v=')[1] || v.url.replace('/watch?v=', ''),
          title: v.title,
          thumbnail: v.thumbnail
        }));
      }
    }
  } catch (err) {
    console.warn('Primary Piped API failed, switching to backup 1...');
  }

  // Provider 2: Secondary Invidious Instance
  try {
    const res = await fetch(`https://inv.tux.im/api/v1/search?q=${cleanQuery}&type=video`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.slice(0, 5).map(v => ({
          id: v.videoId,
          title: v.title,
          thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
        }));
      }
    }
  } catch (err) {
    console.warn('Invidious tux.im failed, switching to backup 2...');
  }

  // Provider 3: Fallback Public Invidious Instance
  try {
    const res = await fetch(`https://invidious.nerdvpn.de/api/v1/search?q=${cleanQuery}&type=video`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.slice(0, 5).map(v => ({
          id: v.videoId,
          title: v.title,
          thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
        }));
      }
    }
  } catch (err) {
    console.error('All search mirrors failed:', err);
  }

  return [];
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

    // If only text was sent without a direct title or 11-char video ID
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