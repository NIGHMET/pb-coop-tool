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
