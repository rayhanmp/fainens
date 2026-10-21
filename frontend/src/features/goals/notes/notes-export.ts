import { readableMarkdown } from './notes-utils';

/** A file name from a page's title. */
const fileName = (title: string, extension: string) => `${title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'notes'}.${extension}`;

/** Saves a page as a markdown file, with the notes' own tags turned back into plain markdown. */
export function downloadMarkdown(title: string, markdown: string) {
  const blob = new Blob([`# ${title}\n\n${readableMarkdown(markdown)}\n`], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName(title, 'md');
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PRINT_STYLES = `
  body { font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #191b23; max-width: 720px; margin: 32px auto; padding: 0 24px; }
  h1 { font-size: 26px; margin: 0 0 4px; } .meta { color: #737785; font-size: 12px; margin-bottom: 24px; }
  h2 { font-size: 19px; margin: 24px 0 8px; } h3 { font-size: 16px; margin: 18px 0 6px; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0; } ul[data-type="taskList"] li { display: flex; gap: 8px; }
  ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; color: #737785; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; } th, td { border: 1px solid #e1e2ec; padding: 6px 8px; text-align: left; vertical-align: top; } th { background: #f5f6fa; }
  img { max-width: 100%; border-radius: 8px; } img[data-size="small"] { max-width: 33%; } img[data-size="medium"] { max-width: 66%; }
  blockquote { margin: 8px 0; padding: 8px 12px; background: #f5f6fa; border-radius: 8px; color: #424654; }
  span[data-goal-ref], span[data-date] { background: #ebf1fc; color: #0056d2; border-radius: 4px; padding: 0 4px; font-weight: 600; font-size: 0.9em; }
  div[data-link-card] a { display: block; border: 1px solid #e1e2ec; border-radius: 10px; padding: 10px 12px; color: #0056d2; text-decoration: none; margin: 8px 0; }
  a { color: #0056d2; } p:empty { display: none; }
`;

/** Opens the print dialog for a page (where it can be saved as a PDF), from a hidden frame. */
export function printNotes(title: string, goalName: string, html: string) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return frame.remove();
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><base href="${location.origin}/"><style>${PRINT_STYLES}</style></head><body><h1>${escape(title)}</h1><p class="meta">${escape(goalName)} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>${html}</body></html>`);
  doc.close();
  // Pictures load before printing; the frame goes once the dialog closes.
  const images = Array.from(doc.images);
  Promise.all(images.map((image) => (image.complete ? Promise.resolve() : new Promise((resolve) => { image.onload = image.onerror = resolve; })))).then(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 1000);
  });
}
