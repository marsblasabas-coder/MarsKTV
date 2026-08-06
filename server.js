const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
const yts = require('yt-search');

app.use(express.static('public'));

// Store queues per room
const roomQueues = {};

function extractVideoId(input) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = input.match(regExp);
  return (match && match[2].length === 11) ? match[2] : input.trim();
}

async function fetchVideoTitle(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!response.ok) throw new Error('Failed to fetch');
    const data = await response.json();
    return data.title;
  } catch (error) {
    return `Song (${videoId})`;
  }
}

async function searchYouTube(query) {
  try {
    const searchResults = await yts(query + " karaoke");
    return searchResults.videos.slice(0, 8).map((video) => ({
      id: video.videoId,
      title: video.title,
      thumbnail: video.thumbnail
    }));
  } catch (err) {
    console.error("Search error:", err);
    return [];
  }
}

io.on('connection', (socket) => {

  socket.on('joinRoom', (roomCode) => {
    socket.join(roomCode);
    socket.roomCode = roomCode;

    if (!roomQueues[roomCode]) {
      roomQueues[roomCode] = [];
    }

    socket.emit('updateQueue', roomQueues[roomCode]);
  });

  socket.on('searchSong', async (query) => {
    const results = await searchYouTube(query);
    socket.emit('searchResults', results);
  });

  socket.on('addSong', async (data) => {
    const roomCode = socket.roomCode;
    if (!roomCode || !roomQueues[roomCode]) return;

    const videoId = extractVideoId(data.input);
    const title = await fetchVideoTitle(videoId);
    const userName = data.userName || 'Guest';

    roomQueues[roomCode].push({ id: videoId, title: title, user: userName });
    io.to(roomCode).emit('updateQueue', roomQueues[roomCode]);
  });

  socket.on('nextSong', () => {
    const roomCode = socket.roomCode;
    if (roomCode && roomQueues[roomCode]) {
      roomQueues[roomCode].shift();
      io.to(roomCode).emit('updateQueue', roomQueues[roomCode]);
    }
  });

  socket.on('removeSong', (index) => {
    const roomCode = socket.roomCode;
    if (roomCode && roomQueues[roomCode] && index >= 0 && index < roomQueues[roomCode].length) {
      roomQueues[roomCode].splice(index, 1);
      io.to(roomCode).emit('updateQueue', roomQueues[roomCode]);
    }
  });

  socket.on('reorderQueue', ({ fromIndex, toIndex }) => {
    const roomCode = socket.roomCode;
    if (roomCode && roomQueues[roomCode]) {
      const q = roomQueues[roomCode];
      if (fromIndex >= 1 && toIndex >= 1 && fromIndex < q.length && toIndex < q.length) {
        const [movedItem] = q.splice(fromIndex, 1);
        q.splice(toIndex, 0, movedItem);
        io.to(roomCode).emit('updateQueue', q);
      }
    }
  });

  socket.on('playSound', (soundName) => {
    if (socket.roomCode) {
      io.to(socket.roomCode).emit('triggerSound', soundName);
    }
  });

  socket.on('setVolume', (volumeLevel) => {
    if (socket.roomCode) {
      io.to(socket.roomCode).emit('updateVolume', volumeLevel);
    }
  });
});

// Admin status route to inspect active KTV rooms and user counts
app.get('/status', (req, res) => {
  const adapterRooms = io.sockets.adapter.rooms;
  const activeRooms = {};

  adapterRooms.forEach((sockets, roomName) => {
    // Filter out individual socket connection IDs, tracking only ROOM- codes
    if (roomName.startsWith('ROOM-')) {
      activeRooms[roomName] = {
        usersConnected: sockets.size
      };
    }
  });

  res.json({
    totalActiveRooms: Object.keys(activeRooms).length,
    rooms: activeRooms
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
  console.log(`KTV App live on port ${PORT}`);
});