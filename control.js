const els = {
  channel: document.getElementById('channel'),
  terms: document.getElementById('terms'),
  connect: document.getElementById('connectBtn'),
  disconnect: document.getElementById('disconnectBtn'),
  reset: document.getElementById('resetBtn'),
  status: document.getElementById('status')
};

const saveSettings = () => {
  localStorage.setItem('tcc_ctrl', JSON.stringify({
    channel: els.channel.value.trim(),
    terms: els.terms.value.trim()
  }));
};
const loadSettings = () => {
  try {
    const s = JSON.parse(localStorage.getItem('tcc_ctrl') || '{}');
    if (s.channel) els.channel.value = s.channel;
    if (s.terms) els.terms.value = s.terms;
  } catch {}
};
loadSettings();

els.connect.addEventListener('click', () => {
  const channel = els.channel.value.trim();
  const terms = els.terms.value.trim();
  if (!channel) { alert('Укажи channel'); return; }
  saveSettings();
  window.api.send('connect', { channel, terms });
  els.connect.disabled = true;
  els.disconnect.disabled = false;
});
els.disconnect.addEventListener('click', () => {
  window.api.send('disconnect');
  els.connect.disabled = false;
  els.disconnect.disabled = true;
});
els.reset.addEventListener('click', () => window.api.send('reset'));

els.channel.addEventListener('change', () => {
  saveSettings();
  window.api.send('update-terms', { channel: els.channel.value.trim(), terms: els.terms.value.trim() });
});
els.terms.addEventListener('change', () => {
  saveSettings();
  window.api.send('update-terms', { channel: els.channel.value.trim(), terms: els.terms.value.trim() });
});

const unsub = window.api.on('status', (s) => {
  els.status.textContent = s;
});
window.addEventListener('beforeunload', () => { if (typeof unsub === 'function') unsub(); });
