import { env } from "../lib/env";

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const DEFAULT_MODEL = 'google/gemini-3.1-flash-lite-preview';

export async function callOpenRouter(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  model: string = DEFAULT_MODEL,
  baseUrl: string = 'https://openrouter.ai/api/v1'
): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': env.OPENROUTER_HTTP_REFERER ?? env.FRONTEND_URL ?? 'http://localhost:8080',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenRouter API error:', error);
    throw new Error(`OpenRouter API error: ${error}`);
  }

  const data: OpenRouterResponse = await response.json();
  return data.choices[0]?.message?.content || 'No insight generated';
}

interface VisionMessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

export async function callOpenRouterVision(
  systemPrompt: string,
  imageUrl: string,
  userPrompt: string,
  apiKey: string,
  model: string = DEFAULT_MODEL,
  baseUrl: string = 'https://openrouter.ai/api/v1'
): Promise<string> {
  const messages: Array<{ role: string; content: VisionMessageContent[] }> = [
    { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
    { 
      role: 'user', 
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }
  ];

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': env.OPENROUTER_HTTP_REFERER ?? env.FRONTEND_URL ?? 'http://localhost:8080',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('OpenRouter Vision API error:', error);
    throw new Error(`OpenRouter Vision API error: ${error}`);
  }

  const data: OpenRouterResponse = await response.json();
  return data.choices[0]?.message?.content || '';
}
