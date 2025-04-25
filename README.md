# seo-auditor-service
🔍 Automated SEO auditing service that crawls websites with Screaming Frog and performs AI-powered analysis using OpenAI. Features modular architecture, n8n workflow integration, Google Drive automation, and comprehensive reporting. Built with Node.js.

# Create README.md
echo "# SEO Crawler Service

A modular SEO analysis service that crawls websites using Screaming Frog and analyzes the data using OpenAI.

## Features
- Automated website crawling
- SEO analysis using AI
- Google Drive integration
- n8n workflow automation
- Modular architecture

## Setup
1. Clone the repository
2. Install dependencies: \`npm install\`
3. Configure environment variables (see .env.example)
4. Run the setup script: \`node setup.js\`

## Usage
### CLI
\`\`\`bash
node scripts/crawl.js https://example.com
node scripts/auditCsvChunks.js example_com
\`\`\`

### n8n Workflow
Import the n8n workflow JSON and configure the webhook URL.

## Architecture
- Modular service architecture
- Logging system
- Error handling
- Rate limiting
- Cloud storage integration" > README.md
