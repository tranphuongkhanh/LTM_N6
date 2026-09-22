import { applyMove } from './game-logic.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

function reject(code, error, revision) {
  return { accepted: false, code, error, revision };
}

function commandSignature(command) {
  return JSON.stringify({
    kind: command.kind,
    clientId: command.clientId,
    matchId: command.matchId,
    expectedRevision: command.expectedRevision,
    from: command.from ?? null,
    to: command.to ?? null
  });
}

export function validateCommandEnvelope(command) {
  if (!command || typeof command !== 'object') return 'Lệnh không hợp lệ.';
  if (!ID_PATTERN.test(command.commandId ?? '')) return 'Mã lệnh không hợp lệ.';
  if (!ID_PATTERN.test(command.clientId ?? '')) return 'Mã client không hợp lệ.';
  if (typeof command.matchId !== 'string' || command.matchId.length > 100) return 'Mã ván không hợp lệ.';
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 0) return 'Revision không hợp lệ.';
  if (!['join', 'move'].includes(command.kind)) return 'Loại lệnh không hợp lệ.';
  return null;
}

export function playerForClient(state, clientId) {
  if (state.hostClientId === clientId) return 1;
  if (state.guestClientId === clientId) return 2;
  return null;
}

export function processAuthoritativeCommand(state, command) {
  const envelopeError = validateCommandEnvelope(command);
  if (envelopeError) {
    return { state, response: reject('invalid-command', envelopeError, state.revision) };
  }
  if (!state.initialized || command.matchId !== state.matchId) {
    return { state, response: reject('wrong-match', 'Lệnh không thuộc ván hiện tại.', state.revision) };
  }

  if (command.kind === 'join') {
    if (command.clientId === state.hostClientId) {
      return { state, response: reject('host-cannot-join', 'Chủ phòng đã giữ ghế Đỏ.', state.revision) };
    }
    if (state.guestClientId === command.clientId) {
      return { state, response: { accepted: true, code: 'already-seated', revision: state.revision, player: 2 } };
    }
    if (state.guestClientId) {
      return { state, response: reject('room-full', 'Phòng đã đủ hai người.', state.revision) };
    }
    if (command.expectedRevision !== state.revision) {
      return { state, response: reject('stale-revision', 'Phòng đã thay đổi; hãy thử vào lại.', state.revision) };
    }

    const next = { ...state, guestClientId: command.clientId, revision: state.revision + 1 };
    return {
      state: next,
      response: { accepted: true, code: 'seat-assigned', revision: next.revision, player: 2 }
    };
  }

  if (command.expectedRevision !== state.revision) {
    return { state, response: reject('stale-revision', 'Nước đi dùng revision cũ.', state.revision) };
  }

  const player = playerForClient(state, command.clientId);
  if (!player) {
    return { state, response: reject('not-seated', 'Client chưa có ghế trong phòng.', state.revision) };
  }
  if (!state.guestClientId) {
    return { state, response: reject('waiting-for-player', 'Chưa đủ hai người chơi.', state.revision) };
  }

  const applied = applyMove(state, player, command.from, command.to);
  if (!applied.ok) {
    return { state, response: reject('illegal-move', applied.error, state.revision) };
  }

  const next = {
    ...state,
    ...applied.state,
    roomId: state.roomId,
    initialized: true,
    hostClientId: state.hostClientId,
    guestClientId: state.guestClientId
  };
  return {
    state: next,
    response: { accepted: true, code: 'move-applied', revision: next.revision }
  };
}

export class HostCommandLedger {
  constructor() {
    this.processed = new Map();
  }

  process(state, command) {
    const previous = this.processed.get(command?.commandId);
    const signature = commandSignature(command ?? {});
    if (previous) {
      if (previous.signature !== signature) {
        return {
          state,
          response: reject('command-id-conflict', 'commandId đã được dùng cho lệnh khác.', state.revision),
          duplicate: true
        };
      }
      return { state, response: { ...previous.response, duplicate: true }, duplicate: true };
    }

    const result = processAuthoritativeCommand(state, command);
    if (command?.commandId) {
      this.processed.set(command.commandId, { signature, response: result.response });
    }
    return { ...result, duplicate: false };
  }
}
