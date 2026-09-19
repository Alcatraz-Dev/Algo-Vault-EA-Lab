/**
 * Minimal Markdown renderer for AI responses inside the popup.
 *
 * Purpose-built so long AI replies render completely in the scrollable popup
 * container — no `...` truncation — while keeping the bundle dependency-free.
 * Supports: headings, bold/italic, inline code, fenced code blocks, bullet &
 * numbered lists, blockquotes, horizontal rules and paragraphs.
 */
import React from "react";

const INLINE_BOLD = /\*\*([^*]+)\*\*/g;
const INLINE_ITALIC = /(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g;
const INLINE_CODE = /`([^`]+)`/g;

interface InlineProps {
  text: string;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Split code spans first so we never touch characters inside them.
  const segments = text.split(/(`[^`]+`)/g);
  const out: React.ReactNode[] = [];

  segments.forEach((seg, idx) => {
    if (seg.startsWith("`") && seg.endsWith("`") && seg.length > 2) {
      out.push(
        <code
          key={`${keyPrefix}-c${idx}`}
          style={{
            background: "rgba(139, 92, 246, 0.12)",
            padding: "0 4px",
            borderRadius: 4,
            fontFamily: "monospace",
            fontSize: "0.92em",
            color: "#c4b5fd",
          }}
        >
          {seg.slice(1, -1)}
        </code>
      );
      return;
    }

    // Bold within the segment.
    const boldParts = seg.split(INLINE_BOLD);
    boldParts.forEach((boldPart, boldIdx) => {
      if (boldIdx % 2 === 1) {
        out.push(
          <strong key={`${keyPrefix}-b${idx}-${boldIdx}`} style={{ fontWeight: 700, color: "#f0f0f5" }}>
            {boldPart}
          </strong>
        );
        return;
      }
      // Italic within the segment.
      const italicParts = boldPart.split(INLINE_ITALIC);
      italicParts.forEach((italPart, italIdx) => {
        if (italIdx % 3 === 1 && italPart) {
          out.push(
            <em key={`${keyPrefix}-i${idx}-${boldIdx}-${italIdx}`} style={{ fontStyle: "italic", color: "#d6d6e8" }}>
              {italPart}
            </em>
          );
        } else if (italPart) {
          out.push(<React.Fragment key={`${keyPrefix}-f${idx}-${boldIdx}-${italIdx}`}>{italPart}</React.Fragment>);
        }
      });
    });
  });

  return out;
}

function bulletIcon(index: number, ordered: boolean): string {
  return ordered ? `${index}.` : "•";
}

export function Markdown({ content }: { content: string }): React.ReactElement {
  const blocks = content.split(/\n{2,}/);

  return (
    <div style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
      {blocks.map((block, blockIdx) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Fenced code block.
        const fenceMatch = trimmed.match(/^```(\w*)\n([\s\S]*?)\n```$/);
        if (fenceMatch) {
          return (
            <pre
              key={`${blockIdx}`}
              style={{
                background: "rgba(0,0,0,0.35)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                padding: "8px 10px",
                overflowX: "auto",
                fontSize: 10,
                fontFamily: "monospace",
                color: "#c4b5fd",
                marginTop: 4,
                whiteSpace: "pre",
              }}
            >
              {fenceMatch[2]}
            </pre>
          );
        }

        // Fenced code block without trailing newline.
        if (trimmed.startsWith("```")) {
          const inner = trimmed.replace(/^```\w*/, "").replace(/```$/, "").trim();
          return (
            <pre
              key={`${blockIdx}`}
              style={{
                background: "rgba(0,0,0,0.35)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                padding: "8px 10px",
                overflowX: "auto",
                fontSize: 10,
                fontFamily: "monospace",
                color: "#c4b5fd",
                marginTop: 4,
                whiteSpace: "pre",
              }}
            >
              {inner}
            </pre>
          );
        }

        // Headings.
        const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const size = level === 1 ? 14 : level === 2 ? 13 : level === 3 ? 12 : 11;
          return (
            <div
              key={`${blockIdx}`}
              style={{
                fontSize: size,
                fontWeight: 700,
                color: "#e9e4ff",
                marginTop: level <= 2 ? 8 : 4,
                marginBottom: 4,
              }}
            >
              {renderInline(headingMatch[2], `h${blockIdx}`)}
            </div>
          );
        }

        // Bullet / numbered list block.
        if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
          const ordered = /^\d+\.\s+/.test(trimmed);
          const items = block.split("\n").filter((l) => l.trim());
          return (
            <div key={`${blockIdx}`} style={{ marginTop: 2, marginBottom: 2 }}>
              {items.map((item, itemIdx) => {
                const clean = item.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "").trim();
                return (
                  <div key={`${itemIdx}`} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 2 }}>
                    <span style={{ color: "#a78bfa", flexShrink: 0 }}>{bulletIcon(itemIdx + 1, ordered)}</span>
                    <span>{renderInline(clean, `li${blockIdx}-${itemIdx}`)}</span>
                  </div>
                );
              })}
            </div>
          );
        }

        // Blockquote.
        if (trimmed.startsWith(">")) {
          return (
            <div
              key={`${blockIdx}`}
              style={{
                borderLeft: "3px solid #7c3aed",
                paddingLeft: 10,
                color: "#b8b8cf",
                fontStyle: "italic",
                margin: "4px 0",
              }}
            >
              {renderInline(trimmed.replace(/^>\s?/, ""), `q${blockIdx}`)}
            </div>
          );
        }

        // Horizontal rule.
        if (/^([-*_])\1{2,}$/.test(trimmed)) {
          return (
            <div
              key={`${blockIdx}`}
              style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "8px 0" }}
            />
          );
        }

        // Regular paragraph (preserve inner line breaks).
        return (
          <p key={`${blockIdx}`} style={{ margin: "3px 0", lineHeight: 1.55 }}>
            {block.split("\n").map((line, lineIdx) => (
              <React.Fragment key={`${lineIdx}`}>
                {renderInline(line, `p${blockIdx}-${lineIdx}`)}
                {lineIdx < block.split("\n").length - 1 && <br />}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}