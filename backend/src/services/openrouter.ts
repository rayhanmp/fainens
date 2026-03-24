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

export async function callOpenRouter(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string
): Promise<string> {
  console.log('=== OPENROUTER API CALL ===');
  console.log('Model: openai/gpt-5.4-mini');
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
      model: 'openai/gpt-5.4-mini',
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
      console.log(JSON.stringify({ model: 'openai/gpt-5.4-mini', messages }, null, 2));
  console.log('=== END API REQUEST ===');

  const data: OpenRouterResponse = await response.json();
  console.log('OpenRouter response received, tokens used:', data.usage?.total_tokens);
  console.log('=== END API CALL ===');
  return data.choices[0]?.message?.content || 'No insight generated';
}
