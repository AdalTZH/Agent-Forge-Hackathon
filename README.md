# 🤖 Market Gap Agent

**Hackathon Track 2 — AI Agents & Automation**

An AI agent that discovers validated market opportunities by scraping Reddit for pain points, then using browser automation to verify gaps in competitor products — in under 3 minutes.

## Stack

| Tool | Role | Where Used |
|------|------|-----------|
| **Bright Data** | Enterprise web scraping + search | Reddit search + scraping via MCP |
| **Acontext** | Agent memory stack | Session, Disk, Learning Space |
| **ActionBook** | Browser action manuals | Verified DOM selectors for competitor navigation |
| **Puppeteer** | Browser execution | Executes ActionBook's manuals, takes screenshots |
| **OpenAI GPT-4o** | LLM reasoning | Pain point extraction, ranking, brief generation |
| **LangGraph.js** | Agent orchestration | StateGraph with 4 nodes: Scout→Brain→Validate→Brief |
| **React + Vite** | Frontend | Mission Control dashboard |
| **Express** | Backend | Pipeline orchestration + SSE streaming |

---

## Prerequisites

- **Node.js 18+**
- **Chrome / Chromium** (for Puppeteer and ActionBook)

---

## Setup (one-time)

### 1. Clone and install ActionBook CLI globally

```bash
npm install -g @actionbookdev/cli
actionbook setup
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Install frontend dependencies

```bash
cd frontend
npm install
```

### 4. Configure environment variables

```bash
# From the project root
cp .env.example backend/.env
```

Then open `backend/.env` and fill in your API keys:

```
OPENAI_API_KEY=sk-proj-...        # platform.openai.com → API Keys (uses gpt-4o)
BRIGHTDATA_API_TOKEN=...           # brightdata.com → User Settings → API Token
ACONTEXT_API_KEY=sk-ac-...         # acontext.io → Dashboard
ACTIONBOOK_API_KEY=...             # actionbook.dev/dashboard
```

---

## Start the App

Open **two terminals**:

**Terminal 1 — Backend**
```bash
cd backend
npm run dev
# → http://localhost:3001
```

**Terminal 2 — Frontend**
```bash
cd frontend
npm run dev
# → http://localhost:5173
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

---

## How to Use

1. Open the app at `http://localhost:5173`
2. Type a niche (e.g. `solo content creators`) and click **Run Agent**
3. Watch the **Mission Control panel** update in real-time as the agent:
   - **Phase 1 (Scout)**: Bright Data searches Reddit and scrapes posts
   - **Phase 2 (Brain)**: Acontext stores memory; Claude extracts and ranks pain points
   - **Phase 3 (Validate)**: ActionBook fetches action manuals; Puppeteer navigates competitors and takes screenshots
   - **Phase 4 (Brief)**: Claude synthesises everything into a structured Opportunity Brief
4. The final report appears in the right panel with tabs: Brief / Evidence / Competitors / Screenshots

---

## Architecture

```
Frontend (React)
    │  POST /api/agent/start
    │  GET  /api/agent/stream/:id  ← SSE real-time events
    ▼
Backend (Express)
    │
    ├─ agentOrchestrator.js   ← LangGraph StateGraph (4 nodes, linear edges)
    │       │
    │       │  START → scoutNode → brainNode → validateNode → briefNode → END
    │       │
    │       ├─ brightDataService.js   ← @brightdata/mcp (MCP SDK client)
    │       │       searchWeb(), scrapeUrl(), searchRedditPainPoints()
    │       │
    │       ├─ acontextService.js     ← @acontext/acontext SDK
    │       │       createSession(), storeMessage(), writeReport()
    │       │       createLearningSpace(), getTaskBlocks()
    │       │
    │       ├─ actionbookService.js   ← actionbook CLI + Puppeteer
    │       │       searchActionManual(), getActionManual()
    │       │       checkCompetitorGap(), verifyAllCompetitors()
    │       │
    │       └─ llmService.js          ← openai SDK (gpt-4o, JSON mode)
    │               extractPainPoints(), rankAndSelectProblem()
    │               analyseCompetitorData(), generateOpportunityBrief()
    │
    └─ routes/agent.js         ← REST + SSE endpoints
```

---

## Project Structure

```
market-gap-agent/
├── .env.example
├── README.md
├── backend/
│   ├── package.json
│   ├── server.js
│   ├── routes/
│   │   └── agent.js
│   ├── services/
│   │   ├── brightDataService.js
│   │   ├── acontextService.js
│   │   ├── actionbookService.js
│   │   ├── llmService.js
│   │   └── agentOrchestrator.js
│   └── utils/
│       ├── logger.js
│       └── helpers.js
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── hooks/
        │   └── useAgentStream.js
        ├── components/
        │   ├── NicheInput.jsx
        │   ├── MissionControl.jsx
        │   ├── AgentLog.jsx
        │   ├── BrowserFeed.jsx
        │   └── ReportView.jsx
        └── styles/
            └── index.css
```

---

## Troubleshooting

**`actionbook: command not found`**
```bash
npm install -g @actionbookdev/cli
actionbook setup
```

**Puppeteer fails to launch Chrome**
```bash
# Install Chrome dependencies (Linux)
npx puppeteer browsers install chrome
```

**Bright Data MCP errors**
- Verify your `BRIGHTDATA_API_TOKEN` in the Bright Data dashboard under User Settings → API Token
- Ensure you have at least one active zone (Web Unlocker zone is used by default)

**Acontext `401` errors**
- Verify your key starts with `sk-ac-`
- Check usage limits at `https://acontext.io/dashboard`

**Port conflict**
- Backend default: `3001`
- Frontend default: `5173`
- Change `PORT=xxxx` in `backend/.env` if needed
