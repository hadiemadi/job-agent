# Job Agent

An AI-powered job search and CV tailoring agent built with Node.js and Claude.

## What it does

1. Reads your CV (PDF)
2. Extracts the best job search queries using Claude
3. Searches for matching jobs via JSearch API (London, Stockholm, Remote)
4. Ranks jobs by fit score with reasons for/against
5. Rewrites your CV tailored to a specific job

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js v24 |
| AI | Anthropic Claude (claude-sonnet-4-6) |
| Job Search | JSearch via RapidAPI |
| PDF Parsing | pdf2json |
| Web Server | Express.js |
| Testing | Jest |

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/hadiemadi/job-agent.git
cd job-agent
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and add your API keys (see `.env.example` for required variables).

### 4. Run the web app

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Run the CLI version

```bash
node index.js
```

Place your CV as `cv.pdf` in the project root first.

## Project Structure

```
job-agent/
├── src/
│   ├── ai.js          # Claude API calls (job analysis, CV rewriting)
│   ├── cv.js          # PDF reading and parsing
│   ├── jobs.js        # JSearch API (job search)
│   └── templates.js   # HTML CV template generator
├── agent.js           # Public API — re-exports all functions from src/
├── server.js          # Express web server + browser UI
├── index.js           # CLI entry point
├── test.js            # Jest test suite
├── .env.example       # Required environment variables
└── output/            # Generated CV HTML files
```

## Running Tests

```bash
npm test
```

8 tests covering: CV reading, job title extraction, job search, job ranking, and CV rewriting.

## Environment Variables

See `.env.example` for all required keys.

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `RAPIDAPI_KEY` | Your RapidAPI key (for JSearch) |

## Roadmap

- [ ] Career Coach — AI career advisor
- [ ] Ghost job detection
- [x] Word export of tailored CV (on-demand, reflects live edits)
- [ ] Multiple CV templates
- [ ] Cover letter generator
