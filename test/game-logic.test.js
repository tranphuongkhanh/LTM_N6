import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIZE,
  BEATS,
  createInitialBoard,
  countPieces,
  createInitialState,
  inBounds,
  isGoalCell,
  moveOutcome,
  computeLegalMoves,
  checkWin,
  validateMove,
  applyMove,
  isValidGameState
} from '../game-logic.js';

test('Kiểm tra ô đích và tính toán nước đi hợp lệ', () => {
  assert.equal(isGoalCell(0, 8), true); // i9
  assert.equal(isGoalCell(8, 0), true); // a1
  assert.equal(isGoalCell(4, 4), false);

  const state = createInitialState('test-match');
  // Quân ở góc hàng 7 cột 0: có thể đi các ô kề trống
  const moves = computeLegalMoves(state, 7, 0);
  assert.ok(moves.length > 0);
  for (const m of moves) {
    assert.ok(m.r >= 0 && m.r < SIZE && m.c >= 0 && m.c < SIZE);
    assert.equal(m.type, 'move');
  }
});

test('Khởi tạo bàn cờ 9x9 đúng 18 quân mỗi bên, 6 quân mỗi loại', () => {
  const board = createInitialBoard();
  assert.equal(board.length, SIZE);
  for (let r = 0; r < SIZE; r++) {
    assert.equal(board[r].length, SIZE);
  }

  const counts = countPieces(board);
  assert.deepEqual(counts[1], { bua: 6, keo: 6, bao: 6 });
  assert.deepEqual(counts[2], { bua: 6, keo: 6, bao: 6 });

  // Đỏ (player 1) ở hàng 8 và 7
  assert.equal(board[8][0].player, 1);
  assert.equal(board[7][0].player, 1);
  // Xanh (player 2) ở hàng 0 và 1
  assert.equal(board[0][0].player, 2);
  assert.equal(board[1][0].player, 2);
});

test('Ma trận 9 cặp tương tác Búa / Kéo / Bao', () => {
  const types = ['bua', 'keo', 'bao'];
  for (const attacker of types) {
    for (const defender of types) {
      const outcome = moveOutcome({ type: attacker, player: 1 }, { type: defender, player: 2 });
      if (attacker === defender) {
        // Cùng loại: chặn đường, không ăn được
        assert.equal(outcome, null, `${attacker} vs ${defender} phải bị chặn`);
      } else if (BEATS[attacker] === defender) {
        // Thắng: ăn quân
        assert.equal(outcome, 'capture', `${attacker} phải ăn được ${defender}`);
      } else {
        // Thua: không được đi vào
        assert.equal(outcome, null, `${attacker} không được đi vào ${defender}`);
      }
    }
  }

  // Đi vào ô trống -> move
  assert.equal(moveOutcome({ type: 'bua', player: 1 }, null), 'move');
  // Đi vào ô có quân mình -> null (bị chặn)
  assert.equal(moveOutcome({ type: 'bua', player: 1 }, { type: 'keo', player: 1 }), null);
});

test('Kiểm tra giới hạn di chuyển: chỉ 1 ô theo 8 hướng và trong biên', () => {
  assert.equal(inBounds(0, 0), true);
  assert.equal(inBounds(8, 8), true);
  assert.equal(inBounds(-1, 0), false);
  assert.equal(inBounds(0, 9), false);
  assert.equal(inBounds(9, 9), false);

  const state = createInitialState('test-match');
  // Đỏ thử đi 2 ô
  const invalidJump = validateMove(state, 1, { r: 7, c: 0 }, { r: 5, c: 0 });
  assert.equal(invalidJump.ok, false);
  assert.match(invalidJump.error, /đúng một ô/);

  // Đi 0 ô (đứng yên)
  const standStill = validateMove(state, 1, { r: 7, c: 0 }, { r: 7, c: 0 });
  assert.equal(standStill.ok, false);
});

test('Kiểm tra lượt đi và quyền sở hữu quân', () => {
  const state = createInitialState('test-match');
  // Đến lượt Đỏ (1), Xanh (2) đi trước -> lỗi
  const wrongTurn = validateMove(state, 2, { r: 1, c: 0 }, { r: 2, c: 0 });
  assert.equal(wrongTurn.ok, false);
  assert.match(wrongTurn.error, /lượt/);

  // Đỏ chọn ô của Xanh để đi -> lỗi
  const notOwned = validateMove(state, 1, { r: 1, c: 0 }, { r: 2, c: 0 });
  assert.equal(notOwned.ok, false);
  assert.match(notOwned.error, /không sở hữu/);

  // Đỏ chọn ô trống -> lỗi
  const emptyCell = validateMove(state, 1, { r: 4, c: 4 }, { r: 4, c: 5 });
  assert.equal(emptyCell.ok, false);
  assert.match(emptyCell.error, /không có quân/);
});

test('Đỏ chỉ thắng ở i9 (r=0, c=8), vào a1 không thắng theo đích', () => {
  const state = createInitialState('test-match');
  // Đỏ vào i9
  const winP1 = checkWin(state, 1, 0, 8, null);
  assert.deepEqual(winP1, { winner: 1, reason: 'goal', detail: 'i9' });

  // Đỏ vào a1 (ô đích của Xanh) -> KHÔNG thắng
  const noWinP1 = checkWin(state, 1, 8, 0, null);
  assert.equal(noWinP1, null);
});

test('Xanh chỉ thắng ở a1 (r=8, c=0), vào i9 không thắng theo đích', () => {
  const state = createInitialState('test-match');
  // Xanh vào a1
  const winP2 = checkWin(state, 2, 8, 0, null);
  assert.deepEqual(winP2, { winner: 2, reason: 'goal', detail: 'a1' });

  // Xanh vào i9 (ô đích của Đỏ) -> KHÔNG thắng
  const noWinP2 = checkWin(state, 2, 0, 8, null);
  assert.equal(noWinP2, null);
});

test('Thắng do ăn hết một loại quân của đối phương', () => {
  const state = createInitialState('test-match');
  // Giả lập Xanh chỉ còn 1 quân Kéo, bị Đỏ ăn
  state.counts[2].keo = 1;
  const capturedPiece = { player: 2, type: 'keo' };

  // Đặt bàn cờ trống ngoại trừ nước ăn
  state.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  state.board[4][4] = { player: 1, type: 'bua' };
  state.board[4][5] = capturedPiece;

  const result = applyMove(state, 1, { r: 4, c: 4 }, { r: 4, c: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.state.gameOver, true);
  assert.deepEqual(result.state.outcome, { winner: 1, reason: 'elimination', detail: 'keo' });

  // Không được đi tiếp sau khi ván đấu kết thúc
  const postGameMove = validateMove(result.state, 2, { r: 0, c: 0 }, { r: 0, c: 1 });
  assert.equal(postGameMove.ok, false);
  assert.match(postGameMove.error, /đã kết thúc/);
});

test('Hợp lệ hóa snapshot bằng isValidGameState', () => {
  const initial = createInitialState('m1');
  assert.equal(isValidGameState(initial), true);

  // Snapshot giả mạo count không khớp board
  const tampered = JSON.parse(JSON.stringify(initial));
  tampered.counts[1].bua = 99;
  assert.equal(isValidGameState(tampered), false);

  // Snapshot giả mạo kích thước board
  const badBoard = JSON.parse(JSON.stringify(initial));
  badBoard.board.pop();
  assert.equal(isValidGameState(badBoard), false);
});
