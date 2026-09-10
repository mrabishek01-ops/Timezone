const { WebSocketServer } = require('ws');
const { Chess } = require('chess.js');

// Characters chosen to avoid visually ambiguous pairs (0/O, 1/I/L)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const MAX_GAME_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours

/** @type {Map<string, {
 *   code: string,
 *   chess: import('chess.js').Chess,
 *   white: import('ws').WebSocket | null,
 *   black: import('ws').WebSocket | null,
 *   status: 'waiting' | 'active' | 'over',
 *   createdAt: number
 * }>} */
const games = new Map();

function generateCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (games.has(code));
  return code;
}

function send(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function opponentOf(game, ws) {
  if (ws === game.white) return game.black;
  if (ws === game.black) return game.white;
  return null;
}

function colorOf(game, ws) {
  if (ws === game.white) return 'white';
  if (ws === game.black) return 'black';
  return null;
}

function gameOverPayload(game) {
  const chess = game.chess;
  if (!chess.isGameOver()) return null;
  if (chess.isCheckmate()) {
    const winner = chess.turn() === 'w' ? 'black' : 'white'; // side to move is the loser
    return { reason: 'checkmate', winner };
  }
  if (chess.isStalemate()) return { reason: 'stalemate', winner: null };
  if (chess.isThreefoldRepetition()) return { reason: 'threefold_repetition', winner: null };
  if (chess.isInsufficientMaterial()) return { reason: 'insufficient_material', winner: null };
  if (chess.isDraw()) return { reason: 'draw', winner: null };
  return { reason: 'game_over', winner: null };
}

function endGame(game, payload) {
  game.status = 'over';
  send(game.white, Object.assign({ type: 'game_over' }, payload));
  send(game.black, Object.assign({ type: 'game_over' }, payload));
}

function cleanupStaleGames() {
  const now = Date.now();
  for (const [code, game] of games.entries()) {
    if (now - game.createdAt > MAX_GAME_AGE_MS) games.delete(code);
  }
}

function attachChessServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/chess' });

  wss.on('connection', (ws) => {
    ws.gameCode = null;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(ws, { type: 'error', message: 'Malformed message.' });
      }

      switch (msg.type) {
        case 'create': {
          const code = generateCode();
          const game = {
            code,
            chess: new Chess(),
            white: ws,
            black: null,
            status: 'waiting',
            createdAt: Date.now()
          };
          games.set(code, game);
          ws.gameCode = code;
          send(ws, { type: 'created', code, color: 'white' });
          break;
        }

        case 'join': {
          const code = String(msg.code || '').toUpperCase().trim();
          const game = games.get(code);
          if (!game) return send(ws, { type: 'error', message: 'Game code not found.' });
          if (game.white === ws) return send(ws, { type: 'error', message: 'You cannot join your own game.' });
          if (game.black) return send(ws, { type: 'error', message: 'That game already has two players.' });

          game.black = ws;
          game.status = 'active';
          ws.gameCode = code;

          send(ws, { type: 'joined', code, color: 'black' });
          send(game.white, { type: 'opponent_joined' });

          const startPayload = { type: 'start', code, fen: game.chess.fen(), turn: 'white' };
          send(game.white, startPayload);
          send(game.black, startPayload);
          break;
        }

        case 'move': {
          const game = games.get(ws.gameCode);
          if (!game || game.status !== 'active') return send(ws, { type: 'error', message: 'No active game.' });

          const myColor = colorOf(game, ws);
          const turnColor = game.chess.turn() === 'w' ? 'white' : 'black';
          if (myColor !== turnColor) return send(ws, { type: 'error', message: 'Not your turn.' });

          let result;
          try {
            result = game.chess.move({ from: msg.from, to: msg.to, promotion: msg.promotion || 'q' });
          } catch (e) {
            result = null;
          }
          if (!result) return send(ws, { type: 'error', message: 'Illegal move.' });

          const movePayload = {
            type: 'move',
            from: result.from,
            to: result.to,
            promotion: result.promotion || null,
            san: result.san,
            fen: game.chess.fen(),
            turn: game.chess.turn() === 'w' ? 'white' : 'black',
            check: game.chess.inCheck()
          };
          send(game.white, movePayload);
          send(game.black, movePayload);

          const over = gameOverPayload(game);
          if (over) endGame(game, over);
          break;
        }

        case 'chat': {
          const game = games.get(ws.gameCode);
          if (!game) return;
          const color = colorOf(game, ws);
          if (!color) return;
          const text = String(msg.text || '').trim().slice(0, 300);
          if (!text) return;
          const payload = { type: 'chat', color, text, ts: Date.now() };
          send(game.white, payload);
          send(game.black, payload);
          break;
        }

        case 'resign': {
          const game = games.get(ws.gameCode);
          if (!game || game.status !== 'active') return;
          const myColor = colorOf(game, ws);
          const winner = myColor === 'white' ? 'black' : 'white';
          endGame(game, { reason: 'resignation', winner });
          break;
        }

        case 'legal_moves': {
          const game = games.get(ws.gameCode);
          if (!game || game.status !== 'active') return;
          let moves = [];
          try {
            moves = game.chess.moves({ square: msg.square, verbose: true }).map((m) => ({
              to: m.to,
              promotion: m.promotion || null,
              capture: !!m.captured
            }));
          } catch {
            moves = [];
          }
          send(ws, { type: 'legal_moves', square: msg.square, moves });
          break;
        }

        default:
          send(ws, { type: 'error', message: 'Unknown message type.' });
      }
    });

    ws.on('close', () => {
      const game = games.get(ws.gameCode);
      if (!game) return;
      if (game.status === 'active') {
        const opponent = opponentOf(game, ws);
        send(opponent, { type: 'opponent_left' });
        game.status = 'over';
      } else if (game.status === 'waiting' && game.white === ws) {
        games.delete(ws.gameCode);
      }
    });
  });

  setInterval(cleanupStaleGames, 30 * 60 * 1000);

  return wss;
}

module.exports = { attachChessServer };
