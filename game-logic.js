export const SIZE = 9;
export const TYPES = ['bua', 'keo', 'bao'];
export const TYPE_LABEL = { bua: 'Búa', keo: 'Kéo', bao: 'Bao' };
export const BEATS = { bua: 'keo', keo: 'bao', bao: 'bua' };
export const PLAYER_LABEL = { 1: 'Đỏ', 2: 'Xanh' };
export const GOALS = {
  1: { r: 0, c: 8, label: 'i9' },
  2: { r: 8, c: 0, label: 'a1' }
};

export function rowLabelOf(rowIndex) {
  return SIZE - rowIndex;
}

export function colLabelOf(colIndex) {
  return String.fromCharCode(97 + colIndex);
}

export function createInitialBoard() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const cycleA = ['bua', 'keo', 'bao'];
  const cycleB = ['keo', 'bao', 'bua'];

  for (let c = 0; c < SIZE; c++) {
    board[8][c] = { type: cycleA[c % 3], player: 1 };
    board[7][c] = { type: cycleB[c % 3], player: 1 };
    board[0][c] = { type: cycleA[c % 3], player: 2 };
    board[1][c] = { type: cycleB[c % 3], player: 2 };
  }

  return board;
}

export function countPieces(board) {
  const counts = {
    1: { bua: 0, keo: 0, bao: 0 },
    2: { bua: 0, keo: 0, bao: 0 }
  };

  for (const row of board) {
    for (const piece of row) {
      if (piece && counts[piece.player] && TYPES.includes(piece.type)) {
        counts[piece.player][piece.type]++;
      }
    }
  }

  return counts;
}

export function createInitialState(matchId = '') {
  const board = createInitialBoard();
  return {
    matchId,
    revision: 0,
    board,
    currentPlayer: 1,
    counts: countPieces(board),
    moveLog: [],
    gameOver: false,
    outcome: null
  };
}

export function cloneGameState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function inBounds(r, c) {
  return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

export function isGoalCell(r, c) {
  return Object.values(GOALS).some(goal => goal.r === r && goal.c === c);
}

export function moveOutcome(attacker, targetCell) {
  if (targetCell === null) return 'move';
  if (targetCell.player === attacker.player) return null;
  if (targetCell.type === attacker.type) return null;
  if (BEATS[attacker.type] === targetCell.type) return 'capture';
  return null;
}

export function computeLegalMoves(state, r, c, player = state.currentPlayer) {
  if (!inBounds(r, c)) return [];
  const piece = state.board[r][c];
  if (!piece || piece.player !== player) return [];

  const moves = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const type = moveOutcome(piece, state.board[nr][nc]);
      if (type) moves.push({ r: nr, c: nc, type });
    }
  }
  return moves;
}

export function checkWin(state, mover, toR, toC, capturedPiece) {
  const goal = GOALS[mover];
  if (goal.r === toR && goal.c === toC) {
    return { winner: mover, reason: 'goal', detail: goal.label };
  }

  if (capturedPiece && state.counts[capturedPiece.player][capturedPiece.type] === 0) {
    return { winner: mover, reason: 'elimination', detail: capturedPiece.type };
  }

  return null;
}

export function validateMove(state, player, from, to) {
  if (!state || state.gameOver) return { ok: false, error: 'Ván đấu đã kết thúc.' };
  if (player !== state.currentPlayer) return { ok: false, error: 'Chưa đến lượt của bạn.' };
  if (!from || !to || !inBounds(from.r, from.c) || !inBounds(to.r, to.c)) {
    return { ok: false, error: 'Tọa độ không hợp lệ.' };
  }

  const dr = Math.abs(to.r - from.r);
  const dc = Math.abs(to.c - from.c);
  if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) {
    return { ok: false, error: 'Mỗi quân chỉ được đi đúng một ô.' };
  }

  const piece = state.board[from.r][from.c];
  if (!piece) return { ok: false, error: 'Ô xuất phát không có quân.' };
  if (piece.player !== player) return { ok: false, error: 'Bạn không sở hữu quân này.' };

  const type = moveOutcome(piece, state.board[to.r][to.c]);
  if (!type) return { ok: false, error: 'Không thể đi vào ô đích này.' };
  return { ok: true, type };
}

export function applyMove(state, player, from, to) {
  const validation = validateMove(state, player, from, to);
  if (!validation.ok) return validation;

  const next = cloneGameState(state);
  const piece = next.board[from.r][from.c];
  const capturedPiece = next.board[to.r][to.c];
  next.board[to.r][to.c] = piece;
  next.board[from.r][from.c] = null;
  next.counts = countPieces(next.board);

  const fromLabel = colLabelOf(from.c) + rowLabelOf(from.r);
  const toLabel = colLabelOf(to.c) + rowLabelOf(to.r);
  let entry = `${PLAYER_LABEL[player]}: ${TYPE_LABEL[piece.type]} ${fromLabel}→${toLabel}`;
  if (validation.type === 'capture') entry += ` (ăn ${TYPE_LABEL[capturedPiece.type]})`;
  next.moveLog.push(entry);

  next.outcome = checkWin(next, player, to.r, to.c, capturedPiece);
  next.gameOver = Boolean(next.outcome);
  if (!next.gameOver) next.currentPlayer = player === 1 ? 2 : 1;
  next.revision = state.revision + 1;

  return { ok: true, state: next, moveType: validation.type };
}

function validPiece(piece) {
  return piece === null || (
    typeof piece === 'object' &&
    (piece.player === 1 || piece.player === 2) &&
    TYPES.includes(piece.type)
  );
}

export function isValidGameState(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.matchId !== 'string' || !Number.isInteger(value.revision) || value.revision < 0) return false;
  if (!Array.isArray(value.board) || value.board.length !== SIZE) return false;
  if (!value.board.every(row => Array.isArray(row) && row.length === SIZE && row.every(validPiece))) return false;
  if (value.currentPlayer !== 1 && value.currentPlayer !== 2) return false;
  if (!Array.isArray(value.moveLog) || !value.moveLog.every(entry => typeof entry === 'string')) return false;
  if (typeof value.gameOver !== 'boolean' || value.gameOver !== Boolean(value.outcome)) return false;

  const derivedCounts = countPieces(value.board);
  if (JSON.stringify(value.counts) !== JSON.stringify(derivedCounts)) return false;
  if ([1, 2].some(player => TYPES.some(type => derivedCounts[player][type] > 6))) return false;

  const reachedGoal = player => {
    const goal = GOALS[player];
    return value.board[goal.r][goal.c]?.player === player;
  };
  const eliminatedTypes = player => TYPES.filter(type => derivedCounts[player][type] === 0);

  if (value.outcome === null) {
    return !reachedGoal(1) && !reachedGoal(2) && eliminatedTypes(1).length === 0 && eliminatedTypes(2).length === 0;
  }

  if (typeof value.outcome !== 'object') return false;
  if (value.outcome.winner !== 1 && value.outcome.winner !== 2) return false;
  if (!['goal', 'elimination'].includes(value.outcome.reason)) return false;
  if (typeof value.outcome.detail !== 'string' || value.currentPlayer !== value.outcome.winner) return false;

  if (value.outcome.reason === 'goal') {
    return value.outcome.detail === GOALS[value.outcome.winner].label && reachedGoal(value.outcome.winner);
  }

  const loser = value.outcome.winner === 1 ? 2 : 1;
  return TYPES.includes(value.outcome.detail) &&
    derivedCounts[loser][value.outcome.detail] === 0 &&
    !reachedGoal(value.outcome.winner);
}
