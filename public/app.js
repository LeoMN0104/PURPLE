const $ = (s) => document.querySelector(s);
const messages = $('#messages');
let history = [];
let busy = false;
let recognition = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function addMsg(role, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.innerHTML = `<div class="avatar">${role === 'ai' ? 'P' : 'U'}</div><div><small>${role === 'ai' ? 'P.U.R.P.L.E' : 'YOU'}</small><p>${escapeHtml(text).replace(/\n/g,'<br>')}</p></div>`;
  messages.appendChild(d);
  messages.scrollTop = messages.scrollHeight;
}

function trace(text) {
  const d = document.createElement('div');
  d.innerHTML = `<b>${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</b><span>${escapeHtml(text)}</span>`;
  $('#trace').prepend(d);
}

function audit(text) {
  const p = document.createElement('p');
  p.textContent = text;
  $('#audit').prepend(p);
}

async function send() {
  if (busy) return;
  const text = $('#input').value.trim();
  if (!text) return;
  $('#input').value = '';
  addMsg('user', text);
  history.push({role:'user', content:text});
  busy = true;
  $('#send').textContent = 'PROCESSING…';
  $('#coreMode').textContent = 'PROCESSING';
  const t = performance.now();
  try {
    const r = await fetch('/api/chat', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({messages:history, warnings:true, stepApproval:true})
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    addMsg('ai', data.text);
    history.push({role:'assistant', content:data.text});
    $('#latency').textContent = Math.round(performance.now() - t) + ' ms';
    trace('Response generated');
    audit('OpenAI: generated the assistant response' + (data.output?.some?.(x => x.type === 'web_search_call') ? ' and performed web search.' : '.'));
    if (data.output?.some?.(x => x.type === 'mcp_call')) audit('Composio MCP: external connector activity detected; approval remains required by default.');
    $('#gaugeValue').textContent = Math.floor(55 + Math.random()*40);
    $('#toolPct').textContent = Math.floor(40 + Math.random()*50) + '%';
    $('#toolBar').style.width = $('#toolPct').textContent;
  } catch (e) {
    addMsg('ai', 'I could not complete that request: ' + e.message);
    trace('Request error');
  } finally {
    busy = false;
    $('#send').textContent = 'SEND ↗';
    $('#coreMode').textContent = 'STANDBY • READY FOR INPUT';
  }
}

$('#send').onclick = send;
$('#input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

$('#mic').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { addMsg('ai','Voice input is not supported by this browser.'); return; }
  if (recognition) { recognition.stop(); return; }
  recognition = new SR();
  recognition.lang = navigator.language || 'es-ES';
  recognition.interimResults = false;
  recognition.onstart = () => { $('#mode').textContent='VOICE'; $('#mic').textContent='◉'; trace('Voice capture started'); };
  recognition.onresult = e => { $('#input').value=e.results[0][0].transcript; send(); };
  recognition.onerror = e => trace('Voice error: '+e.error);
  recognition.onend = () => { recognition=null; $('#mode').textContent='TEXT'; };
  recognition.start();
};

async function boot() {
  try {
    const r = await fetch('/api/status');
    const s = await r.json();
    $('#composioState').textContent = s.composio ? 'ACTIVE' : 'PENDING';
    $('#voiceState').textContent = s.elevenlabsBridge ? 'ACTIVE' : 'BRIDGE';
    trace('System online · ' + s.model);
  } catch { trace('Backend unavailable'); }
}

boot();
setInterval(() => $('#clock').textContent = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}), 1000);
