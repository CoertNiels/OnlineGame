const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Redirect root to login page
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Add path to dependencies
const path = require('path');

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
const db = new sqlite3.Database('users.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    // Create users table if it doesn't exist
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        userToken TEXT UNIQUE NOT NULL,
        isPlaying BOOLEAN DEFAULT FALSE
      )
    `);
  }
});

// API endpoints
app.post('/api/validateToken', express.json(), (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  db.get('SELECT username, userToken FROM users WHERE userToken = ?', 
    [token],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!user) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      res.json({
        userToken: user.userToken,
        username: user.username,
        success: true
      });
    }
  );
});

app.post('/api/login', express.json(), (req, res) => {  const { username } = req.body;
  
  if (!username || username.trim() === '') {
    return res.status(400).json({ error: 'Username is required' });
  }

  // Generate token
  const userToken = uuidv4();

  db.run('INSERT OR REPLACE INTO users (username, userToken, isPlaying) VALUES (?, ?, ?)', 
    [username, userToken, false],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Query the user data to ensure we have the correct token
      db.get('SELECT username, userToken FROM users WHERE username = ?', 
        [username],
        (err, user) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          
          // Send complete user data including token
          res.json({
            userToken: user.userToken,
            username: user.username,
            success: true
          });
        }
      );
    }
  );
});

// WebSocket handling
const games = new Map(); // gameId -> game object
const userConnections = new Map(); // userToken -> WebSocket

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    
    switch (data.type) {
      case 'login':
        handleLogin(ws, data.token);
        break;
      case 'invite':
        handleInvite(ws, data.inviteeToken);
        break;
      case 'acceptInvite':
        handleAcceptInvite(ws, data.gameId);
        break;
      case 'makeMove':
        handleMove(ws, data.gameId, data.position);
        break;
      case 'getOnlineUsers':
        handleGetOnlineUsers(ws);
        break;
      default:
        console.log('Unknown message type:', data.type);
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });
});

function handleLogin(ws, token) {
  db.get('SELECT username, userToken, isPlaying FROM users WHERE userToken = ?', 
    [token],
    (err, user) => {
      if (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Database error' }));
        return;
      }

      if (!user) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
        return;
      }

      userConnections.set(user.userToken, ws);
      ws.send(JSON.stringify({ type: 'loginSuccess', username: user.username }));
    }
  );
}

function handleGetOnlineUsers(ws) {
  db.all('SELECT username, userToken, isPlaying FROM users WHERE isPlaying = 0', 
    (err, users) => {
      if (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Database error' }));
        return;
      }

      // Filter out users without active connections
      const activeUsers = users.filter(user => userConnections.has(user.userToken));
      
      ws.send(JSON.stringify({
        type: 'onlineUsers',
        users: activeUsers.map(user => ({
          username: user.username,
          isPlaying: user.isPlaying
        }))
      }));
    }
  );
}

function handleInvite(ws, inviteeToken) {
  const inviterToken = getUserToken(ws);
  if (!inviterToken) return;

  const inviteeWs = userConnections.get(inviteeToken);
  if (!inviteeWs) return;

  const gameId = uuidv4();
  games.set(gameId, {
    gameId,
    players: [inviterToken, inviteeToken],
    board: Array(9).fill(null),
    turn: inviterToken,
    status: 'pending',
    winner: null
  });

  inviteeWs.send(JSON.stringify({ 
    type: 'invitation', 
    gameId, 
    inviter: getUserToken(ws) 
  }));
}

function handleAcceptInvite(ws, gameId) {
  const game = games.get(gameId);
  if (!game) return;

  const playerToken = getUserToken(ws);
  if (playerToken !== game.players[1]) return;

  game.status = 'ongoing';
  
  // Update database
  db.run('UPDATE users SET isPlaying = 1 WHERE userToken IN (?, ?)', 
    game.players, 
    (err) => {
      if (err) return;
      
      // Send initial game state to both players
      game.players.forEach(playerToken => {
        const ws = userConnections.get(playerToken);
        if (ws) {
          ws.send(JSON.stringify({
            type: 'gameStart',
            gameId,
            board: game.board,
            turn: game.turn
          }));
        }
      });
    }
  );
}

function handleMove(ws, gameId, position) {
  const game = games.get(gameId);
  if (!game) return;

  const playerToken = getUserToken(ws);
  if (playerToken !== game.turn) return;

  const index = position[0] * 3 + position[1];
  if (game.board[index] !== null) return;

  // Make move
  game.board[index] = playerToken === game.players[0] ? 'X' : 'O';
  
  // Check for win
  const winner = checkWinner(game.board);
  if (winner) {
    game.status = 'finished';
    game.winner = winner;
    
    // Update database
    db.run('UPDATE users SET isPlaying = 0 WHERE userToken IN (?, ?)', 
      game.players,
      (err) => {
        if (err) return;
        
        // Send game over to both players
        game.players.forEach(playerToken => {
          const ws = userConnections.get(playerToken);
          if (ws) {
            ws.send(JSON.stringify({
              type: 'gameOver',
              winner,
              board: game.board
            }));
          }
        });
      }
    );
  } else {
    // Switch turn
    game.turn = game.turn === game.players[0] ? game.players[1] : game.players[0];
    
    // Send updated state
    game.players.forEach(playerToken => {
      const ws = userConnections.get(playerToken);
      if (ws) {
        ws.send(JSON.stringify({
          type: 'moveResult',
          board: game.board,
          turn: game.turn
        }));
      }
    });
  }
}

function handleDisconnect(ws) {
  const token = getUserToken(ws);
  if (!token) return;

  userConnections.delete(token);
  
  // Update database
  db.run('UPDATE users SET isPlaying = 0 WHERE userToken = ?', [token]);
  
  // Notify other users
  db.all('SELECT username, userToken FROM users WHERE isPlaying = 0', (err, rows) => {
    if (err) return;
    
    rows.forEach(row => {
      const ws = userConnections.get(row.userToken);
      if (ws) {
        ws.send(JSON.stringify({ type: 'userList', users: rows }));
      }
    });
  });
}

function getUserToken(ws) {
  return Array.from(userConnections.entries())
    .find(([token, connection]) => connection === ws)?.[0];
}

function checkWinner(board) {
  const winningCombinations = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
    [0, 4, 8], [2, 4, 6] // Diagonals
  ];

  return winningCombinations.find(combination => {
    const [a, b, c] = combination;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  });
}

const PORT = 8080;
server.listen(PORT, '192.168.2.12', () => {
  console.log(`Server running at http://192.168.2.12:${PORT}`);
});
