import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    }),
);

const key = env.DEEPSEEK_API_KEY;
if (!key) {
  console.log('NO_KEY');
  process.exit(0);
}

const base = env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

const models = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
console.log('models', models.status, (await models.text()).slice(0, 600));

for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
  for (const max_tokens of [1600]) {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content:
              'Return a JSON object with keys a..p, each a 40-word Turkish sentence about Trabzon. JSON only.',
          },
        ],
        max_tokens,
        response_format: { type: 'json_object' },
      }),
    });
    const json = await res.json();
    const choice = json.choices?.[0] ?? {};
    console.log(
      JSON.stringify({
        model,
        max_tokens,
        status: res.status,
        finish: choice.finish_reason,
        usage: json.usage,
        content_len: (choice.message?.content ?? '').length,
        reasoning_len: (choice.message?.reasoning_content ?? '').length,
        error: json.error,
      }),
    );
  }
}
