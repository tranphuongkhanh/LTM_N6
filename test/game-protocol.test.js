import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../game-logic.js';
import {
  processAuthoritativeCommand,
  HostCommandLedger,
  validateCommandEnvelope,
  playerForClient
} from '../game-protocol.js';

function createTestRoomState() {
  const base = createInitialState('match-1');
  return {
    ...base,
    roomId: 'room-1',
    initialized: true,
    hostClientId: 'host-client-123',
    guestClientId: null
  };
}

test('Tra cứu vai trò playerForClient', () => {
  const state = createTestRoomState();
  state.guestClientId = 'guest-client-456';
  assert.equal(playerForClient(state, 'host-client-123'), 1);
  assert.equal(playerForClient(state, 'guest-client-456'), 2);
  assert.equal(playerForClient(state, 'stranger-999'), null);
});

test('Validate command envelope: từ chối các trường thiếu hoặc sai định dạng', () => {
  assert.match(validateCommandEnvelope(null), /không hợp lệ/);
  assert.match(validateCommandEnvelope({}), /Mã lệnh không hợp lệ/);
  assert.match(
    validateCommandEnvelope({ commandId: 'c1', clientId: 'client-1' }),
    /Mã lệnh không hợp lệ/ // ngắn hơn 8 ký tự
  );
  assert.match(
    validateCommandEnvelope({
      commandId: 'cmd-valid-123',
      clientId: 'client-valid-123',
      matchId: 'match-1',
      expectedRevision: -1,
      kind: 'move'
    }),
    /Revision không hợp lệ/
  );
  assert.equal(
    validateCommandEnvelope({
      commandId: 'cmd-valid-123',
      clientId: 'client-valid-123',
      matchId: 'match-1',
      expectedRevision: 0,
      kind: 'move'
    }),
    null
  );
});

test('Xử lý nhận ghế: Host là Đỏ, Khách đầu tiên là Xanh, từ chối người thứ 3', () => {
  let state = createTestRoomState();
  const ledger = new HostCommandLedger();

  // Host không được join lại vào ghế khách
  const hostJoin = ledger.process(state, {
    commandId: 'cmd-join-host-01',
    clientId: 'host-client-123',
    matchId: 'match-1',
    expectedRevision: 0,
    kind: 'join'
  });
  assert.equal(hostJoin.response.accepted, false);
  assert.equal(hostJoin.response.code, 'host-cannot-join');

  // Khách 1 gửi yêu cầu join hợp lệ
  const guest1Join = ledger.process(state, {
    commandId: 'cmd-join-guest1-01',
    clientId: 'guest-client-456',
    matchId: 'match-1',
    expectedRevision: 0,
    kind: 'join'
  });
  assert.equal(guest1Join.response.accepted, true);
  assert.equal(guest1Join.response.player, 2);
  state = guest1Join.state;
  assert.equal(state.guestClientId, 'guest-client-456');
  assert.equal(state.revision, 1);

  // Khách 2 gửi yêu cầu join khi phòng đã đủ 2 người -> từ chối
  const guest2Join = ledger.process(state, {
    commandId: 'cmd-join-guest2-01',
    clientId: 'guest-client-789',
    matchId: 'match-1',
    expectedRevision: 1,
    kind: 'join'
  });
  assert.equal(guest2Join.response.accepted, false);
  assert.equal(guest2Join.response.code, 'room-full');
});

test('Từ chối nước đi khi chưa đủ 2 người chơi', () => {
  const state = createTestRoomState(); // guestClientId is null
  const ledger = new HostCommandLedger();

  const moveRes = ledger.process(state, {
    commandId: 'cmd-move-solo-01',
    clientId: 'host-client-123',
    matchId: 'match-1',
    expectedRevision: 0,
    kind: 'move',
    from: { r: 7, c: 0 },
    to: { r: 6, c: 0 }
  });
  assert.equal(moveRes.response.accepted, false);
  assert.equal(moveRes.response.code, 'waiting-for-player');
});

test('Xử lý nước đi hợp lệ tuần tự và cập nhật revision', () => {
  let state = createTestRoomState();
  state.guestClientId = 'guest-client-456';
  state.revision = 1;
  const ledger = new HostCommandLedger();

  // Đỏ (host) đi từ (7,0) lên (6,0)
  const move1 = ledger.process(state, {
    commandId: 'cmd-move-p1-0001',
    clientId: 'host-client-123',
    matchId: 'match-1',
    expectedRevision: 1,
    kind: 'move',
    from: { r: 7, c: 0 },
    to: { r: 6, c: 0 }
  });
  assert.equal(move1.response.accepted, true);
  assert.equal(move1.response.code, 'move-applied');
  state = move1.state;
  assert.equal(state.revision, 2);
  assert.equal(state.currentPlayer, 2); // Chuyển lượt sang Xanh

  // Xanh (guest) đi từ (1,0) xuống (2,0)
  const move2 = ledger.process(state, {
    commandId: 'cmd-move-p2-0001',
    clientId: 'guest-client-456',
    matchId: 'match-1',
    expectedRevision: 2,
    kind: 'move',
    from: { r: 1, c: 0 },
    to: { r: 2, c: 0 }
  });
  assert.equal(move2.response.accepted, true);
  state = move2.state;
  assert.equal(state.revision, 3);
  assert.equal(state.currentPlayer, 1); // Chuyển lượt lại cho Đỏ
});

test('Từ chối revision cũ (stale revision) và lệnh sai lượt', () => {
  let state = createTestRoomState();
  state.guestClientId = 'guest-client-456';
  state.revision = 5;
  const ledger = new HostCommandLedger();

  // Gửi với revision 4 < 5 -> stale
  const stale = ledger.process(state, {
    commandId: 'cmd-stale-00001',
    clientId: 'host-client-123',
    matchId: 'match-1',
    expectedRevision: 4,
    kind: 'move',
    from: { r: 7, c: 0 },
    to: { r: 6, c: 0 }
  });
  assert.equal(stale.response.accepted, false);
  assert.equal(stale.response.code, 'stale-revision');

  // Đang lượt Đỏ (1), Xanh (guest) gửi nước đi -> illegal-move
  const wrongTurn = ledger.process(state, {
    commandId: 'cmd-wrongturn-1',
    clientId: 'guest-client-456',
    matchId: 'match-1',
    expectedRevision: 5,
    kind: 'move',
    from: { r: 1, c: 0 },
    to: { r: 2, c: 0 }
  });
  assert.equal(wrongTurn.response.accepted, false);
  assert.equal(wrongTurn.response.code, 'illegal-move');
});

test('Chống gửi lặp lệnh (idempotency): cùng commandId chỉ xử lý 1 lần, lần sau trả kết quả cũ', () => {
  let state = createTestRoomState();
  state.guestClientId = 'guest-client-456';
  state.revision = 1;
  const ledger = new HostCommandLedger();

  const command = {
    commandId: 'cmd-unique-0001',
    clientId: 'host-client-123',
    matchId: 'match-1',
    expectedRevision: 1,
    kind: 'move',
    from: { r: 7, c: 0 },
    to: { r: 6, c: 0 }
  };

  const res1 = ledger.process(state, command);
  assert.equal(res1.duplicate, false);
  assert.equal(res1.response.accepted, true);
  state = res1.state;

  // Gửi lại y hệt
  const res2 = ledger.process(state, command);
  assert.equal(res2.duplicate, true);
  assert.equal(res2.response.accepted, true);
  assert.equal(res2.state, state); // State không bị apply lần 2

  // Gửi cùng commandId nhưng sửa payload -> conflict
  const resConflict = ledger.process(state, {
    ...command,
    to: { r: 6, c: 1 }
  });
  assert.equal(resConflict.response.accepted, false);
  assert.equal(resConflict.response.code, 'command-id-conflict');
});

test('processAuthoritativeCommand trực tiếp', () => {
  const state = createTestRoomState();
  state.guestClientId = 'guest-client-456';
  const directRes = processAuthoritativeCommand(state, {
    commandId: 'cmd-direct-001',
    clientId: 'host-client-123',
    matchId: 'match-1',
    expectedRevision: 0,
    kind: 'move',
    from: { r: 7, c: 0 },
    to: { r: 6, c: 0 }
  });
  assert.equal(directRes.response.accepted, true);
});
