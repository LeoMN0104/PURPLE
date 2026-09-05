import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';

const app = express();
const port = Number(process.env.PORT) || 3000;
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const SYSTEM = `You are P.U.R.P.L.E (Personal Utility & Reasoning Protocol for Life Enhancement), a proactive personal AI assistant.

Rules:
- Detect the user's language per turn and answer in that language.
- Be concise but useful. Never claim an external action succeeded unless a tool result confirms it.
- Prefer current information when the question needs it.
- For consequential or irreversible external actions, explain what will happen and require explicit approval unless the UI's approval mode is disabled.
- For complex jobs, create a clear numbered plan and report progress after each completed step.
- When tools are used, produce a short connector audit entry naming the connector and exactly what it did.
- Do not expose hidden chain-of-thought. Give concise conclusions and actionable summaries.
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

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(client),
    model: process.env.OPENAI_MODEL || 'gpt-5',
    composio: Boolean(process.env.COMPOSIO_MCP_URL),
    elevenlabsBridge: Boolean(process.env.ELEVENLABS_BRIDGE_URL)
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    if (!client) return res.status(503).json({ error: 'P.U.R.P.L.E is online, but OPENAI_API_KEY is not configured in Render yet.' });
    const { messages = [], warnings = true, stepApproval = true } = req.body;
    const policy = `\nUI policy: warnings=${warnings ? 'ON' : 'OFF'}; step-by-step approval=${stepApproval ? 'ON' : 'OFF'}. Respect these preferences for the interaction, while still avoiding unsafe or unauthorized actions.`;
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5',
      instructions: SYSTEM + policy,
      tools: [{ type: 'web_search' }, ...mcpTools()],
      input: messages.slice(-24)
    });
    res.json({ text: response.output_text, responseId: response.id, output: response.output });
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

app.listen(port, '0.0.0.0', () => console.log(`P.U.R.P.L.E running on port ${port}`));
