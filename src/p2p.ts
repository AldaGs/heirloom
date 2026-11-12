// Device-to-device link: WebRTC data channel, paired by exchanging two codes (offer, answer) — no signalling server.
// The codes carry each side's DTLS fingerprint, so the pairing authenticates the encrypted link end to end.

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }; // only reveals IP addresses; same-Wi-Fi works without it

async function pack(kind: 'O' | 'A', sdp: string) {
  const z = new Blob([sdp]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const b = new Uint8Array(await new Response(z).arrayBuffer());
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  return `HL${kind}.` + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpack(code: string, kind: 'O' | 'A') {
  const m = code.trim().match(/^HL([OA])\.([\w-]+)$/);
  if (!m) throw new Error('That isn\'t a Heirloom pairing code');
  if (m[1] !== kind) throw new Error(kind === 'O' ? 'This is a reply code — enter it on the device that started pairing' : 'This is a start code — enter it on the other device');
  const bin = atob(m[2].replace(/-/g, '+').replace(/_/g, '/'));
  const z = new Blob([Uint8Array.from(bin, c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(z).text();
}
const gathered = (pc: RTCPeerConnection) => new Promise<void>(res => {
  if (pc.iceGatheringState === 'complete') return res();
  pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && res());
  setTimeout(res, 4000); // enough candidates by now; don't hang on a slow STUN
});
const opened = (dc: RTCDataChannel) => new Promise<RTCDataChannel>((res, rej) => {
  if (dc.readyState === 'open') return res(dc);
  dc.onopen = () => res(dc); dc.onerror = () => rej(new Error('Connection failed'));
});

/** Device A: make the first code; later feed it the reply code from device B. */
export async function host() {
  const pc = new RTCPeerConnection(ICE), dc = pc.createDataChannel('heirloom', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer()); await gathered(pc);
  return {
    pc, code: await pack('O', pc.localDescription!.sdp),
    async finish(answer: string) { await pc.setRemoteDescription({ type: 'answer', sdp: await unpack(answer, 'A') }); return new Link(await opened(dc), pc); },
  };
}
/** Device B: take A's code, make the reply code; the link opens once A enters it. */
export async function join(offer: string) {
  const pc = new RTCPeerConnection(ICE);
  const ch = new Promise<RTCDataChannel>(res => { pc.ondatachannel = e => res(e.channel); });
  await pc.setRemoteDescription({ type: 'offer', sdp: await unpack(offer, 'O') });
  await pc.setLocalDescription(await pc.createAnswer()); await gathered(pc);
  return { pc, code: await pack('A', pc.localDescription!.sdp), link: ch.then(opened).then(dc => new Link(dc, pc)) };
}

/** JSON messages over the channel, chunked (≤ 60 KB per frame) with back-pressure. */
export class Link {
  private parts = new Map<string, string[]>();
  // messages that arrive before anyone listens (the sync code loads lazily) are queued, never dropped
  private queue: unknown[] = [];
  private handler?: (m: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  set onmessage(f: (m: any) => void) { this.handler = f; const q = this.queue; this.queue = []; q.forEach(m => f(m)); } // eslint-disable-line @typescript-eslint/no-explicit-any
  private deliver(m: unknown) { if (this.handler) this.handler(m); else this.queue.push(m); }
  onclose: () => void = () => {};
  constructor(private dc: RTCDataChannel, private pc: RTCPeerConnection) {
    dc.bufferedAmountLowThreshold = 1 << 20;
    dc.onmessage = e => {
      const f = JSON.parse(e.data as string) as { id: string; i: number; n: number; s: string };
      const arr = this.parts.get(f.id) ?? Array(f.n); arr[f.i] = f.s; this.parts.set(f.id, arr);
      if (arr.filter(x => x !== undefined).length === f.n) { this.parts.delete(f.id); this.deliver(JSON.parse(arr.join(''))); }
    };
    dc.onclose = () => this.onclose();
  }
  async send(m: unknown) {
    const s = JSON.stringify(m), id = crypto.randomUUID(), CH = 60_000, n = Math.max(1, Math.ceil(s.length / CH));
    for (let i = 0; i < n; i++) {
      if (this.dc.bufferedAmount > 4 << 20) await new Promise(r => this.dc.addEventListener('bufferedamountlow', r, { once: true }));
      this.dc.send(JSON.stringify({ id, i, n, s: s.slice(i * CH, (i + 1) * CH) }));
    }
  }
  close() { this.dc.close(); this.pc.close(); }
}
