import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface MarkdownMessageProps {
  children: string;
}

/**
 * Agent prose is model-generated, so raw HTML stays disabled (the
 * react-markdown default). Math is parsed only through remark-math/KaTeX.
 */
export function MarkdownMessage({ children }: MarkdownMessageProps) {
  return (
    <div className="agent-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
