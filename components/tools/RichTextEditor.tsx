"use client";

import { useState, useRef, useEffect } from "react";
import { Image, Bold, Italic, Code, Strikethrough, List, ListOrdered, Heading1, Heading2, Quote, Link, Undo, Redo, Minimize2, Maximize2 } from "lucide-react";

interface RichTextEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    readOnly?: boolean;
}

const MARKDOWN_TOOLBAR = [
    { icon: Heading1, title: "Heading 1", prefix: "# ", suffix: "" },
    { icon: Heading2, title: "Heading 2", prefix: "## ", suffix: "" },
    { icon: Bold, title: "Bold", prefix: "**", suffix: "**" },
    { icon: Italic, title: "Italic", prefix: "*", suffix: "*" },
    { icon: Strikethrough, title: "Strikethrough", prefix: "~~", suffix: "~~" },
    { icon: Code, title: "Inline Code", prefix: "`", suffix: "`" },
    { icon: List, title: "Bullet List", prefix: "- ", suffix: "" },
    { icon: ListOrdered, title: "Numbered List", prefix: "1. ", suffix: "" },
    { icon: Quote, title: "Quote", prefix: "> ", suffix: "" },
    { icon: Link, title: "Link", prefix: "[", suffix: "](url)" },
    { icon: Image, title: "Image", prefix: "![", suffix: "](image-url)" },
];

export default function RichTextEditor({ value, onChange, placeholder = "Write your notes...", className = "", readOnly = false }: RichTextEditorProps) {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [cursorPosition, setCursorPosition] = useState({ start: 0, end: 0 });

    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            const handleSelect = () => {
                setCursorPosition({ start: textarea.selectionStart, end: textarea.selectionEnd });
            };
            textarea.addEventListener("select", handleSelect);
            textarea.addEventListener("click", handleSelect);
            textarea.addEventListener("keyup", handleSelect);
            return () => {
                textarea.removeEventListener("select", handleSelect);
                textarea.removeEventListener("click", handleSelect);
                textarea.removeEventListener("keyup", handleSelect);
            };
        }
    }, []);

    const insertMarkdown = (prefix: string, suffix: string) => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const { start, end } = cursorPosition;
        const beforeText = value.substring(0, start);
        const selectedText = value.substring(start, end);
        const afterText = value.substring(end);

        let newText = "";
        if (selectedText) {
            newText = beforeText + prefix + selectedText + suffix + afterText;
        } else {
            newText = beforeText + prefix + suffix + afterText;
        }

        onChange(newText);
        setTimeout(() => {
            textarea.focus();
            const newPos = start + prefix.length + selectedText.length;
            textarea.setSelectionRange(newPos, newPos);
            setCursorPosition({ start: newPos, end: newPos });
        }, 0);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "b") {
            e.preventDefault();
            insertMarkdown("**", "**");
        } else if ((e.metaKey || e.ctrlKey) && e.key === "i") {
            e.preventDefault();
            insertMarkdown("*", "*");
        } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            insertMarkdown("", "\n");
        }
    };

    return (
        <div className={`rounded-2xl border border-border bg-card overflow-hidden ${isFullscreen ? "fixed inset-0 z-50 h-full w-full" : ""} ${className}`}>
            {!readOnly && (
                <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5 bg-muted/30">
                    {MARKDOWN_TOOLBAR.map((tool) => (
                        <button
                            key={tool.title}
                            type="button"
                            onClick={() => insertMarkdown(tool.prefix, tool.suffix)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition"
                            title={tool.title}
                        >
                            <tool.icon size={14} />
                        </button>
                    ))}
                    <div className="w-px h-6 bg-border mx-1" />
                    <div className="flex items-center gap-1 ml-auto">
                        <button
                            type="button"
                            onClick={() => setShowPreview(!showPreview)}
                            className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition ${showPreview ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                            title={showPreview ? "Edit" : "Preview"}
                        >
                            {showPreview ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition"
                            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                        >
                            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        </button>
                    </div>
                </div>
            )}

            <div className={isFullscreen ? "h-[calc(100%-48px)]" : "min-h-[300px]"}>
                {showPreview && !readOnly ? (
                    <div className="p-4 prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: value }} />
                ) : (
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onSelect={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            setCursorPosition({ start: target.selectionStart, end: target.selectionEnd });
                        }}
                        onClick={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            setCursorPosition({ start: target.selectionStart, end: target.selectionEnd });
                        }}
                        onKeyUp={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            setCursorPosition({ start: target.selectionStart, end: target.selectionEnd });
                        }}
                        placeholder={placeholder}
                        className="w-full h-full resize-none border-none bg-transparent p-4 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                        spellCheck={false}
                        readOnly={readOnly}
                    />
                )}
            </div>

            {!readOnly && !showPreview && (
                <div className="border-t border-border px-3 py-2 bg-muted/30 text-xs text-muted-foreground flex flex-wrap gap-4">
                    <span>**Bold** (⌘B)</span>
                    <span>*Italic* (⌘I)</span>
                    <span>\`Code\`</span>
                    <span>~~Strikethrough~~</span>
                    <span>- List</span>
                    <span>1. Numbered</span>
                    <span>{'>'} Quote</span>
                    <span>[Link](url)</span>
                    <span>![Image](url)</span>
                </div>
            )}
        </div>
    );
}