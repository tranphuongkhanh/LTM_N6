(function(){
"use strict";

/* ============================================================
   MODULE: CONFIG & CONSTANTS
   ============================================================ */
const SIZE = 9;
const TYPES = ['bua','keo','bao'];
const TYPE_LABEL = {bua:'Búa', keo:'Kéo', bao:'Bao'};
const BEATS = {bua:'keo', keo:'bao', bao:'bua'}; // key beats value
const PLAYER_LABEL = {1:'Đỏ', 2:'Xanh'};
// goal cells in internal [row][col] grid coords, computed once board geometry is defined below
let GOALS = []; // filled in initBoard()

/* ============================================================
   MODULE: GAME STATE
   ============================================================ */
let board = [];              // board[row][col] = {type, player} | null
let currentPlayer = 1;
let selected = null;          // {r,c}
let legalMoves = [];          // [{r,c,type:'move'|'capture'}]
let counts = {1:{bua:6,keo:6,bao:6}, 2:{bua:6,keo:6,bao:6}};
let gameOver = false;
let history = [];             // stack of snapshots for undo
let moveLog = [];

/* ============================================================
   MODULE: BOARD INITIALIZATION
   ============================================================ */
function rowLabelOf(rowIndex){ return SIZE - rowIndex; }        // rowIndex 0 -> "9" ... 8 -> "1"
function colLabelOf(colIndex){ return String.fromCharCode(97 + colIndex); } // 0 -> 'a'

function initBoard(){
  board = Array.from({length:SIZE}, () => Array(SIZE).fill(null));

  // row1 = index 8, row2 = index 7 (player 1 / Đỏ, bottom)
  // row9 = index 0, row8 = index 1 (player 2 / Xanh, top)
  const cycleA = ['bua','keo','bao'];
  const cycleB = ['keo','bao','bua'];

  for(let c=0;c<SIZE;c++){
    board[8][c] = {type: cycleA[c % 3], player: 1};
    board[7][c] = {type: cycleB[c % 3], player: 1};
    board[0][c] = {type: cycleA[c % 3], player: 2};
    board[1][c] = {type: cycleB[c % 3], player: 2};
  }

  // a1 -> col 0, row1(=index 8) ; i9 -> col 8, row9(=index 0)
  GOALS = [{r:8,c:0,label:'a1'}, {r:0,c:8,label:'i9'}];

  counts = {1:{bua:6,keo:6,bao:6}, 2:{bua:6,keo:6,bao:6}};
  currentPlayer = 1;
  selected = null;
  legalMoves = [];
  gameOver = false;
  history = [];
  moveLog = [];
}

/* ============================================================
   MODULE: MOVE VALIDATION & RPS CAPTURE LOGIC
   ============================================================ */
function inBounds(r,c){ return r>=0 && r<SIZE && c>=0 && c<SIZE; }

// Returns 'move' | 'capture' | null(blocked/illegal) for attacker moving onto target cell
function moveOutcome(attackerType, targetCell){
  if(targetCell === null) return 'move';
  if(targetCell.player === currentPlayer) return null;      // own piece: blocked
  if(targetCell.type === attackerType) return null;          // same type: blocked, only stands in the way
  if(BEATS[attackerType] === targetCell.type) return 'capture'; // attacker beats defender
  return null; // defender beats attacker: illegal to move there
}

function computeLegalMoves(r,c){
  const piece = board[r][c];
  if(!piece || piece.player !== currentPlayer) return [];
  const out = [];
  for(let dr=-1; dr<=1; dr++){
    for(let dc=-1; dc<=1; dc++){
      if(dr===0 && dc===0) continue;
      const nr=r+dr, nc=c+dc;
      if(!inBounds(nr,nc)) continue;
      const result = moveOutcome(piece.type, board[nr][nc]);
      if(result) out.push({r:nr, c:nc, type:result});
    }
  }
  return out;
}

/* ============================================================
   MODULE: WIN CONDITIONS
   ============================================================ */
function isGoalCell(r,c){
  return GOALS.some(g => g.r===r && g.c===c);
}

function checkWin(mover, toR, toC, capturedPiece){
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
   MODULE: GAME CONTROL (move execution / undo / reset)
   ============================================================ */
function snapshot(){
  return {
    board: JSON.parse(JSON.stringify(board)),
    counts: JSON.parse(JSON.stringify(counts)),
    currentPlayer,
    moveLog: moveLog.slice(),
    gameOver
  };
}
function restore(snap){
  board = snap.board;
  counts = snap.counts;
  currentPlayer = snap.currentPlayer;
  moveLog = snap.moveLog;
  gameOver = snap.gameOver;
  selected = null;
  legalMoves = [];
}

function performMove(from, to, moveType){
  history.push(snapshot());

  const piece = board[from.r][from.c];
  const capturedPiece = board[to.r][to.c];

  board[to.r][to.c] = piece;
  board[from.r][from.c] = null;

  if(moveType === 'capture' && capturedPiece){
    counts[capturedPiece.player][capturedPiece.type]--;
  }

  const fromLabel = colLabelOf(from.c) + rowLabelOf(from.r);
  const toLabel = colLabelOf(to.c) + rowLabelOf(to.r);
  let entry = `${PLAYER_LABEL[currentPlayer]}: ${TYPE_LABEL[piece.type]} ${fromLabel}→${toLabel}`;
  if(moveType==='capture') entry += ` (ăn ${TYPE_LABEL[capturedPiece.type]})`;
  moveLog.push(entry);

  const result = checkWin(currentPlayer, to.r, to.c, moveType==='capture' ? capturedPiece : null);

  selected = null;
  legalMoves = [];

  if(result){
    gameOver = true;
    render();
    showWin(result);
    return;
  }

  currentPlayer = currentPlayer === 1 ? 2 : 1;
  render();
}

function undo(){
  if(history.length === 0) return;
  const snap = history.pop();
  restore(snap);
  hideWin();
  render();
}

function newGame(){
  initBoard();
  hideWin();
  hideRules();
  render();
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
  // board cells
  boardEl.innerHTML = '';
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
        if(!gameOver && piece.player === currentPlayer){
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
  moveLog.slice(-40).forEach(entry => {
    const d = document.createElement('div');
    d.innerHTML = entry;
    logEl.appendChild(d);
  });

  btnUndo.disabled = history.length === 0;
}

/* ============================================================
   MODULE: EVENT HANDLERS
   ============================================================ */
function onCellClick(e){
  if(gameOver) return;
  const r = parseInt(e.currentTarget.dataset.r,10);
  const c = parseInt(e.currentTarget.dataset.c,10);
  const piece = board[r][c];

  // clicking a legal destination
  const dest = legalMoves.find(m => m.r===r && m.c===c);
  if(selected && dest){
    performMove(selected, {r,c}, dest.type);
    return;
  }

  // clicking own piece: select / reselect
  if(piece && piece.player === currentPlayer){
    if(selected && selected.r===r && selected.c===c){
      selected = null; legalMoves = [];
    } else {
      selected = {r,c};
      legalMoves = computeLegalMoves(r,c);
    }
    render();
    return;
  }

  // clicking anything else: deselect
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

document.getElementById('btnRules').addEventListener('click', showRules);
document.getElementById('closeRules').addEventListener('click', hideRules);
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnNew').addEventListener('click', () => {
  if(confirm('Bắt đầu ván mới? Ván hiện tại sẽ mất.')) newGame();
});
document.getElementById('btnPlayAgain').addEventListener('click', newGame);
rulesOverlay.addEventListener('click', (e) => { if(e.target===rulesOverlay) hideRules(); });
winOverlay.addEventListener('click', (e) => { if(e.target===winOverlay) return; });

/* ============================================================
   BOOT
   ============================================================ */
initBoard();
buildLabels();
render();

})();
