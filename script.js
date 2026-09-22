import { playhtml } from "https://unpkg.com/playhtml";

/* ============================================================
   MODULE: CONFIG & CONSTANTS
   ============================================================ */
const SIZE = 9;
const TYPES = ['bua','keo','bao'];
const TYPE_LABEL = {bua:'Búa', keo:'Kéo', bao:'Bao'};
const BEATS = {bua:'keo', keo:'bao', bao:'bua'}; // key beats value
const PLAYER_LABEL = {1:'Đỏ', 2:'Xanh'};
const GOALS = [{r:8,c:0,label:'a1'}, {r:0,c:8,label:'i9'}]; // fixed board geometry

/* ============================================================
   MODULE: ROOM / URL HANDLING
   ------------------------------------------------------------
   The room code lives in the URL (?room=XXXXXX). Two browsers
   pointed at the same URL automatically share the same playhtml
   room, so all we need is to generate a code if one isn't
   present yet and put it back in the address bar so it can be
   shared/bookmarked.
   ============================================================ */
function getOrCreateRoomCode(){
  const params = new URLSearchParams(location.search);
  let code = params.get('room');
  if(!code){
    code = Math.random().toString(36).slice(2,8).toUpperCase();
    params.set('room', code);
    history.replaceState(null, '', location.pathname + '?' + params.toString());
  }
  return code;
}
const ROOM_CODE = getOrCreateRoomCode();

/* ============================================================
   MODULE: GAME STATE (SHARED / SYNCED)
   ------------------------------------------------------------
   `shared` is the single source of truth and lives in a
   playhtml page-data channel, so every tab in the same room
   sees the exact same object. Local-only UI state (which cell
   is selected, which legal moves are highlighted) stays local
   because it's different per-viewer.
   ============================================================ */
function freshBoard(){
  const b = Array.from({length:SIZE}, () => Array(SIZE).fill(null));
  const cycleA = ['bua','keo','bao'];
  const cycleB = ['keo','bao','bua'];
  for(let c=0;c<SIZE;c++){
    b[8][c] = {type: cycleA[c % 3], player: 1};
    b[7][c] = {type: cycleB[c % 3], player: 1};
    b[0][c] = {type: cycleA[c % 3], player: 2};
    b[1][c] = {type: cycleB[c % 3], player: 2};
  }
  return b;
}

function freshState(keepSeats){
  return {
    board: freshBoard(),
    counts: {1:{bua:6,keo:6,bao:6}, 2:{bua:6,keo:6,bao:6}},
    currentPlayer: 1,
    moveLog: [],
    gameOver: false,
    winner: null,
    prevSnapshot: null,          // single-level undo, shared so both sides agree
    seats: keepSeats || {1:null, 2:null} // publicKey of whoever claimed each color
  };
}

let shared = freshState();   // mirrors the synced channel
let mySeat = null;           // 1, 2, or null (spectator / not seated yet)
let myKey = null;
let selected = null;         // {r,c} — local-only UI state
let legalMoves = [];         // local-only UI state

playhtml.init({ room: `ott-${ROOM_CODE}` });
const channel = playhtml.createPageData('state', freshState());

/* ============================================================
   MODULE: BOARD GEOMETRY HELPERS
   ============================================================ */
function rowLabelOf(rowIndex){ return SIZE - rowIndex; }
function colLabelOf(colIndex){ return String.fromCharCode(97 + colIndex); }
function inBounds(r,c){ return r>=0 && r<SIZE && c>=0 && c<SIZE; }
function isGoalCell(r,c){ return GOALS.some(g => g.r===r && g.c===c); }

/* ============================================================
   MODULE: MOVE VALIDATION & RPS CAPTURE LOGIC
   (pure functions — take state in, return results, never mutate)
   ============================================================ */
function moveOutcome(attackerType, targetCell, forPlayer){
  if(targetCell === null) return 'move';
  if(targetCell.player === forPlayer) return null;
  if(targetCell.type === attackerType) return null;
  if(BEATS[attackerType] === targetCell.type) return 'capture';
  return null;
}

function computeLegalMoves(board, r, c, forPlayer){
  const piece = board[r][c];
  if(!piece || piece.player !== forPlayer) return [];
  const out = [];
  for(let dr=-1; dr<=1; dr++){
    for(let dc=-1; dc<=1; dc++){
      if(dr===0 && dc===0) continue;
      const nr=r+dr, nc=c+dc;
      if(!inBounds(nr,nc)) continue;
      const result = moveOutcome(piece.type, board[nr][nc], forPlayer);
      if(result) out.push({r:nr, c:nc, type:result});
    }
  }
  return out;
}

function checkWin(mover, toR, toC, capturedPiece, counts){
  if(isGoalCell(toR,toC)){
    const g = GOALS.find(g => g.r===toR && g.c===toC);
    return {winner:mover, reason:'goal', detail:g.label};
  }
  if(capturedPiece){
    const opp = capturedPiece.player;
    if(counts[opp][capturedPiece.type] === 0){
      return {winner:mover, reason:'elimination', detail:capturedPiece.type};
    }
  }
  return null;
}

/* ============================================================
   MODULE: GAME CONTROL (writes go through the shared channel)
   ============================================================ */
function performMove(from, to, moveType){
  if(mySeat === null || shared.gameOver) return;
  if(shared.currentPlayer !== mySeat) return; // not your turn

  channel.setData(draft => {
    const piece = draft.board[from.r][from.c];
    const capturedPiece = draft.board[to.r][to.c];

    // keep a single-level undo snapshot of the pre-move state
    draft.prevSnapshot = {
      board: JSON.parse(JSON.stringify(draft.board)),
      counts: JSON.parse(JSON.stringify(draft.counts)),
      currentPlayer: draft.currentPlayer,
      moveLog: draft.moveLog.slice(),
      gameOver: draft.gameOver,
      winner: draft.winner,
      mover: draft.currentPlayer
    };

    draft.board[to.r][to.c] = piece;
    draft.board[from.r][from.c] = null;

    if(moveType === 'capture' && capturedPiece){
      draft.counts[capturedPiece.player][capturedPiece.type]--;
    }

    const fromLabel = colLabelOf(from.c) + rowLabelOf(from.r);
    const toLabel = colLabelOf(to.c) + rowLabelOf(to.r);
    let entry = `${PLAYER_LABEL[draft.currentPlayer]}: ${TYPE_LABEL[piece.type]} ${fromLabel}→${toLabel}`;
    if(moveType==='capture') entry += ` (ăn ${TYPE_LABEL[capturedPiece.type]})`;
    draft.moveLog.push(entry);

    const result = checkWin(draft.currentPlayer, to.r, to.c, moveType==='capture' ? capturedPiece : null, draft.counts);
    if(result){
      draft.gameOver = true;
      draft.winner = result;
    } else {
      draft.currentPlayer = draft.currentPlayer === 1 ? 2 : 1;
    }
  });

  selected = null;
  legalMoves = [];
}

function undo(){
  if(!shared.prevSnapshot) return;
  // only the player who made the last move (or either seat, once the game
  // ended) can take it back — keeps both sides in agreement.
  if(mySeat === null) return;

  channel.setData(draft => {
    const snap = draft.prevSnapshot;
    if(!snap) return;
    draft.board = snap.board;
    draft.counts = snap.counts;
    draft.currentPlayer = snap.currentPlayer;
    draft.moveLog = snap.moveLog;
    draft.gameOver = snap.gameOver;
    draft.winner = snap.winner;
    draft.prevSnapshot = null;
  });
  selected = null;
  legalMoves = [];
  hideWin();
}

function newGame(){
  channel.setData(draft => {
    const fresh = freshState({1: draft.seats[1], 2: draft.seats[2]});
    draft.board = fresh.board;
    draft.counts = fresh.counts;
    draft.currentPlayer = fresh.currentPlayer;
    draft.moveLog = fresh.moveLog;
    draft.gameOver = fresh.gameOver;
    draft.winner = fresh.winner;
    draft.prevSnapshot = fresh.prevSnapshot;
    // seats untouched — same two players keep playing
  });
  selected = null;
  legalMoves = [];
  hideWin();
  hideRules();
}

/* ============================================================
   MODULE: SEATING
   ------------------------------------------------------------
   First visitor to a room claims Đỏ (1), second claims Xanh (2),
   everyone after that is a spectator. Seats persist across
   reloads because playhtml keeps a stable identity per browser.
   ============================================================ */
function claimSeatIfNeeded(){
  if(!myKey) return;
  if(shared.seats[1] === myKey || shared.seats[2] === myKey) return;
  if(!shared.seats[1]){
    channel.setData(draft => { draft.seats[1] = myKey; });
  } else if(!shared.seats[2]){
    channel.setData(draft => { draft.seats[2] = myKey; });
  }
}

function computeMySeat(){
  if(!myKey) return null;
  if(shared.seats[1] === myKey) return 1;
  if(shared.seats[2] === myKey) return 2;
  return null;
}

/* ============================================================
   MODULE: RENDERING
   ============================================================ */
const boardEl = document.getElementById('board');
const rowLabelsEl = document.getElementById('rowLabels');
const colLabelsEl = document.getElementById('colLabels');
const scoreboardEl = document.getElementById('scoreboard');
const logEl = document.getElementById('log');
const turnDot = document.getElementById('turnDot');
const turnLabel = document.getElementById('turnLabel');
const btnUndo = document.getElementById('btnUndo');
const roomCodeLabel = document.getElementById('roomCodeLabel');
const seatBadge = document.getElementById('seatBadge');
const waitingOverlay = document.getElementById('waitingOverlay');
const waitingTitle = document.getElementById('waitingTitle');
const waitingDesc = document.getElementById('waitingDesc');

function buildLabels(){
  rowLabelsEl.innerHTML = '';
  for(let r=0;r<SIZE;r++){
    const s = document.createElement('span');
    s.textContent = rowLabelOf(r);
    rowLabelsEl.appendChild(s);
  }
  colLabelsEl.innerHTML = '';
  for(let c=0;c<SIZE;c++){
    const s = document.createElement('span');
    s.textContent = colLabelOf(c).toUpperCase();
    colLabelsEl.appendChild(s);
  }
}

function pieceIconSVG(type){
  return `<svg><use href="#icon-${type}"/></svg>`;
}

function render(){
  const board = shared.board;
  const counts = shared.counts;
  const currentPlayer = shared.currentPlayer;
  const gameOver = shared.gameOver;
  const myTurn = mySeat !== null && mySeat === currentPlayer && !gameOver;

  roomCodeLabel.textContent = ROOM_CODE;

  seatBadge.className = 'seat-badge';
  if(mySeat === null){
    seatBadge.textContent = shared.seats[1] && shared.seats[2] ? 'Bạn là: Người xem' : 'Đang kết nối…';
    seatBadge.classList.add('spectator');
  } else {
    seatBadge.textContent = `Bạn là: ${PLAYER_LABEL[mySeat]}`;
    seatBadge.classList.add(mySeat === 1 ? 'me-p1' : 'me-p2');
  }

  // waiting-for-opponent overlay
  if(mySeat !== null && !shared.seats[2]){
    waitingTitle.textContent = 'Đang chờ đối thủ…';
    waitingDesc.textContent = 'Gửi link phòng cho bạn bè để họ vào chơi cùng.';
    waitingOverlay.classList.add('open');
  } else {
    waitingOverlay.classList.remove('open');
  }

  // board cells
  boardEl.innerHTML = '';
  boardEl.classList.toggle('locked', !myTurn);
  for(let r=0;r<SIZE;r++){
    for(let c=0;c<SIZE;c++){
      const cell = document.createElement('div');
      cell.className = 'cell ' + (((r+c)%2===0) ? 'light' : 'dark');
      if(isGoalCell(r,c)) cell.classList.add('goal');
      cell.dataset.r = r;
      cell.dataset.c = c;

      const piece = board[r][c];
      if(piece){
        const pd = document.createElement('div');
        pd.className = 'piece p' + piece.player;
        pd.innerHTML = pieceIconSVG(piece.type);
        cell.appendChild(pd);
        if(myTurn && piece.player === currentPlayer){
          cell.classList.add('own-piece');
        }
      }

      if(selected && selected.r===r && selected.c===c){
        cell.classList.add('selected');
      }
      const lm = legalMoves.find(m => m.r===r && m.c===c);
      if(lm){
        cell.classList.add(lm.type==='capture' ? 'capture-target' : 'move-target');
      }

      cell.addEventListener('click', onCellClick);
      boardEl.appendChild(cell);
    }
  }

  // turn indicator
  turnDot.className = 'turn-dot p' + currentPlayer;
  turnLabel.textContent = PLAYER_LABEL[currentPlayer];

  // scoreboard
  scoreboardEl.innerHTML = '';
  [1,2].forEach(p => {
    const row = document.createElement('div');
    row.className = 'score-row';
    const nameEl = document.createElement('div');
    nameEl.className = 'score-player';
    nameEl.textContent = PLAYER_LABEL[p];
    row.appendChild(nameEl);
    const typesEl = document.createElement('div');
    typesEl.className = 'score-types';
    TYPES.forEach(t => {
      const chip = document.createElement('div');
      chip.className = 'score-chip' + (counts[p][t]===0 ? ' zero' : '');
      chip.innerHTML = pieceIconSVG(t) + ' ' + counts[p][t];
      typesEl.appendChild(chip);
    });
    row.appendChild(typesEl);
    scoreboardEl.appendChild(row);
  });

  // log
  logEl.innerHTML = '';
  shared.moveLog.slice(-40).forEach(entry => {
    const d = document.createElement('div');
    d.innerHTML = entry;
    logEl.appendChild(d);
  });

  btnUndo.disabled = !shared.prevSnapshot || mySeat === null;

  if(gameOver && shared.winner){
    showWin(shared.winner);
  } else {
    hideWin();
  }
}

/* ============================================================
   MODULE: EVENT HANDLERS
   ============================================================ */
function onCellClick(e){
  if(shared.gameOver) return;
  if(mySeat === null || mySeat !== shared.currentPlayer) return; // spectator or not your turn

  const r = parseInt(e.currentTarget.dataset.r,10);
  const c = parseInt(e.currentTarget.dataset.c,10);
  const piece = shared.board[r][c];

  const dest = legalMoves.find(m => m.r===r && m.c===c);
  if(selected && dest){
    performMove(selected, {r,c}, dest.type);
    return;
  }

  if(piece && piece.player === shared.currentPlayer){
    if(selected && selected.r===r && selected.c===c){
      selected = null; legalMoves = [];
    } else {
      selected = {r,c};
      legalMoves = computeLegalMoves(shared.board, r, c, shared.currentPlayer);
    }
    render();
    return;
  }

  selected = null; legalMoves = [];
  render();
}

const rulesOverlay = document.getElementById('rulesOverlay');
const winOverlay = document.getElementById('winOverlay');

function showRules(){ rulesOverlay.classList.add('open'); }
function hideRules(){ rulesOverlay.classList.remove('open'); }
function showWin(result){
  const title = document.getElementById('winTitle');
  const desc = document.getElementById('winDesc');
  title.textContent = `${PLAYER_LABEL[result.winner]} thắng!`;
  if(result.reason === 'goal'){
    desc.textContent = `Đã đưa quân về ô đích ${result.detail.toUpperCase()}.`;
  } else {
    desc.textContent = `Đã ăn sạch toàn bộ quân ${TYPE_LABEL[result.detail]} của đối phương.`;
  }
  winOverlay.classList.add('open');
}
function hideWin(){ winOverlay.classList.remove('open'); }

function shareLink(){
  return location.href;
}
async function copyShareLink(){
  try{
    await navigator.clipboard.writeText(shareLink());
    alert('Đã sao chép link phòng!');
  } catch(err){
    prompt('Sao chép link phòng:', shareLink());
  }
}

document.getElementById('btnRules').addEventListener('click', showRules);
document.getElementById('closeRules').addEventListener('click', hideRules);
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnNew').addEventListener('click', () => {
  if(confirm('Bắt đầu ván mới? Ván hiện tại sẽ mất.')) newGame();
});
document.getElementById('btnPlayAgain').addEventListener('click', newGame);
document.getElementById('btnCopyLink').addEventListener('click', copyShareLink);
document.getElementById('btnCopyLinkWaiting').addEventListener('click', copyShareLink);
rulesOverlay.addEventListener('click', (e) => { if(e.target===rulesOverlay) hideRules(); });
winOverlay.addEventListener('click', (e) => { if(e.target===winOverlay) return; });

/* ============================================================
   BOOT
   ============================================================ */
buildLabels();

// initial paint before the network has responded, so the page isn't blank
render();

channel.onUpdate((data) => {
  shared = data;
  mySeat = computeMySeat();
  render();
});

// wait a tick for the identity/connection to be ready, then read the
// current room state and try to claim a seat
setTimeout(() => {
  try{
    myKey = playhtml.presence.getMyIdentity().publicKey;
  } catch(err){
    myKey = null;
  }
  shared = channel.getData();
  mySeat = computeMySeat();
  claimSeatIfNeeded();
  render();
}, 300);
