const WS_URL = 'wss://irc-ws.chat.twitch.tv:443';
let ws = null;
let joinedChannel = null;
let nick = null;

const counters = new Map();
const normToOrig = new Map();
const userAssignments = new Map();

let shouldReconnect = false;
let reconnectAttempt = 0;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const INACTIVITY_MS = 180000;
const CLIENT_PING_MS = 240000;
let inactivityTimer = null;
let clientPingTimer = null;

let currentChannel = '';
let currentTerms = '';

const els = {
  cards: document.getElementById('cards')
};

const setStatus = (text) => {
  window.api.send('status', text);
};
const normalize = (s) => s.trim().toLowerCase();

const buildTerms = (raw) => {
  counters.clear();
  normToOrig.clear();
  userAssignments.clear();

  const list = raw.split(',')
    .map(s => s.trim())
    .filter(Boolean);

  for (const t of list) {
    if (!counters.has(t)) counters.set(t, 0);
    normToOrig.set(normalize(t), t);
  }
  render();
};

const render = () => {
  const frag = document.createDocumentFragment();
  const entries = Array.from(counters.entries()).sort((a, b) => b[1] - a[1]);

  for (const [term, count] of entries) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
    <div class="term">
      <span class="chip" title="${term}">${term}</span>
    </div>
    <div class="count">${count}</div>
  `;
    frag.appendChild(card);
  }
  els.cards.replaceChildren(frag);
};

const resetCounters = () => {
  for (const k of counters.keys()) counters.set(k, 0);
  userAssignments.clear();
  render();
};

const safeDecrement = (orig) => {
  if (!counters.has(orig)) return;
  const cur = counters.get(orig) || 0;
  counters.set(orig, cur > 0 ? cur - 1 : 0);
};

const parseTags = (raw) => {
  if (!raw || raw[0] !== '@') return {};
  const end = raw.indexOf(' ');
  const tagStr = end === -1 ? raw.slice(1) : raw.slice(1, end);
  const out = {};
  for (const part of tagStr.split(';')) {
    const [k, v] = part.split('=');
    out[k] = v ?? '';
  }
  return out;
};
const parsePrivmsg = (line) => {
  let rest = line;
  let tags = {};
  if (rest[0] === '@') {
    const sp = rest.indexOf(' ');
    tags = parseTags(rest.slice(0, sp));
    rest = rest.slice(sp + 1);
  }
  let login = null;
  if (rest[0] === ':') {
    const sp = rest.indexOf(' ');
    const prefix = sp !== -1 ? rest.slice(1, sp) : rest.slice(1);
    const excl = prefix.indexOf('!');
    login = (excl !== -1 ? prefix.slice(0, excl) : prefix).toLowerCase();
    rest = sp !== -1 ? rest.slice(sp + 1) : '';
  }
  const colonIdx = rest.indexOf(' :');
  if (colonIdx === -1) return null;
  const msg = rest.slice(colonIdx + 2);

  const userId = tags['user-id'] ? tags['user-id'] : null;
  const userKey = (userId && userId.trim().length > 0) ? `id:${userId}` : (login ? `login:${login}` : null);

  if (!userKey) return { text: msg, userKey: null };
  return { text: msg, userKey };
};

const clearTimers = () => {
  if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
  if (clientPingTimer) { clearInterval(clientPingTimer); clientPingTimer = null; }
};
const kickInactivity = () => {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    safeReconnect('Inactivity watchdog');
  }, INACTIVITY_MS);
};
const startClientPing = () => {
  if (clientPingTimer) clearInterval(clientPingTimer);
  clientPingTimer = setInterval(() => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send('PING :keepalive');
      }
    } catch {}
  }, CLIENT_PING_MS);
};

const expBackoff = (attempt) => {
  const base = Math.min(RECONNECT_MIN_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
  const jitter = Math.floor(Math.random() * 1000);
  return base + jitter;
};
const scheduleReconnect = (reason) => {
  if (!shouldReconnect) return;
  const delay = expBackoff(reconnectAttempt++);
  setStatus(`Reconnecting in ${Math.round(delay / 1000)}s… (${reason})`);
  setTimeout(() => connect(true), delay);
};
const safeReconnect = (reason) => {
  if (ws) { try { ws.close(); } catch {} }
  scheduleReconnect(reason);
};

const connect = (isRetry = false) => {
  const channelInput = currentChannel.trim();
  const termsInput = currentTerms.trim();

  if (!channelInput) {
    setStatus('Channel is empty');
    return;
  }

  if (!isRetry) {
    buildTerms(termsInput);
    reconnectAttempt = 0;
  }

  shouldReconnect = true;
  nick = 'justinfan' + Math.floor(Math.random() * 1000000);

  clearTimers();
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.close(); } catch {}
  }

  ws = new WebSocket(WS_URL);
  setStatus(isRetry ? 'Reconnecting…' : 'Connecting…');

  ws.onopen = () => {
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');
    ws.send('PASS SCHMOOPIIE');
    ws.send(`NICK ${nick}`);

    const ch = `#${channelInput.toLowerCase()}`;
    ws.send(`JOIN ${ch}`);
    joinedChannel = ch;

    setStatus(`Connected as ${nick} → ${ch}`);
    kickInactivity();
    startClientPing();
    reconnectAttempt = 0;
  };

  ws.onmessage = (ev) => {
    const payload = String(ev.data);
    kickInactivity();

    if (payload.startsWith('PING')) {
      ws.send('PONG :tmi.twitch.tv');
      return;
    }
    if (payload.includes('\nRECONNECT') || payload === 'RECONNECT' || payload.startsWith('RECONNECT')) {
      safeReconnect('Server RECONNECT');
      return;
    }

    const lines = payload.split(/\r\n|\n/);
    for (const line of lines) {
      if (!line) continue;

      if (line.includes(' PRIVMSG ')) {
        const parsed = parsePrivmsg(line);
        if (!parsed) continue;
        const { text, userKey } = parsed;
        if (!text) continue;

        const normMsg = normalize(text.trim());
        const origOfMsg = normToOrig.get(normMsg);
        if (!origOfMsg) continue;
        if (!userKey) continue;

        const prevNorm = userAssignments.get(userKey);
        if (prevNorm === normMsg) continue;

        if (prevNorm) {
          const prevOrig = normToOrig.get(prevNorm);
          if (prevOrig) safeDecrement(prevOrig);
        }

        counters.set(origOfMsg, (counters.get(origOfMsg) || 0) + 1);
        userAssignments.set(userKey, normMsg);
        render();
      }

      if (line.includes(' PART ') && joinedChannel && line.endsWith(joinedChannel)) {
        setTimeout(() => { try { ws.send(`JOIN ${joinedChannel}`); } catch {} }, 1000);
      }
    }
  };

  ws.onerror = () => setStatus('Error (см. DevTools)');

  ws.onclose = () => {
    clearTimers();
    ws = null;
    if (shouldReconnect) {
      scheduleReconnect('Socket closed');
    } else {
      setStatus('Disconnected');
      joinedChannel = null;
    }
  };
};

const disconnect = () => {
  shouldReconnect = false;
  clearTimers();
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (joinedChannel) { try { ws.send(`PART ${joinedChannel}`); } catch {} }
    try { ws.close(); } catch {}
  }
  ws = null;
  joinedChannel = null;
  setStatus('Disconnected');
};

window.api.on('connect', ({ channel, terms }) => {
  currentChannel = channel || '';
  currentTerms = terms || '';
  connect(false);
});
window.api.on('disconnect', () => disconnect());
window.api.on('reset', () => resetCounters());
window.api.on('update-terms', ({ channel, terms }) => {
  currentChannel = channel || currentChannel;
  currentTerms = terms ?? currentTerms;
  buildTerms(currentTerms);
  setStatus('Terms updated');
});

window.addEventListener('online', () => {
  if (shouldReconnect) safeReconnect('Network online');
});
window.addEventListener('offline', () => {
  setStatus('Offline — waiting for network…');
});
