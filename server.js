import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';

const app = express();
const port = Number(process.env.PORT) || 3000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const SYSTEM = `You are P.U.R.P.L.E (Personal Utility & Reasoning Protocol for Life Enhancement), a proactive personal AI assistant.

V2 ORCHESTRATOR RULES:
- Detect the user's language per turn and answer in that language.
- Decide whether a request is simple or requires a multi-step workflow.
- For complex jobs, follow the supplied plan and clearly report what was completed, what remains, and any blocker.
- Never claim an external action succeeded unless a tool result confirms it.
- Prefer current information when the question needs it.
- For consequential or irreversible external actions, explain what will happen and require explicit approval unless the UI's approval mode is disabled.
- Use available tools deliberately; do not call tools merely for show.
- If a tool fails, diagnose the failure, try a safe alternative when appropriate, or explain the blocker.
- When tools are used, produce a short connector audit entry naming the connector and exactly what it did.
- Do not expose hidden chain-of-thought. Give concise conclusions, decisions, and actionable summaries.
- Treat the user's explicit preferences as session policy, while still refusing unsafe or unauthorized actions.
`;

function mcpTools() {
  if (!process.env.COMPOSIO_MCP_URL) return [];
  const tool = {
    type: 'mcp',
    server_label: 'composio',
    server_url: process.env.COMPOSIO_MCP_URL,
    require_approval: 'always'
  };
  if (process.env.COMPOSIO_MCP_AUTH) tool.authorization = process.env.COMPOSIO_MCP_AUTH;
  return [tool];
}

function isComplex(text = '') {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const signals = /(and then|then|after that|first|finally|plan|steps|organize|compare|research|create|build|deploy|publish|find.*and|prepare|analiza|desarrolla|crea|organiza|después|luego|primero|finalmente|pasos|investiga)/i;
  return words >= 35 || signals.test(text);
}

function normalizePlan(plan) {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) return null;
  return {
    title: String(plan.title || 'Execution plan'),
    complexity: ['simple', 'moderate', 'complex'].includes(plan.complexity) ? plan.complexity : 'moderate',
    steps: plan.steps.slice(0, 6).map((s, i) => ({
      id: Number.isFinite(Number(s.id)) ? Number(s.id) : i + 1,
      title: String(s.title || `Step ${i + 1}`),
      description: String(s.description || 'Complete this step and verify the result.'),
      needsApproval: Boolean(s.needsApproval)
    }))
  };
}

async function buildPlan(task) {
  if (!client) throw new Error('OPENAI_API_KEY is not configured.');
  const response = await client.responses.create({
    model: MODEL,
    instructions: `Create a concise execution plan for P.U.R.P.L.E. Return ONLY valid JSON with this exact shape: {"title":"string","complexity":"simple|moderate|complex","steps":[{"id":1,"title":"string","description":"string","needsApproval":false}]}. Use 2-6 steps. Set needsApproval=true for steps that would send, publish, delete, purchase, modify important external state, or otherwise have meaningful consequences. Do not include hidden reasoning. Make steps concrete and verifiable.`,
    input: task
  });
  const raw = response.output_text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return normalizePlan(JSON.parse(raw)) || normalizePlan(null);
  } catch {
    return {
      title: 'Execution plan',
      complexity: 'moderate',
      steps: [
        { id: 1, title: 'Understand the request', description: 'Define the desired outcome and constraints.', needsApproval: false },
        { id: 2, title: 'Execute safely', description: 'Use the available capabilities and verify the result.', needsApproval: false },
        { id: 3, title: 'Report', description: 'Summarize the result, limitations, and next action.', needsApproval: false }
      ]
    };
  }
}

async function runStep({ messages, plan, stepIndex, warnings = true, stepApproval = true, approved = false }) {
  if (!client) throw new Error('OPENAI_API_KEY is not configured.');
  const safePlan = normalizePlan(plan);
  if (!safePlan) throw new Error('A valid execution plan is required.');
  if (stepIndex < 0 || stepIndex >= safePlan.steps.length) throw new Error('Invalid step index.');

  const step = safePlan.steps[stepIndex];
  if (stepApproval && step.needsApproval && !approved) {
    return { status: 'awaiting_approval', stepIndex, step, plan: safePlan };
  }

  const previous = safePlan.steps.slice(0, stepIndex).map((s, i) => `${i + 1}. ${s.title}`).join('\n');
  const policy = `UI policy: warnings=${warnings ? 'ON' : 'OFF'}; step-by-step approval=${stepApproval ? 'ON' : 'OFF'}.`;
  const stepContext = `\nACTIVE PLAN: ${safePlan.title}\nCURRENT STEP ${stepIndex + 1}/${safePlan.steps.length}: ${step.title}\nSTEP DESCRIPTION: ${step.description}\nCOMPLETED PREVIOUS STEPS: ${previous || 'none'}\nExecute ONLY the current step. Do not pretend later steps are complete. State what was actually completed and identify any blocker.`;

  const response = await client.responses.create({
    model: MODEL,
    instructions: SYSTEM + policy + stepContext,
    tools: [{ type: 'web_search' }, ...mcpTools()],
    input: messages.slice(-24)
  });

  return {
    status: 'completed',
    stepIndex,
    step,
    text: response.output_text,
    responseId: response.id,
    output: response.output,
    model: MODEL,
    plan: safePlan
  };
}

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(client),
    model: MODEL,
    version: '2.1.0',
    orchestrator: true,
    planner: true,
    stepExecution: true,
    approvalEngine: true,
    composio: Boolean(process.env.COMPOSIO_MCP_URL),
    elevenlabsBridge: Boolean(process.env.ELEVENLABS_BRIDGE_URL)
  });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()), version: '2.1.0' }));

app.post('/api/plan', async (req, res) => {
  try {
    if (!client) return res.status(503).json({ error: 'OPENAI_API_KEY is not configured.' });
    const task = String(req.body?.task || '').trim();
    if (!task) return res.status(400).json({ error: 'Task is required.' });
    if (!isComplex(task)) return res.json({ complex: false, plan: null });
    const plan = await buildPlan(task);
    res.json({ complex: true, plan });
  } catch (e) {
    console.error('Planner error:', e);
    res.status(500).json({ error: e?.message || 'Planning failed' });
  }
});

app.post('/api/execute-step', async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const plan = req.body?.plan;
    const stepIndex = Number(req.body?.stepIndex);
    if (!Number.isInteger(stepIndex)) return res.status(400).json({ error: 'stepIndex is required.' });
    const result = await runStep({
      messages,
      plan,
      stepIndex,
      warnings: req.body?.warnings !== false,
      stepApproval: req.body?.stepApproval !== false,
      approved: req.body?.approved === true
    });
    res.json(result);
  } catch (e) {
    console.error('Step execution error:', e);
    res.status(500).json({ error: e?.message || 'Step execution failed' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    if (!client) return res.status(503).json({ error: 'P.U.R.P.L.E is online, but OPENAI_API_KEY is not configured in Render yet.' });
    const { messages = [], warnings = true, stepApproval = true, plan = null } = req.body;
    const policy = `\nUI policy: warnings=${warnings ? 'ON' : 'OFF'}; step-by-step approval=${stepApproval ? 'ON' : 'OFF'}.`;
    const planContext = plan ? `\nACTIVE EXECUTION PLAN:\n${JSON.stringify(plan)}\nFollow it, report progress, and do not invent completed steps.` : '';
    const response = await client.responses.create({
      model: MODEL,
      instructions: SYSTEM + policy + planContext,
      tools: [{ type: 'web_search' }, ...mcpTools()],
      input: messages.slice(-24)
    });
    res.json({ text: response.output_text, responseId: response.id, output: response.output, model: MODEL });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e?.message || 'Request failed' });
  }
});

app.post('/api/elevenlabs', async (req, res) => {
  if (!process.env.ELEVENLABS_BRIDGE_URL) return res.status(501).json({ error: 'Configure ELEVENLABS_BRIDGE_URL for your ElevenLabs-through-Composio bridge.' });
  try {
    const r = await fetch(process.env.ELEVENLABS_BRIDGE_URL, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(req.body)
    });
    const data = await r.arrayBuffer();
    res.status(r.status).set('content-type', r.headers.get('content-type') || 'audio/mpeg').send(Buffer.from(data));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.listen(port, '0.0.0.0', () => console.log(`P.U.R.P.L.E V2.1 running on port ${port}`));
