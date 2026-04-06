# HandOff 🤲

**Hand work off to an AI agent that actually uses the web for you — and gets smarter every run.**

HandOff is a Chrome extension that combines Gemini Flash and [MolmoWeb](https://github.com/allenai/molmoweb) (AI2's open visual web agent) with a self-learning engine. It sees, clicks, types, and verifies — and remembers what worked, what failed, and how to do it better next time.

## Features

- 🖱️ **Visual Computer Use** — AI sees your screen and interacts with any website
- 👁️ **MolmoWeb Vision Engine** — Optional AI2 open-weight visual agent for screenshot-based perception
- 🧠 **Self-Learning Engine** — Execution memory, failure analysis, and auto-skill generation
- ⚡ **Auto-Skills** — Repeated workflows become reusable skills with reliability tracking
- 🔄 **Hybrid Brain** — Adaptive mode switching between DOM, Vision, Memory, and Skill execution
- ⏸️ **Human-in-the-Loop** — Pause, resume, or override agent actions anytime
- 📊 **Live Action Feed** — Watch every step the agent takes in real-time
- 🔒 **Privacy First** — Everything runs locally in your browser, no external servers

## What Makes HandOff Different

| Feature | HandOff | Other Agents |
|---|---|---|
| **Memory** | Persistent — remembers every run | Stateless — forgets everything |
| **Failures** | Analyzes root cause, generates fix strategies, never repeats same mistake | Retries blindly |
| **Skills** | 3+ successful runs → auto-generates reusable skill | Manual scripting |
| **Vision** | MolmoWeb (open, self-hosted) + Gemini (cloud) with automatic fallback | Single model, no fallback |
| **Transparency** | Full dashboard: skills, site profiles, failure analysis | Black box |

## Use Cases

- **Form Filling** — "Fill this CRM with my contact data"
- **Web Research** — "Find all AI events in the next 60 days"
- **Data Extraction** — "Extract all items into a structured table"
- **Workspace Cleanup** — "Organize this board by priority"
- **Dashboard Audits** — "Check all metrics and flag anomalies"

## Quick Start

### 1. Install Dependencies

```bash
cd HandOff
npm install
```

### 2. Build the Extension

```bash
npm run build
```

### 3. Load in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist` folder

### 4. Configure

1. Click the HandOff extension icon
2. Open Settings (gear icon)
3. Enter your [Gemini API key](https://aistudio.google.com/apikey)
4. *(Optional)* Enable MolmoWeb and set your model server endpoint
5. Save

### 5. Start Using

1. Navigate to any website
2. Click the HandOff icon to open the side panel
3. Describe what you want done
4. Watch the agent work — and learn!

## MolmoWeb Setup (Optional)

MolmoWeb gives HandOff a dedicated open-weight vision model for screenshot-based perception. It's optional — Gemini works great on its own, but MolmoWeb adds a self-hosted, privacy-first vision layer.

```bash
# Clone MolmoWeb
git clone https://github.com/allenai/molmoweb.git
cd molmoweb

# Download weights (4B model, ~8GB)
bash scripts/download_weights.sh allenai/MolmoWeb-4B-Native

# Start the model server
bash scripts/start_server.sh ./checkpoints/MolmoWeb-4B-Native
# Server runs at http://127.0.0.1:8001
```

Then in HandOff Settings: enable **MolmoWeb Vision Engine** → set endpoint → click **Test** to verify.

If the server goes down mid-task, HandOff automatically falls back to Gemini.

## Development

```bash
# Start dev server with hot reload
npm run dev

# Build for production
npm run build
```

## Architecture

```
Chrome Extension (Manifest V3)
│
├─ Side Panel (React + Tailwind + Zustand)
│   ├─ Task Input
│   ├─ Action Feed (with learning step indicators)
│   ├─ Controls (Pause/Resume/Stop)
│   ├─ Learning Panel (skills, memory, site profiles)
│   └─ Settings (LLM config + MolmoWeb toggle)
│
├─ Background Worker
│   ├─ Agent Core (orchestration + state machine)
│   ├─ Gemini Client (cloud LLM)
│   ├─ MolmoWeb Client (self-hosted vision model)
│   └─ Self-Learning Engine
│       ├─ Execution Memory (traces + patterns)
│       ├─ Failure Learning (analysis + fix strategies)
│       ├─ Auto-Skill Engine (workflow → reusable skill)
│       └─ Hybrid Brain (mode selection per action)
│
└─ Content Script
    └─ Action Executor (click/type/scroll/navigate)
```

## Self-Learning Loop

```
Task starts
  → executionMemory.startTrace()
  → hybridBrain.decideMode() → picks Skill / Vision / DOM / Memory
  → If proven skill exists → skill-guided execution
  → Each action → executionMemory.recordAction()
  → On failure → failureLearning.analyze() → generates fix → retries with learned correction
  → On success → hybridBrain.recordModeOutcome() → updates site reliability
Task ends
  → executionMemory.completeTrace()
  → autoSkill.detectNewSkills()
  → Next time same task → faster, more reliable, zero re-teaching
```

## Tech Stack

- **AI**: Gemini Flash (cloud) + MolmoWeb (self-hosted, optional)
- **UI**: React 18 + Tailwind CSS + Lucide Icons
- **State**: Zustand
- **Build**: Vite
- **Storage**: Chrome Storage API (all local, no backend)
- **Extension**: Chrome Manifest V3

## Roadmap

- [x] Workflow saving & replay (Auto-Skills)
- [x] Self-learning execution memory
- [x] MolmoWeb vision integration
- [x] Failure analysis & recovery
- [x] Hybrid Brain mode selection
- [ ] Multi-tab support
- [ ] Background execution
- [ ] Export to JSON/CSV
- [ ] Skill marketplace (share skills between users)
- [ ] Team collaboration

## License

MIT

---

Built with ❤️ for the future of work.
