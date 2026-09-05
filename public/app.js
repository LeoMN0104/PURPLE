const $ = (s) => document.querySelector(s);
const messages = $('#messages');
let history = [];
let busy = false;
let recognition = null;
let activePlan = null;
let currentStepIndex = 0;
let pendingApproval = null;

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
  box.innerHTML = `<b>${escapeHtml(plan.title || 'Execution plan')}</b><ol>${plan.steps.map((s,i) => `<li class="${i < currentStepIndex ? 'done' : i === currentStepIndex ? 'current' : ''}"><strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(s.description)}</span>${s.needsApproval ? '<em>APPROVAL</em>' : ''}</li>`).join('')}</ol>`;
}

function renderApproval(step) {
  const box = $('#approval');
  if (!step) { box.classList.add('hidden'); box.innerHTML=''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `<strong>APPROVAL REQUIRED</strong><p>Step ${step.id}: ${escapeHtml(step.title)}</p><small>${escapeHtml(step.description)}</small><div><button id="approveStep" class="send">APPROVE ↗</button><button id="rejectStep" class="ghost">STOP</button></div>`;
  $('#approveStep').onclick = () => continuePlan(true);
  $('#rejectStep').onclick = () => stopPlan('Execution stopped by user before the approved step.');
}

async function requestPlan(text) {
  const r = await fetch('/api/plan', {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({task:text})
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Planning failed');
  return data;
}

async function executeStep(approved = false) {
  if (!activePlan) return;
  const step = activePlan.steps[currentStepIndex];
  if (!step) return finishPlan();
  $('#coreMode').textContent = `STEP ${currentStepIndex + 1}/${activePlan.steps.length}`;
  trace(`Executing step ${currentStepIndex + 1}: ${step.title}`);
  const r = await fetch('/api/execute-step', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      messages:history,
      plan:activePlan,
      stepIndex:currentStepIndex,
      warnings:$('#warningsToggle').checked,
      stepApproval:$('#approvalToggle').checked,
      approved
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Step execution failed');
  if (data.status === 'awaiting_approval') {
    pendingApproval = data.step;
    renderApproval(pendingApproval);
    trace(`Waiting for approval: ${data.step.title}`);
    audit(`Approval engine: paused before consequential step ${data.step.id}.`);
    return;
  }
  pendingApproval = null;
  renderApproval(null);
  addMsg('ai', data.text);
  history.push({role:'assistant', content:data.text});
  audit(`OpenAI: executed step ${currentStepIndex + 1}/${activePlan.steps.length}.`);
  if (data.output?.some?.(x => x.type === 'web_search_call')) audit('Web Search: retrieved current information for this step.');
  if (data.output?.some?.(x => x.type === 'mcp_call')) audit('Composio MCP: connector activity detected; external tool approval remains enforced.');
  currentStepIndex += 1;
  renderPlan(activePlan);
  $('#gaugeValue').textContent = Math.floor(65 + Math.random()*30);
  $('#toolPct').textContent = Math.min(99, 45 + currentStepIndex * 12) + '%';
  $('#toolBar').style.width = $('#toolPct').textContent;
  if (currentStepIndex < activePlan.steps.length) {
    await executeStep(false);
  } else {
    finishPlan();
  }
}

async function continuePlan(approved = false) {
  if (busy || !activePlan) return;
  busy = true;
  renderApproval(null);
  try {
    await executeStep(approved);
  } catch (e) {
    addMsg('ai', 'I could not complete the current step: ' + e.message);
    trace('Step execution error');
    audit('P.U.R.P.L.E: execution stopped because a step failed.');
    $('#coreMode').textContent = 'BLOCKED';
  } finally {
    busy = false;
    if (!pendingApproval && currentStepIndex >= activePlan.steps.length) finishPlan();
  }
}

function finishPlan() {
  if (!activePlan) return;
  renderPlan(activePlan);
  renderApproval(null);
  trace('Execution plan completed');
  audit(`Orchestrator: completed ${activePlan.steps.length} planned step(s).`);
  $('#coreMode').textContent = 'STANDBY • READY FOR INPUT';
}

function stopPlan(message) {
  pendingApproval = null;
  renderApproval(null);
  addMsg('ai', message);
  trace('Execution stopped');
  audit('Approval engine: user stopped the plan.');
  busy = false;
  $('#coreMode').textContent = 'STANDBY • READY FOR INPUT';
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
  currentStepIndex = 0;
  pendingApproval = null;
  renderPlan(null); renderApproval(null);
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
      $('#latency').textContent = Math.round(performance.now() - t) + ' ms';
      await executeStep(false);
    } else {
      trace('Task classified as direct response');
      const r = await fetch('/api/chat', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({messages:history,warnings:$('#warningsToggle').checked,stepApproval:$('#approvalToggle').checked,plan:null})
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Request failed');
      addMsg('ai', data.text);
      history.push({role:'assistant', content:data.text});
      audit('OpenAI: generated the direct response using ' + (data.model || 'configured model') + '.');
      if (data.output?.some?.(x => x.type === 'web_search_call')) audit('Web Search: retrieved current information for this response.');
      if (data.output?.some?.(x => x.type === 'mcp_call')) audit('Composio MCP: connector activity detected; approval remains required by default.');
      $('#latency').textContent = Math.round(performance.now() - t) + ' ms';
    }
  } catch (e) {
    addMsg('ai', 'I could not complete that request: ' + e.message);
    trace('Orchestration error');
    audit('P.U.R.P.L.E: execution stopped because an error was detected.');
  } finally {
    busy = false;
    $('#send').textContent = 'SEND ↗';
    if (!pendingApproval) $('#coreMode').textContent = 'STANDBY • READY FOR INPUT';
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
    audit(`Orchestrator: ${s.orchestrator ? 'ACTIVE' : 'OFF'} · Planner: ${s.planner ? 'ACTIVE' : 'OFF'} · Step engine: ${s.stepExecution ? 'ACTIVE' : 'OFF'}`);
  } catch { trace('Backend unavailable'); }
}

boot();
setInterval(() => $('#clock').textContent = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}), 1000);
