# P.U.R.P.L.E

**Personal Utility & Reasoning Protocol for Life Enhancement**

A futuristic personal-AI dashboard designed as a Jarvis-style interface for reasoning, current information, voice/text interaction, and external connector execution.

## Included

- OpenAI Responses API chat.
- Current web search through the OpenAI Responses API.
- Optional Composio remote MCP connector bridge.
- Approval-first policy for consequential external actions.
- Connector audit panel showing detected tool activity.
- Complex-task-ready UI architecture.
- Browser voice input with an adapter endpoint reserved for an authenticated ElevenLabs-through-Composio bridge.
- Animated purple/violet neural-core HUD dashboard.
- Responsive desktop and mobile layout.
- Language detection handled by the assistant per turn.

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY`.
3. Optionally set `COMPOSIO_MCP_URL` and `COMPOSIO_MCP_AUTH` for your Composio MCP server.
4. Optionally set `ELEVENLABS_BRIDGE_URL` to your authenticated ElevenLabs-through-Composio bridge.
5. Run `npm install`.
6. Run `npm start`.
7. Open `http://localhost:3000`.

The project never hard-codes third-party credentials. Connector availability depends on the services and accounts you connect.
