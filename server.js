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

// Clean Web Dashboard Status Route
app.get('/status', (req, res) => {
  const adapterRooms = io.sockets.adapter.rooms;
  const activeRooms = {};
  let totalUsers = 0;

  adapterRooms.forEach((sockets, roomName) => {
    if (roomName.startsWith('ROOM-')) {
      const userCount = sockets.size;
      activeRooms[roomName] = userCount;
      totalUsers += userCount;
    }
  });

  const totalRooms = Object.keys(activeRooms).length;

  let roomCardsHtml = '';
  if (totalRooms === 0) {
    roomCardsHtml = `
      <div style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 40px; background: #0f1a30; border-radius: 12px; border: 1px solid #1e293b;">
        No active KTV rooms currently running
      </div>`;
  } else {
    for (const [roomCode, userCount] of Object.entries(activeRooms)) {
      roomCardsHtml += `
        <div style="background: #0f1a30; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 0.75rem; color: #ec4899; font-weight: 800; letter-spacing: 1px;">ROOM CODE</div>
            <div style="font-size: 1.5rem; font-weight: 800; color: #ffffff; margin-top: 2px;">${roomCode}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.75rem; color: #64748b; font-weight: 700;">CONNECTED DEVICES</div>
            <div style="font-size: 1.25rem; font-weight: 800; color: #facc15; margin-top: 2px;">👥 ${userCount} ${userCount === 1 ? 'User' : 'Users'}</div>
          </div>
        </div>`;
    }
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mars KTV Dashboard</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎙️</text></svg>">
  <meta http-equiv="refresh" content="10">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #080d19; color: #fff; padding: 32px 24px; max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid #1a233a; padding-bottom: 16px; }
    .title { font-size: 1.4rem; font-weight: 800; }
    .subtitle { color: #64748b; font-size: 0.8rem; font-weight: 600; margin-top: 4px; }
    .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 28px; }
    .metric-card { background: #0f1a30; border: 1px solid #1e293b; padding: 20px; border-radius: 12px; }
    .metric-label { font-size: 0.75rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-value { font-size: 2.2rem; font-weight: 900; color: #38bdf8; margin-top: 4px; }
    .rooms-header { font-size: 0.85rem; font-weight: 800; color: #ec4899; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .rooms-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    .refresh-btn { background: #16233d; border: 1px solid #334155; color: #e2e8f0; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; text-decoration: none; font-size: 0.85rem; }
    .refresh-btn:hover { background: #1e293b; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">🎙️ Mars KTV Live Dashboard</div>
      <div class="subtitle">Auto-refreshes every 10 seconds</div>
    </div>
    <a href="/status" class="refresh-btn">🔄 Refresh</a>
  </div>

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">Active Rooms</div>
      <div class="metric-value">${totalRooms}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Connected Devices</div>
      <div class="metric-value" style="color: #facc15;">${totalUsers}</div>
    </div>
  </div>

  <div class="rooms-header">Active Rooms Breakdown</div>
  <div class="rooms-grid">
    ${roomCardsHtml}
  </div>
</body>
</html>`;

  res.send(html);
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
  console.log(`KTV App live on port ${PORT}`);
});