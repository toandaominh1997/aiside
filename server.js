const http = require('http');
const { spawn } = require('child_process');

const PORT = 3000;

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/chat/completions') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const model = payload.model || 'haiku';
        const messages = payload.messages || [];
        
        // Extract the latest user prompt and format previous messages
        let prompt = '';
        for (const m of messages) {
          prompt += `[${m.role.toUpperCase()}]: ${m.content}\n\n`;
        }

        console.log(`Received request for model: ${model}`);

        // Set up the response stream
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        // Parse apiKey from Authorization header if available
        const authHeader = req.headers['authorization'];
        const token = authHeader ? authHeader.replace('Bearer ', '') : '';

        // Configure environment and settings for claude code
        const env = { ...process.env };
        if (token) {
          env.ANTHROPIC_API_KEY = token;
          env.ANTHROPIC_AUTH_TOKEN = token;
        }

        // We can pass the settings json inline or rely on the user having the file.
        // We will create a dynamic settings JSON.
        const settingsJson = JSON.stringify({
          model: model,
          effortLevel: "medium",
          skipDangerousModePermissionPrompt: true
        });

        // Run claude code in print mode and stream-json format to parse output
        const claudeArgs = [
          '-p',
          '--settings', settingsJson,
          '--output-format', 'stream-json',
          prompt
        ];

        console.log('Running: claude ' + claudeArgs.join(' '));

        const claude = spawn('claude', claudeArgs, { env });

        claude.stdout.on('data', (data) => {
          const lines = data.toString().split('\n').filter(l => l.trim().length > 0);
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              // Handle claude stream-json format mapping to OpenAI SSE format
              if (parsed.type === 'message' || parsed.type === 'text') {
                  const content = parsed.text || parsed.message || '';
                  if (content) {
                      const chunk = {
                          choices: [{ delta: { content: content } }]
                      };
                      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                  }
              }
            } catch (e) {
              // If it's not JSON, just send it as text content
              const chunk = {
                  choices: [{ delta: { content: line + '\n' } }]
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          }
        });

        claude.stderr.on('data', (data) => {
          console.error(`Claude Error: ${data.toString()}`);
        });

        claude.on('close', (code) => {
          console.log(`Claude process exited with code ${code}`);
          res.write('data: [DONE]\n\n');
          res.end();
        });

      } catch (err) {
        console.error(err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Aiside local Claude proxy running on http://localhost:${PORT}`);
});
