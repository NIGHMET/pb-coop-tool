// Authored protocol fixture: real native peer connections, a local signalling
// bus, and the observed larger-slot-offers / bye-drops-one-link contract.
export function createRoom(slot) {
  const me = slot === 0 ? 'left' : 'right', other = slot === 0 ? 'right' : 'left';
  const members = [{ id: 'left', slot: 0, name: 'Left' }, { id: 'right', slot: 1, name: 'Right' }];
  const bus = new BroadcastChannel('coop-browser-regression');
  const calls = { offers: 0, resets: 0, leaves: 0, messages: [] };
  let room;
  const send = (id, kind, data) => { if (kind === 'bye') calls.resets++; bus.postMessage({ from: me, to: id, kind, data }); };
  class Link {
    constructor(id, offerer) {
      Object.assign(this, { id, offerer, state: 'connecting', rtt: 0, relayed: false, lag: 0, lastRx: performance.now() });
      this.pc = new RTCPeerConnection({ iceServers: [] });
      this.ctl = this.pc.createDataChannel('ctl', { negotiated: true, id: 0 });
      this.snap = this.pc.createDataChannel('snap', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
      for (const channel of [this.ctl, this.snap]) {
        channel.onopen = () => { if (this.ctl.readyState === 'open' && this.snap.readyState === 'open') this.state = 'open'; };
        channel.onmessage = event => { this.lastRx = performance.now(); if (event.data !== 'heartbeat') calls.messages.push(event.data); };
      }
      this.heartbeat = setInterval(() => { if (this.ctl.readyState === 'open') this.ctl.send('heartbeat'); }, 500);
      if (offerer) void this.offer();
    }
    get idle() { return (performance.now() - this.lastRx) / 1000; }
    get backlog() { return this.ctl.bufferedAmount; }
    async gathered() {
      if (this.pc.iceGatheringState === 'complete') return;
      await new Promise(resolve => { this.pc.addEventListener('icegatheringstatechange', function done() {
        if (this.iceGatheringState === 'complete') { this.removeEventListener('icegatheringstatechange', done); resolve(); }
      }); });
    }
    async offer() {
      calls.offers++;
      await this.pc.setLocalDescription(await this.pc.createOffer()); await this.gathered();
      if (this.state !== 'closed') mesh.ev.signal(this.id, 'offer', this.pc.localDescription.sdp);
    }
    async signal(kind, data) {
      if (kind === 'offer') {
        await this.pc.setRemoteDescription({ type: 'offer', sdp: data });
        await this.pc.setLocalDescription(await this.pc.createAnswer()); await this.gathered();
        if (this.state !== 'closed') mesh.ev.signal(this.id, 'answer', this.pc.localDescription.sdp);
      } else if (this.pc.signalingState === 'have-local-offer') await this.pc.setRemoteDescription({ type: 'answer', sdp: data });
    }
    close() { this.state = 'closed'; clearInterval(this.heartbeat); this.pc.close(); }
  }
  const mesh = {
    me, members, links: new Map(), tries: new Map(), autoRetry: 2, ice: [], ev: { signal: send },
    link(id, offerer) { const link = new Link(id, offerer); this.links.set(id, link); return link; },
    state(id) { return this.links.get(id)?.state ?? 'connecting'; },
    relayed() { return false; },
    sync() { if (slot > 0 && !this.links.has(other)) this.link(other, true); },
    onSignal(from, kind, data) {
      let link = this.links.get(from);
      if (kind === 'bye') { link?.close(); this.links.delete(from); return; }
      if (kind === 'offer') { link?.close(); this.links.delete(from); link = null; }
      if (!link && kind === 'offer') link = this.link(from, false);
      void link?.signal(kind, data).catch(error => calls.messages.push('ERROR:' + error.message));
    },
  };
  room = { me, mesh, alive: true, code: 'TEST', members, others: members.filter(m => m.id !== me), inRun: true,
    isHost: slot === 0, retryLink() { throw Error('Fixture intentionally has no remaining native retry budget'); },
    schedule() {}, onHide() { calls.leaves++; }, calls,
  };
  addEventListener('pagehide', room.onHide);
  bus.onmessage = async ({ data }) => {
    if (data.to !== me) return;
    try {
      mesh.onSignal(data.from, data.kind, data.data);
      mesh.sync();
    } catch (error) { calls.messages.push('ERROR:' + error.message); }
  };
  mesh.sync();
  window.testApp.coopRoom = room;
  return room;
}
