"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown renderer for assistant chat messages. GFM-enabled (the deck advisor
 * is prompted to use tables for number comparisons) and styled inline via
 * component overrides — the app has no typography plugin, and the chat needs
 * tighter spacing than document prose anyway. Re-parses on every stream delta,
 * which is fine at chat-message sizes.
 */

const components: Components = {
  h1: ({ children }) => <h3 className="mt-3 mb-1.5 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="[&>p]:my-0">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: ({ children, className }) =>
    // Block code gets a language-* class from the fence; inline code doesn't.
    className ? (
      <code className={`${className} font-mono text-xs`}>{children}</code>
    ) : (
      <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="bg-muted my-1.5 overflow-x-auto rounded-md p-2 text-xs">{children}</pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-muted-foreground/30 my-1.5 border-l-2 pl-3">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-2" />,
  table: ({ children }) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-border border px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-border border px-2 py-1">{children}</td>
};

export default function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
