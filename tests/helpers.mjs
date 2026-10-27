import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../pb-coop-fix.user.js', import.meta.url), 'utf8');

export function environment({ moduleURL = null } = {}) {
  let now = 20000, next = 0;
  const tasks = new Map();
  const timers = {
    setTimeout(fn, ms) { const id = ++next; tasks.set(id, { fn, at: now + ms, interval: 0 }); return id; },
    setInterval(fn, ms) { const id = ++next; tasks.set(id, { fn, at: now + ms, interval: ms }); return id; },
    clearTimeout(id) { tasks.delete(id); }, clearInterval(id) { tasks.delete(id); },
  };
  const calls = { signal: [], schedule: [], leave: 0, fetch: [], retry: 0, links: 0, clipboard: '' };
  class PC extends EventTarget {
    constructor(config = {}) { super(); this.config = config; this.connectionState = 'new'; }
    getConfiguration() { return this.config; }
    setConfiguration(config) { this.config = config; }
    async getStats() { return new Map(); }
    close() { this.connectionState = 'closed'; }
  }
  class Link {
    constructor(id, offerer, ice) {
      Object.assign(this, { id, offerer, state: 'connecting', idle: 0, lag: 0, rtt: 80, relayed: false, backlog: 0 });
      this.pc = new w.RTCPeerConnection({ iceServers: ice });
    }
    close() { this.state = 'closed'; this.pc.close(); }
    fail() { if (this.state !== 'closed') { this.state = 'failed'; room.mesh.ev.state(this.id, 'failed'); } }
  }
  class Mesh {
    constructor() {
      this.me = 'self'; this.members = [{ id: 'self', slot: 0 }, { id: 'peer', name: 'Peer', slot: 1 }];
      this.links = new Map(); this.tries = new Map(); this.autoRetry = 2; this.ice = [{ urls: 'stun:example.org' }];
      this.ev = { signal: (id, kind, data) => calls.signal.push([kind, id, data]) };
      this.ev.state = (id, state) => {
        if (state === 'open') this.tries.delete(id);
        if (state !== 'failed') return;
        const tries = this.tries.get(id) ?? 0;
        if (tries < this.autoRetry) {
          this.tries.set(id, tries + 1);
          if (this.links.get(id)?.offerer) w.setTimeout(() => {
            if (this.links.get(id)?.state === 'failed') this.retry(id, this.members, true);
          }, 1500);
        } else this.tries.set(id, this.autoRetry + 1);
      };
    }
    link(id, offerer) { calls.links++; const link = new Link(id, offerer, this.ice); this.links.set(id, link); if (offerer) calls.signal.push(['offer', id]); return link; }
    retry(id, members, force = false) {
      calls.retry++; if (!force) this.tries.set(id, 1);
      const link = this.links.get(id); if (!link) return; link.close(); this.links.delete(id);
      const me = members.find(m => m.id === this.me), peer = members.find(m => m.id === id);
      if (me && peer && me.slot > peer.slot) this.link(id, true); else calls.signal.push(['bye', id]);
    }
    state(id) { return this.links.get(id)?.state ?? 'connecting'; }
    idle(id) { return this.links.get(id)?.idle ?? 0; }
    relayed(id) { return this.links.get(id)?.relayed ?? false; }
    backlog(id) { return this.links.get(id)?.backlog ?? 0; }
  }
  class Room {
    constructor() {
      this.me = 'self'; this.alive = true; this.inRun = false; this.code = 'TEST';
      this.mesh = new Mesh(); this.acc = {}; this.room = { code: this.code, members: this.mesh.members };
      this.onHide = () => { if (this.alive) calls.leave++; }; w.addEventListener('pagehide', this.onHide);
      this.backend = { coopIce: async () => ({ servers: [{ urls: 'turn:fresh.example.org', username: 'temporary', credential: 'temporary' }] }) };
    }
    get others() { return this.room.members.filter(m => m.id !== this.me); }
    get isHost() { return true; }
    retryLink(id) { this.mesh.retry(id, this.room.members); this.schedule(700); }
    schedule(ms = 60000) { calls.schedule.push(ms); this.nextPollAt = now + ms; }
    hurryPoll() { if (this.inRun && this.others.some(m => this.mesh.state(m.id) !== 'open')) this.schedule(700); }
  }
  function element(tag = 'div') {
    const node = new EventTarget(); Object.assign(node, { tagName: tag.toUpperCase(), children: [], style: {}, dataset: {}, textContent: '', className: '' });
    node.append = (...children) => node.children.push(...children); node.remove = () => { node.removed = true; };
    node.setAttribute = (k, v) => { node[k] = v; }; node.getBoundingClientRect = () => ({ left: 0, top: 0 }); return node;
  }
  const document = new EventTarget();
  Object.assign(document, { readyState: 'complete', head: element('head'), body: element('body'), createElement: element });
  document.querySelectorAll = () => moduleURL ? [{ href: moduleURL }] : [];
  const storage = new Map(), w = new EventTarget();
  Object.assign(w, timers, { document, performance: { now: () => now }, console, URL, Map, Set, Array, Object, Promise, JSON, Math, String, Number, Error, RegExp, Event, EventTarget,
    Date: class extends Date { static now() { return now; } }, navigator: { userAgent: 'regression-test', clipboard: { writeText: async text => { calls.clipboard = text; } } },
    location: { href: 'https://pokebonk.com/coop/TEST', pathname: '/coop/TEST', origin: 'https://pokebonk.com' }, innerWidth: 1000, innerHeight: 800,
    Headers, Response, Request, RTCPeerConnection: PC,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, val) },
    fetch: async (...args) => { calls.fetch.push(args); return new Response('{}'); },
  });
  w.window = w; w.self = w;
  const room = new Room(); room.mesh.link('peer', false); w.ctx = { room };
  const originals = { fetch: w.fetch, pc: w.RTCPeerConnection, schedule: Room.prototype.schedule, retry: Mesh.prototype.retry, relayed: Mesh.prototype.relayed, hide: room.onHide };
  let importer = null;
  const context = vm.createContext(w);
  const script = new vm.Script(source, { filename: 'pb-coop-fix.user.js', importModuleDynamically: async spec => {
    if (!importer) throw Error('No module importer configured'); return importer(spec);
  } });
  function advance(ms) {
    const end = now + ms;
    for (let count = 0; count < 1000; count++) {
      const due = [...tasks].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) { now = end; return; }
      const [id, task] = due; now = task.at;
      if (task.interval) task.at += task.interval; else tasks.delete(id); task.fn();
    }
    throw Error('Timer loop');
  }
  return { w, room, calls, originals, PC, Room, Mesh, tasks, advance, load() { script.runInContext(context); return w.__pbCoopFix; }, setImporter(fn) { importer = fn; } };
}
