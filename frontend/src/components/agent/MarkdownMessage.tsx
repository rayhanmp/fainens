import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface MarkdownMessageProps {
  children: string;
}

type MarkdownNode = {
  type: string;
  value?: unknown;
  children?: MarkdownNode[];
};

/**
 * Keep raw HTML disabled while supporting the one HTML element models
 * commonly use inside GFM table cells. `rehypeRaw` would execute every raw
 * HTML node in model output; converting only `<br>` into a Markdown break
 * gives tables the expected layout without widening the renderer's HTML
 * surface.
 */
function remarkBreakHtml() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children) return;

      const children: MarkdownNode[] = [];
      for (const child of node.children) {
        if (child.type === 'html' && typeof child.value === 'string' && /^<br\s*\/?>$/i.test(child.value.trim())) {
          children.push({ type: 'break' });
        } else {
          visit(child);
          children.push(child);
        }
      }
      node.children = children;
    };

    visit(tree);
  };
}

/**
 * Agent prose is model-generated, so raw HTML stays disabled (the
 * react-markdown default), with `<br>` narrowly converted into a safe
 * Markdown break for table cells. Math is parsed through remark-math/KaTeX.
 */
export function MarkdownMessage({ children }: MarkdownMessageProps) {
  return (
    <div className="agent-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkBreakHtml]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
