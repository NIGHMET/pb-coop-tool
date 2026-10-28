import test from 'node:test';
import assert from 'node:assert/strict';
import { environment } from './helpers.mjs';

test('manual recovery preserves offer ownership and requests remote reset only when answering', () => {
  for (const [selfSlot, peerSlot, expected] of [[0, 1, false], [2, 1, true]]) {
    const e = environment(); const api = e.load(); e.advance(1200);
    e.room.mesh.members[0].slot = selfSlot; e.room.mesh.members[1].slot = peerSlot;
    e.room.mesh.links.get('peer').state = 'failed'; e.room.mesh.tries.set('peer', 3); api.repairNow();
    assert.equal(e.room.mesh.links.get('peer').offerer, expected);
    assert.equal(e.calls.signal.filter(([kind]) => kind === 'bye').length, expected ? 0 : 1); api.dispose();
  }
});
test('recovery bypasses native retry but sends one peer reset for the answering side', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  e.room.mesh.links.get('peer').state = 'failed'; e.room.mesh.tries.set('peer', 1); api.repairNow();
  assert.equal(e.calls.retry, 0);
  assert.equal(e.calls.signal.filter(([kind]) => kind === 'bye').length, 1);
  assert.ok(e.room.mesh.links.has('peer')); api.dispose();
});
test('a rebuilt connection can reopen and keep collecting statistics', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  e.room.mesh.links.get('peer').state = 'failed'; e.room.mesh.tries.set('peer', 3); api.repairNow();
  e.room.mesh.links.get('peer').state = 'open'; e.advance(3000);
  assert.equal(api.events.filter(x => /tick.*出错/.test(x.text)).length, 0); api.dispose();
});
test('background toggle replaces the registered listener and disposal restores it', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  e.w.dispatchEvent(new Event('pagehide')); assert.equal(e.calls.leave, 1);
  api.cfg.noLeaveOnHide = true; e.w.dispatchEvent(new Event('pagehide')); assert.equal(e.calls.leave, 1);
  api.dispose(); e.w.dispatchEvent(new Event('pagehide')); assert.equal(e.calls.leave, 2);
});
test('fresh TURN credentials reach the mesh and subsequent connections', async () => {
  const e = environment(); const api = e.load(); e.advance(1200); await api.refreshIce();
  assert.equal(e.room.mesh.ice[0].urls, 'turn:fresh.example.org');
  assert.equal(e.room.mesh.link('next', true).pc.getConfiguration().iceServers[0].urls, 'turn:fresh.example.org'); api.dispose();
});
test('IPv6 filtering reads candidate addresses and preserves listener removal', () => {
  const e = environment(); const api = e.load(); api.cfg.dropIPv6 = true;
  const pc = new e.w.RTCPeerConnection(); let received = 0; const listener = () => received++;
  pc.addEventListener('icecandidate', listener);
  const emit = address => { const event = new Event('icecandidate'); event.candidate = { address, type: 'host', candidate: `candidate:1 1 udp 1 ${address} 1234 typ host` }; pc.dispatchEvent(event); };
  emit('2001:db8::1'); emit('192.0.2.1'); assert.equal(received, 1);
  pc.removeEventListener('icecandidate', listener); emit('192.0.2.1'); assert.equal(received, 1); api.dispose();
});
test('disposal restores patched methods and allows reinjection', () => {
  const e = environment(); const api = e.load(); e.advance(1200); api.cfg.noRelayThrottle = true; e.advance(1000); api.dispose();
  assert.equal(e.Mesh.prototype.relayed, e.originals.relayed); assert.equal(e.Room.prototype.schedule, e.originals.schedule);
  assert.equal(e.Mesh.prototype.retry, e.originals.retry); assert.equal(e.room.onHide, e.originals.hide);
  assert.equal(e.w.fetch, e.originals.fetch); assert.equal(e.w.RTCPeerConnection, e.originals.pc);
  assert.equal(e.w.__pbCoopFix, undefined); assert.notEqual(e.load(), api);
});
test('ended rooms are released so a newly joined room is discovered', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  e.room.alive = false; const next = new e.Room(); e.w.ctx.room = next; e.advance(1000);
  assert.equal(api.stats.room, next); api.dispose();
});
test('automatic recovery stops after the attempt limit', () => {
  const e = environment(); const api = e.load(); e.advance(1200); e.room.mesh.tries.set('peer', 3);
  for (let i = 0; i < 8; i++) { e.room.mesh.links.get('peer').state = 'failed'; e.advance(31000); }
  assert.equal(api.stats.rebuilds, 5); api.dispose();
});
test('game discovery captures the running App without window.ctx', async () => {
  const url = 'https://pokebonk.com/assets/main-test-mvpt1dlr.js'; const e = environment({ moduleURL: url }); delete e.w.ctx;
  const module = await import('data:text/javascript,export class App { frameGap() { return 16; } }');
  e.setImporter(spec => { assert.equal(spec, url); return module; });
  const api = e.load(); e.w.dispatchEvent(new Event('pokebonk:modules-ready'));
  await new Promise(resolve => setImmediate(resolve));
  const app = new module.App(); app.coopRoom = e.room; assert.equal(app.frameGap(), 16);
  e.advance(1200); assert.equal(api.stats.room, e.room); api.dispose();
});

test('diagnostic export omits room codes, accounts, credentials and peer names', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  e.room.acc = { token: 'PRIVATE_TOKEN' }; e.room.code = 'SECRET_ROOM'; e.room.mesh.members[1].name = 'PRIVATE_NAME';
  e.room.mesh.ice = [{ urls: 'turn:private.example.org', credential: 'PRIVATE_ICE' }];
  const report = JSON.stringify(api.diagnostics());
  for (const secret of ['PRIVATE_TOKEN', 'SECRET_ROOM', 'PRIVATE_NAME', 'PRIVATE_ICE', 'private.example.org']) assert.equal(report.includes(secret), false);
  assert.ok(report.includes('connecting')); api.dispose();
});

test('experimental IPv6 filtering removes candidate lines from complete SDP', () => {
  const e = environment(); const api = e.load(); e.advance(1200); api.cfg.dropIPv6 = true;
  const sdp = 'v=0\r\na=candidate:1 1 udp 1 2001:db8::1 1234 typ host\r\na=candidate:2 1 udp 1 192.0.2.1 1234 typ host\r\n';
  e.room.mesh.ev.signal('peer', 'offer', sdp);
  assert.equal(e.calls.signal.at(-1)[2].includes('2001:db8'), false);
  assert.ok(e.calls.signal.at(-1)[2].includes('192.0.2.1')); api.dispose();
});

test('healthy connections and disabled recovery are not rebuilt', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  const link = e.room.mesh.links.get('peer'); link.state = 'open'; e.advance(60000);
  assert.equal(e.room.mesh.links.get('peer'), link); assert.equal(api.stats.rebuilds, 0);
  api.cfg.autoRepair = false; link.state = 'failed'; e.advance(60000);
  assert.equal(e.room.mesh.links.get('peer'), link); api.dispose();
});

test('an ended room is not left with a pagehide listener after disposal', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  const ended = e.room; ended.alive = false; api.dispose();
  ended.alive = true; e.w.dispatchEvent(new Event('pagehide')); assert.equal(e.calls.leave, 0);
});

test('native retries also stop after the five extra script attempts are exhausted', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  e.room.mesh.members[0].slot = 2;
  const link = e.room.mesh.link.bind(e.room.mesh);
  e.room.mesh.link = (id, offerer) => { const result = link(id, offerer); e.w.setTimeout(() => result.fail(), 2000); return result; };
  e.room.mesh.links.get('peer').fail(); e.advance(200000);
  const count = e.calls.links;
  assert.equal(api.stats.rebuilds, 5); assert.ok(e.calls.retry > 0);
  e.advance(200000); assert.equal(e.calls.links, count); api.dispose();
});

test('manual repair restores a missing link while the peer remains a room member', () => {
  for (const slot of [0, 2]) {
    const e = environment(); const api = e.load(); e.advance(1200);
    e.room.mesh.members[0].slot = slot;
    e.room.mesh.links.get('peer').close(); e.room.mesh.links.delete('peer');
    api.repairNow();
    assert.equal(e.room.mesh.links.get('peer')?.offerer, slot === 2);
    assert.equal(e.calls.signal.filter(([kind]) => kind === 'bye').length, slot === 0 ? 1 : 0);
    api.dispose();
  }
});

test('automatic missing-link recovery waits for a normal offer before requesting reset', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  e.room.mesh.links.get('peer').close(); e.room.mesh.links.delete('peer');
  e.advance(19000); assert.equal(api.stats.rebuilds, 0);
  e.advance(3000); assert.equal(api.stats.rebuilds, 1);
  assert.ok(e.room.mesh.links.has('peer')); api.dispose();
});

test('repair does not recreate links for peers who left the room', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  e.room.mesh.links.get('peer').close(); e.room.mesh.links.delete('peer');
  e.room.mesh.members.splice(1); api.repairNow(); e.advance(30000);
  assert.equal(api.stats.rebuilds, 0); api.dispose();
});

test('diagnostics retain missing peers and distinguish expected offer ownership from current role', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  e.room.mesh.members[0].slot = 2;
  e.room.mesh.links.get('peer').close(); e.room.mesh.links.delete('peer');
  const report = api.diagnostics();
  assert.equal(report.memberCount, 2); assert.equal(report.selfSlot, 2);
  assert.equal(report.peers.length, 1); assert.equal(report.peers[0].state, 'missing');
  assert.equal(report.peers[0].expectedOfferer, true); assert.equal(report.peers[0].offerer, null);
  assert.equal(report.peers[0].relayed, null); api.dispose();
});

test('diagnostics expose handshake states and candidate types without exposing SDP or addresses', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  const pc = e.room.mesh.links.get('peer').pc;
  Object.assign(pc, { connectionState: 'connecting', iceConnectionState: 'checking', iceGatheringState: 'complete', signalingState: 'stable',
    localDescription: { sdp: 'v=0\r\na=candidate:1 1 udp 1 192.0.2.99 1234 typ host\r\na=candidate:2 1 udp 1 198.51.100.1 1234 typ relay\r\n' },
    remoteDescription: { sdp: 'PRIVATE_REMOTE_SDP' } });
  const peer = api.diagnostics().peers[0];
  assert.equal(peer.iceState, 'checking'); assert.equal(peer.hasRemoteDescription, true);
  assert.equal(peer.localCandidates.host, 1); assert.equal(peer.localCandidates.relay, 1);
  const report = JSON.stringify(api.diagnostics());
  for (const value of ['192.0.2.99', '198.51.100.1', 'PRIVATE_REMOTE_SDP']) assert.equal(report.includes(value), false);
  api.dispose();
});

test('an old tagged answer cannot be applied to a newer local offer', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  const offer = () => {
    e.room.mesh.link('peer', true); e.room.mesh.ev.signal('peer', 'offer', 'v=0\r\n');
    const tag = e.calls.signal.at(-1)[2].match(/^a=x-pb-coop-offer:([^\r\n]+)/m)?.[1];
    assert.ok(tag, 'Offer must carry a negotiation reference'); return tag;
  };
  const old = offer(), current = offer(); assert.notEqual(old, current);
  e.room.mesh.onSignal('peer', 'answer', 'v=0\r\na=x-pb-coop-offer:' + old + '\r\n');
  assert.equal(e.calls.received.length, 0);
  e.room.mesh.onSignal('peer', 'answer', 'v=0\r\na=x-pb-coop-offer:' + current + '\r\n');
  assert.equal(e.calls.received.length, 1); assert.equal(e.calls.received[0].data, 'v=0\r\n'); api.dispose();
});

test('a reset for an older offer does not delete the newer link', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  e.room.mesh.ev.signal('peer', 'offer', 'v=0\r\n');
  const old = e.calls.signal.at(-1)[2].match(/^a=x-pb-coop-offer:([^\r\n]+)/m)?.[1];
  assert.ok(old); e.room.mesh.link('peer', true); e.room.mesh.ev.signal('peer', 'offer', 'v=0\r\n');
  const current = e.room.mesh.links.get('peer');
  e.room.mesh.onSignal('peer', 'bye', 'pb-coop-reset:' + old);
  assert.equal(e.room.mesh.links.get('peer'), current);
  e.room.mesh.onSignal('peer', 'bye', ''); assert.equal(e.room.mesh.links.has('peer'), false); api.dispose();
});

test('tagged offers are echoed in answers while untagged legacy answers remain accepted', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  e.room.mesh.onSignal('peer', 'offer', 'v=0\r\na=x-pb-coop-offer:known-offer-1\r\n');
  e.room.mesh.ev.signal('peer', 'answer', 'v=0\r\n');
  assert.ok(e.calls.signal.at(-1)[2].includes('a=x-pb-coop-offer:known-offer-1\r\n'));
  assert.equal(e.calls.received[0].data, 'v=0\r\n');
  e.room.mesh.onSignal('peer', 'answer', 'v=0\r\n'); assert.equal(e.calls.received.at(-1).kind, 'answer'); api.dispose();
});

test('signal POST responses do not overwrite the room polling diagnostic', async () => {
  const e = environment();
  e.w.fetch = async (url, init) => new Response(init?.method === 'POST' ? null : '{}', { status: init?.method === 'POST' ? 204 : 200 });
  const api = e.load();
  await e.w.fetch('https://api.pokebonk.com/coop/rooms/TEST?after=0');
  const poll = api.stats.poll;
  await e.w.fetch('https://api.pokebonk.com/coop/rooms/TEST/signal', { method: 'POST' });
  assert.equal(api.stats.poll, poll); api.dispose();
});

test('tagged old replies and resets are rejected while a new offer is still gathering', () => {
  const e = environment(); const api = e.load(); e.advance(1200);
  e.room.mesh.ev.signal('peer', 'offer', 'v=0\r\n');
  const old = e.calls.signal.at(-1)[2].match(/^a=x-pb-coop-offer:([^\r\n]+)/m)[1];
  const fresh = e.room.mesh.link('peer', true); // offer not signalled yet
  e.room.mesh.onSignal('peer', 'answer', 'v=0\r\na=x-pb-coop-offer:' + old + '\r\n');
  e.room.mesh.onSignal('peer', 'bye', 'pb-coop-reset:' + old);
  assert.equal(e.calls.received.length, 0); assert.equal(e.room.mesh.links.get('peer'), fresh);
  assert.equal(api.stats.staleSignalsDropped, 2); api.dispose();
});
