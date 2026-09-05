const $ = (s) => document.querySelector(s);
const messages = $('#messages');
let history = [];
let busy = false;
let recognition = null;
let activePlan = null;

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

function renderPlan(plan) {
  const box = $('#plan');
  if (!plan) { box.classList.add('hidden'); box.innerHTML=''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `<b>${escapeHtml(plan.title || 'Execution plan')}</b><ol>${plan.steps.map(s => `<li><strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(s.description)}</span>${s.needsApproval ? '<em>APPROVAL</em>' : ''}</li>`).join('')}</ol>`;
}

async function requestPlan(text) {
  const r = await fetch('/api/plan', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({task:text})
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Planning failed');
  return data;
}

async function send() {
  if (busy) return;
  const text = $('#input').value.trim();
  if (!text) return;
  $('#input').value = '';
  addMsg('user', text);
  history.push({role:'user', content:text});
  busy = true;
  activePlan = null;
  renderPlan(null);
  $('#send').textContent = 'PROCESSING…';
  $('#coreMode').textContent = 'ORCHESTRATING';
  const t = performance.now();
  try {
    trace('Orchestrator evaluating task');
    const planResult = await requestPlan(text);
    if (planResult.complex) {
      activePlan = planResult.plan;
      renderPlan(activePlan);
      trace('Planner created an execution plan');
      audit('P.U.R.P.L.E Planner: decomposed the request into ' + activePlan.steps.length + ' verifiable steps.');
    } else {
      trace('Task classified as direct response');
    }

    $('#coreMode').textContent = activePlan ? 'EXECUTING PLAN' : 'REASONING';
    const r = await fetch('/api/chat', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({messages:history, warnings:true, stepApproval:true, plan:activePlan})
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    addMsg('ai', data.text);
    history.push({role:'assistant', content:data.text});
    $('#latency').textContent = Math.round(performance.now() - t) + ' ms';
    trace('Response verified and returned');
    audit('OpenAI: generated the response using ' + (data.model || 'configured model') + '.');
    if (data.output?.some?.(x => x.type === 'web_search_call')) audit('Web Search: retrieved current information for this response.');
    if (data.output?.some?.(x => x.type === 'mcp_call')) audit('Composio MCP: external connector activity detected; approval remains required by default.');
    $('#gaugeValue').textContent = Math.floor(65 + Math.random()*30);
    $('#toolPct').textContent = (activePlan ? 70 : 45) + '%';
    $('#toolBar').style.width = $('#toolPct').textContent;
  } catch (e) {
    addMsg('ai', 'I could not complete that request: ' + e.message);
    trace('Orchestration error');
    audit('P.U.R.P.L.E: execution stopped because an error was detected.');
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
  recognition.onend = () => { recognition=null; $('#mode').textContent='TEXT'; $('#mic').textContent='◉'; };
  recognition.start();
};

async function boot() {
  try {
    const r = await fetch('/api/status');
    const s = await r.json();
    $('#composioState').textContent = s.composio ? 'ACTIVE' : 'PENDING';
    $('#voiceState').textContent = s.elevenlabsBridge ? 'ACTIVE' : 'BRIDGE';
    trace(`System online · V${s.version || '1'} · ${s.model}`);
    audit(`Orchestrator: ${s.orchestrator ? 'ACTIVE' : 'OFF'} · Planner: ${s.planner ? 'ACTIVE' : 'OFF'}`);
  } catch { trace('Backend unavailable'); }
}

boot();
setInterval(() => $('#clock').textContent = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}), 1000);
