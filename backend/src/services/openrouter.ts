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
  model: string = DEFAULT_MODEL
): Promise<string> {
  console.log('=== OPENROUTER API CALL ===');
  console.log('Model:', model);
  console.log('System prompt length:', systemPrompt.length);
  console.log('User prompt length:', userPrompt.length);
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:8080',
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

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
  console.log('=== FULL API REQUEST ===');
      console.log(JSON.stringify({ model, messages }, null, 2));
  console.log('=== END API REQUEST ===');

  const data: OpenRouterResponse = await response.json();
  console.log('OpenRouter response received, tokens used:', data.usage?.total_tokens);
  console.log('=== END API CALL ===');
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
  model: string = DEFAULT_MODEL
): Promise<string> {
  console.log('=== OPENROUTER VISION API CALL ===');
  console.log('Model:', model);
  console.log('Image URL:', imageUrl);
  console.log('System prompt length:', systemPrompt.length);
  console.log('User prompt length:', userPrompt.length);
  
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

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:8080',
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

  console.log('=== FULL API REQUEST ===');
  console.log(JSON.stringify({ model, messages: [{ role: 'system', content: '[text]' }, { role: 'user', content: '[text + image]' }] }, null, 2));
  console.log('=== END API REQUEST ===');

  const data: OpenRouterResponse = await response.json();
  console.log('OpenRouter Vision response received, tokens used:', data.usage?.total_tokens);
  console.log('=== END API CALL ===');
  return data.choices[0]?.message?.content || '';
}
