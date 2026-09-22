import { playhtml } from 'playhtml';
import {
  SIZE,
  TYPES,
  TYPE_LABEL,
  PLAYER_LABEL,
  rowLabelOf,
  colLabelOf,
  createInitialState,
  computeLegalMoves,
  applyMove,
  isValidGameState,
  isGoalCell
} from './game-logic.js';
import {
  HostCommandLedger
} from './game-protocol.js';

/* ============================================================
   SESSION & CLIENT IDENTITY
   ============================================================ */
function getOrCreateClientId() {
  const key = 'ottv2_client_id';
  let id = sessionStorage.getItem(key);
  if (!id || !/^[A-Za-z0-9_-]{8,100}$/.test(id)) {
    id = 'c_' + crypto.randomUUID().replace(/-/g, '');
    sessionStorage.setItem(key, id);
  }
  return id;
}

const myClientId = getOrCreateClientId();

/* ============================================================
   URL / ROOM ROUTING
   ============================================================ */
const urlParams = new URLSearchParams(window.location.search);
const currentRoomId = urlParams.get('room')?.trim() || '';
const isOnlineMode = Boolean(currentRoomId);
const isRoomCreator = isOnlineMode && sessionStorage.getItem(`ottv2_created_room_${currentRoomId}`) === '1';

/* ============================================================
   GAME STATE
   ============================================================ */
let localState = createInitialState(isOnlineMode ? '' : 'local-match');
let myPlayerRole = isOnlineMode ? (isRoomCreator ? 1 : 2) : 0; // 0 = cả hai (cùng máy), 1 = Đỏ, 2 = Xanh
let isHost = isOnlineMode && isRoomCreator;
let selectedCell = null; // { r, c }
let currentLegalMoves = [];
let localUndoHistory = [];
let pendingCommandId = null;
let roomEverHadTwoPlayers = false;
let isOpponentDisconnected = false;
let hasSentJoinRequest = false;

// Host-specific network ledger
let hostLedger = isHost ? new HostCommandLedger() : null;

// PlayHTML Channels
let stateChannel = null;
let commandChannel = null;
let responseChannel = null;

/* ============================================================
   DOM ELEMENTS
   ============================================================ */
const boardEl = document.getElementById('board');
const rowLabelsEl = document.getElementById('rowLabels');
const colLabelsEl = document.getElementById('colLabels');
const scoreboardEl = document.getElementById('scoreboard');
const logEl = document.getElementById('log');
const turnDot = document.getElementById('turnDot');
const turnLabel = document.getElementById('turnLabel');
const btnUndo = document.getElementById('btnUndo');
const btnNew = document.getElementById('btnNew');
const btnPlayAgain = document.getElementById('btnPlayAgain');
const rulesOverlay = document.getElementById('rulesOverlay');
const winOverlay = document.getElementById('winOverlay');
const btnRules = document.getElementById('btnRules');
const closeRules = document.getElementById('closeRules');

const btnCreateRoom = document.getElementById('btnCreateRoom');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const roomInput = document.getElementById('roomInput');
const btnCopyLink = document.getElementById('btnCopyLink');
const roomIdLabel = document.getElementById('roomIdLabel');
const roleLabel = document.getElementById('roleLabel');
const connectionStatus = document.getElementById('connectionStatus');

/* ============================================================
   SERIALIZATION HELPERS (ATOMIC STATE PACKET)
   ============================================================ */
function publishAuthoritativeState(state) {
  if (!stateChannel) return;
  stateChannel.setData(draft => {
    draft.statePacket = JSON.stringify(state);
  });
}

function parseStateFromChannel(data) {
  if (!data || typeof data.statePacket !== 'string' || !data.statePacket) return null;
  try {
    return JSON.parse(data.statePacket);
  } catch {
    return null;
  }
}

/* ============================================================
   BOARD LABELS & SVG
   ============================================================ */
function buildLabels() {
  rowLabelsEl.innerHTML = '';
  for (let r = 0; r < SIZE; r++) {
    const s = document.createElement('span');
    s.textContent = rowLabelOf(r);
    rowLabelsEl.appendChild(s);
  }
  colLabelsEl.innerHTML = '';
  for (let c = 0; c < SIZE; c++) {
    const s = document.createElement('span');
    s.textContent = colLabelOf(c).toUpperCase();
    colLabelsEl.appendChild(s);
  }
}

function pieceIconSVG(type) {
  return `<svg><use href="#icon-${type}"/></svg>`;
}

/* ============================================================
   STATUS & UI MESSAGES
   ============================================================ */
function setConnectionStatus(text, state = 'info') {
  connectionStatus.textContent = text;
  connectionStatus.dataset.state = state;
}

function updateRoomCardUI() {
  if (!isOnlineMode) {
    roleLabel.textContent = 'Chế độ chơi cùng máy';
    roomIdLabel.hidden = true;
    btnCopyLink.hidden = true;
    setConnectionStatus('Sẵn sàng', 'ready');
    return;
  }

  roomIdLabel.hidden = false;
  roomIdLabel.textContent = `Mã phòng: ${currentRoomId}`;
  btnCopyLink.hidden = false;

  if (isHost) {
    roleLabel.textContent = 'Bạn là Đỏ (Chủ phòng)';
    if (!localState.guestClientId) {
      setConnectionStatus('Đang chờ người chơi Xanh vào phòng...', 'info');
    } else if (isOpponentDisconnected) {
      setConnectionStatus('Người chơi Xanh đã ngắt kết nối. Vui lòng tạo phòng mới.', 'error');
    } else {
      setConnectionStatus('Đã kết nối đủ 2 người chơi.', 'ready');
    }
  } else {
    if (localState.guestClientId === myClientId) {
      roleLabel.textContent = 'Bạn là Xanh (Khách)';
      if (isOpponentDisconnected) {
        setConnectionStatus('Chủ phòng đã ngắt kết nối. Vui lòng tạo phòng mới.', 'error');
      } else {
        setConnectionStatus('Đã kết nối tới chủ phòng.', 'ready');
      }
    } else if (localState.guestClientId && localState.guestClientId !== myClientId) {
      roleLabel.textContent = 'Phòng đã đủ người';
      setConnectionStatus('Phòng đã có 2 người chơi. Bạn không thể tham gia ván này.', 'error');
    } else {
      roleLabel.textContent = 'Đang xin vào ghế Xanh...';
      setConnectionStatus('Đang kết nối tới chủ phòng...', 'info');
    }
  }
}

/* ============================================================
   RENDERING
   ============================================================ */
function canCurrentClientInteract() {
  if (localState.gameOver) return false;
  if (isOnlineMode) {
    if (!localState.guestClientId) return false; // chưa đủ người
    if (isOpponentDisconnected) return false; // đối thủ mất kết nối
    if (pendingCommandId) return false; // đang chờ xác nhận lệnh
    if (myPlayerRole !== localState.currentPlayer) return false; // không phải lượt mình
  }
  return true;
}

function render() {
  // Render board cells
  boardEl.innerHTML = '';
  const canInteract = canCurrentClientInteract();

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell ' + (((r + c) % 2 === 0) ? 'light' : 'dark');
      if (isGoalCell(r, c)) cell.classList.add('goal');
      cell.dataset.r = r;
      cell.dataset.c = c;

      const piece = localState.board[r][c];
      if (piece) {
        const pd = document.createElement('div');
        pd.className = 'piece p' + piece.player;
        pd.innerHTML = pieceIconSVG(piece.type);
        cell.appendChild(pd);

        const isOwnPiece = isOnlineMode
          ? piece.player === myPlayerRole && piece.player === localState.currentPlayer
          : piece.player === localState.currentPlayer;

        if (canInteract && isOwnPiece) {
          cell.classList.add('own-piece');
        }
      }

      if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
        cell.classList.add('selected');
      }

      const lm = currentLegalMoves.find(m => m.r === r && m.c === c);
      if (lm) {
        cell.classList.add(lm.type === 'capture' ? 'capture-target' : 'move-target');
      }

      cell.addEventListener('click', onCellClick);
      boardEl.appendChild(cell);
    }
  }

  // Turn indicator
  turnDot.className = 'turn-dot p' + localState.currentPlayer;
  turnLabel.textContent = PLAYER_LABEL[localState.currentPlayer];

  // Scoreboard
  scoreboardEl.innerHTML = '';
  [1, 2].forEach(p => {
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
      const count = localState.counts[p][t];
      chip.className = 'score-chip' + (count === 0 ? ' zero' : '');
      chip.innerHTML = pieceIconSVG(t) + ' ' + count;
      typesEl.appendChild(chip);
    });
    row.appendChild(typesEl);
    scoreboardEl.appendChild(row);
  });

  // Log
  logEl.innerHTML = '';
  localState.moveLog.slice(-40).forEach(entry => {
    const d = document.createElement('div');
    d.innerHTML = entry;
    logEl.appendChild(d);
  });

  // Undo button
  if (isOnlineMode) {
    btnUndo.disabled = true;
    btnUndo.title = 'Online: Không hỗ trợ hoàn tác';
  } else {
    btnUndo.disabled = localUndoHistory.length === 0;
    btnUndo.title = '';
  }

  updateRoomCardUI();
}

/* ============================================================
   MODALS: RULES & WIN
   ============================================================ */
function showRules() { rulesOverlay.classList.add('open'); }
function hideRules() { rulesOverlay.classList.remove('open'); }

function showWin(outcome) {
  const title = document.getElementById('winTitle');
  const desc = document.getElementById('winDesc');
  title.textContent = `${PLAYER_LABEL[outcome.winner]} thắng!`;
  if (outcome.reason === 'goal') {
    desc.textContent = `Đã đưa quân về ô đích ${outcome.detail.toUpperCase()}.`;
  } else {
    desc.textContent = `Đã ăn sạch toàn bộ quân ${TYPE_LABEL[outcome.detail]} của đối phương.`;
  }
  winOverlay.classList.add('open');
}

function hideWin() {
  winOverlay.classList.remove('open');
}

/* ============================================================
   CELL CLICK & MOVE HANDLER
   ============================================================ */
function onCellClick(e) {
  if (!canCurrentClientInteract()) return;

  const r = parseInt(e.currentTarget.dataset.r, 10);
  const c = parseInt(e.currentTarget.dataset.c, 10);
  const piece = localState.board[r][c];

  // Clicking a destination
  const dest = currentLegalMoves.find(m => m.r === r && m.c === c);
  if (selectedCell && dest) {
    handleMoveExecution(selectedCell, { r, c });
    return;
  }

  // Clicking own piece
  const isOwnPiece = isOnlineMode
    ? piece && piece.player === myPlayerRole && piece.player === localState.currentPlayer
    : piece && piece.player === localState.currentPlayer;

  if (isOwnPiece) {
    if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
      selectedCell = null;
      currentLegalMoves = [];
    } else {
      selectedCell = { r, c };
      currentLegalMoves = computeLegalMoves(localState, r, c);
    }
    render();
    return;
  }

  // Clicking outside / other piece
  selectedCell = null;
  currentLegalMoves = [];
  render();
}

function handleMoveExecution(from, to) {
  if (!isOnlineMode) {
    // Local hotseat mode
    localUndoHistory.push(JSON.parse(JSON.stringify(localState)));
    const res = applyMove(localState, localState.currentPlayer, from, to);
    if (res.ok) {
      localState = res.state;
      selectedCell = null;
      currentLegalMoves = [];
      render();
      if (localState.gameOver && localState.outcome) {
        showWin(localState.outcome);
      }
    }
    return;
  }

  // Online mode: dispatch command
  const commandId = 'cmd-' + crypto.randomUUID();
  pendingCommandId = commandId;
  selectedCell = null;
  currentLegalMoves = [];
  render();

  const command = {
    commandId,
    clientId: myClientId,
    matchId: localState.matchId,
    expectedRevision: localState.revision,
    kind: 'move',
    from,
    to
  };

  if (isHost) {
    // Host processes directly
    const result = hostLedger.process(localState, command);
    if (result.response.accepted) {
      localState = result.state;
      publishAuthoritativeState(localState);
      responseChannel.setData(draft => {
        draft[commandId] = result.response;
      });
      pendingCommandId = null;
      render();
      if (localState.gameOver && localState.outcome) {
        showWin(localState.outcome);
      }
    } else {
      pendingCommandId = null;
      alert(`Nước đi không hợp lệ: ${result.response.error || result.response.code}`);
      render();
    }
  } else {
    // Guest publishes command to shared command channel
    commandChannel.setData(draft => {
      draft[commandId] = command;
    });
  }
}

/* ============================================================
   HOST COMMAND PROCESSOR (FOR GUEST COMMANDS)
   ============================================================ */
function hostCheckAndProcessCommands(commands) {
  if (!isHost || !commands || typeof commands !== 'object') return;

  const sortedCommands = Object.values(commands).filter(cmd => cmd && typeof cmd === 'object');
  let stateChanged = false;

  for (const cmd of sortedCommands) {
    if (!cmd.commandId) continue;
    const existingRes = responseChannel?.getData()?.[cmd.commandId];
    if (existingRes) continue; // already responded

    const result = hostLedger.process(localState, cmd);
    if (result.response.accepted) {
      localState = result.state;
      stateChanged = true;
    }

    responseChannel.setData(draft => {
      draft[cmd.commandId] = result.response;
    });
  }

  if (stateChanged) {
    publishAuthoritativeState(localState);
    render();
    if (localState.gameOver && localState.outcome) {
      showWin(localState.outcome);
    }
  }
}

/* ============================================================
   GUEST JOIN REQUEST HELPER
   ============================================================ */
function maybeSendJoinRequest(snap) {
  if (isHost) return;
  if (!snap || !snap.initialized) return;
  if (snap.guestClientId) return; // already seated
  if (hasSentJoinRequest) return; // don't spam duplicate join commands

  hasSentJoinRequest = true;
  const joinCmd = {
    commandId: 'cmd-' + crypto.randomUUID(),
    clientId: myClientId,
    matchId: snap.matchId,
    expectedRevision: snap.revision,
    kind: 'join'
  };
  pendingCommandId = joinCmd.commandId;
  commandChannel.setData(draft => {
    draft[joinCmd.commandId] = joinCmd;
  });
}

/* ============================================================
   LOCAL CONTROLS: UNDO & NEW GAME
   ============================================================ */
function handleUndo() {
  if (isOnlineMode) return;
  if (localUndoHistory.length === 0) return;
  localState = localUndoHistory.pop();
  selectedCell = null;
  currentLegalMoves = [];
  hideWin();
  render();
}

function handleNewGame() {
  if (isOnlineMode) {
    // Online: create new room
    const newRoomId = crypto.randomUUID().slice(0, 8);
    sessionStorage.setItem(`ottv2_created_room_${newRoomId}`, '1');
    window.location.href = `${window.location.pathname}?room=${newRoomId}`;
    return;
  }

  // Local mode
  if (confirm('Bắt đầu ván mới? Ván hiện tại sẽ mất.')) {
    localState = createInitialState('local-match');
    localUndoHistory = [];
    selectedCell = null;
    currentLegalMoves = [];
    hideWin();
    hideRules();
    render();
  }
}

/* ============================================================
   ROOM ACTIONS
   ============================================================ */
btnCreateRoom.addEventListener('click', () => {
  const newRoomId = crypto.randomUUID().slice(0, 8);
  sessionStorage.setItem(`ottv2_created_room_${newRoomId}`, '1');
  window.location.href = `${window.location.pathname}?room=${newRoomId}`;
});

btnJoinRoom.addEventListener('click', () => {
  const input = roomInput.value.trim();
  if (!input) {
    alert('Vui lòng nhập mã phòng.');
    return;
  }
  window.location.href = `${window.location.pathname}?room=${encodeURIComponent(input)}`;
});

btnCopyLink.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    const original = btnCopyLink.textContent;
    btnCopyLink.textContent = 'Đã chép link!';
    setTimeout(() => {
      btnCopyLink.textContent = original;
    }, 2000);
  } catch {
    prompt('Sao chép link mời tại đây:', window.location.href);
  }
});

btnUndo.addEventListener('click', handleUndo);
btnNew.addEventListener('click', handleNewGame);
btnPlayAgain.addEventListener('click', handleNewGame);
btnRules.addEventListener('click', showRules);
closeRules.addEventListener('click', hideRules);
rulesOverlay.addEventListener('click', e => { if (e.target === rulesOverlay) hideRules(); });
winOverlay.addEventListener('click', e => { if (e.target === winOverlay) return; });

/* ============================================================
   ONLINE INIT (PLAYHTML)
   ============================================================ */
async function initOnlineSession() {
  setConnectionStatus('Đang kết nối máy chủ...', 'info');

  try {
    const initPromise = playhtml.init({
      room: 'ottv2-v1-' + currentRoomId,
      onError: () => {
        setConnectionStatus('Lỗi kết nối tới máy chủ playhtml.', 'error');
      }
    });

    // Timeout guard: if connection hangs for more than 15s
    await Promise.race([
      initPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Hết thời gian chờ kết nối (15s).')), 15000))
    ]);

    // Create page data channels with stable object defaults
    stateChannel = playhtml.createPageData('ottv2-state', { statePacket: '' });
    commandChannel = playhtml.createPageData('ottv2-cmd', {});
    responseChannel = playhtml.createPageData('ottv2-res', {});

    // Try publishing presence
    try {
      playhtml.presence.setMyPresence('player', {
        clientId: myClientId,
        role: isHost ? 1 : 2,
        online: true
      });

      // Monitor presence to detect disconnects
      playhtml.presence.onPresenceChange('player', presences => {
        if (!roomEverHadTwoPlayers || localState.gameOver) return;

        const onlinePeers = Array.from(presences.values()).map(p => p.player || p);
        const isHostOnline = isHost || onlinePeers.some(p => p.clientId === localState.hostClientId);
        const isGuestOnline = (!isHost && myClientId === localState.guestClientId) ||
          onlinePeers.some(p => p.clientId === localState.guestClientId);

        if (!isHostOnline || !isGuestOnline) {
          isOpponentDisconnected = true;
          render();
        }
      });
    } catch (presenceErr) {
      console.warn('Lỗi presence:', presenceErr);
    }

    // Host initialization of state if empty
    if (isHost) {
      const existing = parseStateFromChannel(stateChannel.getData());
      if (!existing || !existing.initialized) {
        const initialOnline = {
          ...createInitialState(crypto.randomUUID()),
          roomId: currentRoomId,
          initialized: true,
          hostClientId: myClientId,
          guestClientId: null,
          revision: 0
        };
        localState = initialOnline;
        publishAuthoritativeState(initialOnline);
      } else {
        localState = existing;
      }
    }

    // Subscribe to stateChannel updates
    stateChannel.onUpdate(data => {
      const newSnapshot = parseStateFromChannel(data);
      if (!newSnapshot || !newSnapshot.initialized) return;

      if (newSnapshot.guestClientId) {
        roomEverHadTwoPlayers = true;
      }

      if (isValidGameState(newSnapshot)) {
        if (newSnapshot.revision >= localState.revision) {
          localState = newSnapshot;
          if (newSnapshot.guestClientId === myClientId) {
            myPlayerRole = 2;
          }
          render();
          if (localState.gameOver && localState.outcome) {
            showWin(localState.outcome);
          } else {
            hideWin();
          }
        }
      }

      // Guest sends join request if not seated yet
      if (!isHost && !localState.guestClientId) {
        maybeSendJoinRequest(newSnapshot);
      }
    });

    // Subscribe to commandChannel updates (Host processes commands)
    if (isHost) {
      commandChannel.onUpdate(commands => {
        hostCheckAndProcessCommands(commands);
      });
      // Initial sweep
      hostCheckAndProcessCommands(commandChannel.getData());
    }

    // Subscribe to responseChannel updates (Guest tracks response for pending commands)
    responseChannel.onUpdate(responses => {
      if (!pendingCommandId || !responses) return;
      const res = responses[pendingCommandId];
      if (res) {
        pendingCommandId = null;
        if (!res.accepted) {
          alert(`Yêu cầu bị từ chối: ${res.error || res.code}`);
        }
        render();
      }
    });

    // If Guest, check if snapshot is already available
    if (!isHost) {
      const currentSnap = parseStateFromChannel(stateChannel.getData());
      if (currentSnap && currentSnap.initialized && !currentSnap.guestClientId) {
        maybeSendJoinRequest(currentSnap);
      }
    }

    render();
  } catch (err) {
    console.error('Lỗi khởi tạo phòng:', err);
    setConnectionStatus(`Không thể khởi tạo kết nối phòng: ${err.message || err}`, 'error');
  }
}

/* ============================================================
   STARTUP
   ============================================================ */
buildLabels();
render();

if (isOnlineMode) {
  initOnlineSession();
}
