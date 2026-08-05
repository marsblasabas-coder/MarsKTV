const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));

// Store queues per room: { "ROOM12": [song1, song2], "ROOM34": [] }
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
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query + " karaoke")}`);
    const html = await res.text();
    const dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/);
    if (!dataMatch) return [];

    const json = JSON.parse(dataMatch[1]);
    const contents = json.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents;

    const results = [];
    for (let item of contents) {
      if (item.videoRenderer && results.length < 5) {
        results.push({
          id: item.videoRenderer.videoId,
          title: item.videoRenderer.title.runs[0].text,
          thumbnail: item.videoRenderer.thumbnail.thumbnails[0].url
        });
      }
    }
    return results;
  } catch (err) {
    console.error("Search error:", err);
    return [];
  }
}

io.on('connection', (socket) => {

  // Socket joins a specific room
  socket.on('joinRoom', (roomCode) => {
    socket.join(roomCode);
    socket.roomCode = roomCode;

    // Initialize room queue if it doesn't exist
    if (!roomQueues[roomCode]) {
      roomQueues[roomCode] = [];
    }

    // Send current queue to the newly connected user
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

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
  console.log(`KTV App live on port ${PORT}`);
});