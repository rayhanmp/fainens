/**
 * What kind of service a subscription is, for the by-type view. The server stores the choice
 * (backend routes/subscriptions.ts); a subscription without one is guessed from its name.
 */
export const SERVICE_TYPES = [
  { value: 'ai', label: 'AI tools', words: ['chatgpt', 'openai', 'claude', 'anthropic', 'gemini', 'copilot', 'midjourney', 'perplexity', 'cursor', 'grok', ' ai'] },
  { value: 'video', label: 'Video', words: ['netflix', 'disney', 'hbo', 'prime video', 'vidio', 'viu', 'youtube', 'iqiyi', 'wetv', 'apple tv', 'mola'] },
  { value: 'music', label: 'Music', words: ['spotify', 'apple music', 'joox', 'deezer', 'tidal', 'youtube music', 'langit musik'] },
  { value: 'cloud', label: 'Cloud storage', words: ['google one', 'icloud', 'dropbox', 'onedrive', 'mega', 'drive', 'storage', 'pcloud'] },
  { value: 'hosting', label: 'Hosting and domains', words: ['vps', 'domain', 'hosting', 'server', 'idcloudhost', 'niagahoster', 'digitalocean', 'vercel', 'cloudflare', 'aws', 'hostinger', 'rumahweb'] },
  { value: 'software', label: 'Software and apps', words: ['adobe', 'figma', 'notion', 'microsoft 365', 'office', 'canva', 'jetbrains', 'github', '1password', 'getcontact', 'grammarly', 'duolingo'] },
  { value: 'mobile', label: 'Phone and internet', words: ['telkomsel', 'indosat', 'xl', 'axis', 'smartfren', 'tri ', 'indihome', 'biznet', 'first media', 'myrepublic', 'internet', 'data', 'pulsa'] },
  { value: 'news', label: 'News and reading', words: ['kompas', 'tempo', 'medium', 'substack', 'kindle', 'gramedia', 'scribd', 'news', 'magazine'] },
  { value: 'fitness', label: 'Health and fitness', words: ['gym', 'fitness', 'strava', 'yoga', 'fithub', 'celebrity fitness', 'halodoc'] },
  { value: 'gaming', label: 'Gaming', words: ['playstation', 'xbox', 'nintendo', 'steam', 'game pass', 'genshin'] },
  { value: 'other', label: 'Other', words: [] },
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number]['value'];

export function serviceTypeLabel(type: ServiceType): string {
  return SERVICE_TYPES.find((item) => item.value === type)?.label ?? 'Other';
}

/** The type a name suggests: the first type with a matching word, else Other. */
export function guessServiceType(name: string): ServiceType {
  const text = ` ${name.toLowerCase()} `;
  return SERVICE_TYPES.find((item) => item.words.some((word) => text.includes(word)))?.value ?? 'other';
}

/** The type a subscription counts under: its own choice, or the guess from its name. */
export function serviceTypeOf(subscription: { name: string; serviceType?: string | null }): ServiceType {
  const chosen = SERVICE_TYPES.find((item) => item.value === subscription.serviceType);
  return chosen ? chosen.value : guessServiceType(subscription.name);
}
