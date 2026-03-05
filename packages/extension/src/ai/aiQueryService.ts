import * as vscode from 'vscode';

export type AiProvider = 'openai' | 'google';

const SECRET_KEY_PREFIX = 'dbmanager.ai.';

export class AiQueryService {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async setApiKey(provider: AiProvider, key: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_PREFIX + provider, key);
  }

  async getApiKey(provider: AiProvider): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEY_PREFIX + provider);
  }

  async deleteApiKey(provider: AiProvider): Promise<void> {
    await this.secrets.delete(SECRET_KEY_PREFIX + provider);
  }

  async hasApiKey(provider: AiProvider): Promise<boolean> {
    const key = await this.getApiKey(provider);
    return !!key;
  }

  async generateQuery(
    prompt: string,
    schemaText: string,
    dbType: string,
    provider: AiProvider,
  ): Promise<string> {
    const apiKey = await this.getApiKey(provider);
    if (!apiKey) {
      throw new Error(
        `No API key configured for ${provider}. Click the ⚙ icon to add your API key.`,
      );
    }

    const systemPrompt = buildGeneratePrompt(schemaText, dbType);

    if (provider === 'openai') {
      return callOpenAI(apiKey, systemPrompt, prompt);
    } else {
      return callGemini(apiKey, systemPrompt, prompt);
    }
  }

  async refineQuery(
    sql: string,
    instruction: string | undefined,
    schemaText: string,
    dbType: string,
    provider: AiProvider,
  ): Promise<string> {
    const apiKey = await this.getApiKey(provider);
    if (!apiKey) {
      throw new Error(
        `No API key configured for ${provider}. Click the ⚙ icon to add your API key.`,
      );
    }

    const systemPrompt = buildRefinePrompt(schemaText, dbType, instruction);

    if (provider === 'openai') {
      return callOpenAI(apiKey, systemPrompt, sql);
    } else {
      return callGemini(apiKey, systemPrompt, sql);
    }
  }
}

function buildGeneratePrompt(schemaText: string, dbType: string): string {
  return `You are an expert SQL query generator.

Database type: ${dbType}

Schema:
${schemaText}

Rules:
- Return ONLY raw SQL, no markdown code fences, no explanation
- Use the correct dialect for the database type:
  - MySQL/MariaDB: backtick identifiers, LIMIT/OFFSET, IFNULL
  - PostgreSQL: double-quote identifiers, numbered params ($1 $2), ILIKE for case-insensitive search
  - SQLite: no stored procedures
- Prefer readable table aliases
- If the request is ambiguous, use the most common interpretation

User request:`;
}

function buildRefinePrompt(schemaText: string, dbType: string, instruction?: string): string {
  return `You are an expert SQL reviewer and fixer.

Database type: ${dbType}

Schema:
${schemaText}

Fix and improve the SQL query below so that:
- Table and column names exactly match the schema above
- Syntax is correct for the ${dbType} dialect
- Query logic is preserved${instruction ? `\n- Additional instruction: ${instruction}` : ''}

Return ONLY the corrected SQL, no explanation, no markdown code fences.

Original SQL:`;
}

async function callOpenAI(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const err = (await response.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  return cleanSql(data.choices[0]?.message?.content ?? '');
}

async function callGemini(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    }),
  });

  if (!response.ok) {
    const err = (await response.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Gemini API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };
  return cleanSql(data.candidates[0]?.content?.parts[0]?.text ?? '');
}

function cleanSql(raw: string): string {
  return raw
    .replace(/^```(?:sql)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}
