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

// Custom Styled Dashboard Status Route
app.get('/status', (req, res) => {
  const adapterRooms = io.sockets.adapter.rooms;
  const activeRooms = {};

  adapterRooms.forEach((sockets, roomName) => {
    if (roomName.startsWith('ROOM-')) {
      activeRooms[roomName] = sockets.size;
    }
  });

  const totalRooms = Object.keys(activeRooms).length;

  let roomsListHtml = '';
  if (totalRooms === 0) {
    roomsListHtml = `
      <div style="color: #64748b; margin-top: 15px;">No active rooms currently running</div>`;
  } else {
    for (const [roomCode, userCount] of Object.entries(activeRooms)) {
      roomsListHtml += `
        <div style="margin-top: 20px;">
          <div><span style="color: #38bdf8; font-weight: bold;">Room:</span> <span style="color: #38bdf8;">${roomCode}</span></div>
          <div><span style="color: #4ade80; font-weight: bold;">Users Connected:</span> <span style="color: #4ade80;">${userCount}</span></div>
        </div>`;
    }
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mars KTV Room Dashboard</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎙️</text></svg>">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: Tahoma, sans-serif; 
      font-size: 14px; 
      background-color: #080d19; 
      color: #ffffff; 
      padding: 30px; 
      line-height: 1.6;
    }
    .header-title { color: #ffffff; font-weight: bold; margin-bottom: 4px; }
    .clock-text { color: #ffffff; margin-bottom: 25px; }
    .active-count { color: #facc15; font-weight: bold; margin-bottom: 10px; }
  </style>
</head>
<body>

  <div class="header-title">Mars KTV Room Dashboard</div>
  <div id="liveClock" class="clock-text">-- | --</div>

  <div class="active-count">Total Active Rooms: ${totalRooms}</div>

  ${roomsListHtml}

  <script>
    function updateClock() {
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      document.getElementById('liveClock').textContent = dateStr + ' | ' + timeStr;
    }
    updateClock();
    setInterval(updateClock, 1000);

    // Auto-refresh room status data every 10 seconds
    setTimeout(() => {
      window.location.reload();
    }, 10000);
  </script>

</body>
</html>`;

  res.send(html);
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
  console.log(`KTV App live on port ${PORT}`);
});