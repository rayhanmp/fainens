import { AgentVisualizationBlock, isValidAgentVisualization } from './AgentVisualization';
import type { SplitBillAccount } from './SplitBillCard';
import { MarkdownMessage } from './MarkdownMessage';

type AgentMessagePart =
  | { kind: 'markdown'; text: string }
  | { kind: 'visualization'; source: string };

const VISUALIZATION_FENCE = /```fainens-viz[^\S\r\n]*(?:\r?\n|\\n)([\s\S]*?)(?:\r?\n|\\n)```/gi;

function splitMessage(text: string): AgentMessagePart[] {
  const parts: AgentMessagePart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(VISUALIZATION_FENCE)) {
    const start = match.index ?? 0;
    const source = (match[1] ?? '').replace(/\\n/g, '\n');
    if (start > cursor) parts.push({ kind: 'markdown', text: text.slice(cursor, start) });
    if (isValidAgentVisualization(source)) parts.push({ kind: 'visualization', source });
    else parts.push({ kind: 'markdown', text: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: 'markdown', text: text.slice(cursor) });
  return parts.length > 0 ? parts : [{ kind: 'markdown', text }];
}

function presentationSource(value: unknown): string | null {
  try {
    const source = JSON.stringify(value);
    return isValidAgentVisualization(source) ? source : null;
  } catch {
    return null;
  }
}

export function AgentMessage({ children, accounts = [], presentations = [] }: { children: string; accounts?: SplitBillAccount[]; presentations?: unknown[] }) {
  const structuredPresentations = presentations.flatMap((presentation) => {
    const source = presentationSource(presentation);
    return source ? [source] : [];
  });
  return <div className="agent-message-content">
    {splitMessage(children).map((part, index) => part.kind === 'visualization'
      ? <AgentVisualizationBlock key={`viz-${index}`} source={part.source} accounts={accounts} />
      : part.text ? <MarkdownMessage key={`md-${index}`}>{part.text}</MarkdownMessage> : null)}
    {structuredPresentations.map((source, index) => <AgentVisualizationBlock key={`structured-viz-${index}`} source={source} accounts={accounts} />)}
  </div>;
}
