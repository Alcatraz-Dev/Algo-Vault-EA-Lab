import { createCn } from "cn/config";

/**
 * `cn` — Tailwind class merging for the app.
 *
 * The project type scale lives in `app/globals.css` as plain utilities
 * (`text-micro`, `text-body-sm`, `text-meta`), so the merger cannot tell them
 * apart from `text-<colour>` classes: it files both under "text colour" and
 * keeps only the last one. Depending on the order that silently dropped the
 * font size (the element fell back to the inherited 16px) or the colour.
 *
 * Registering the sizes as `font-size` gives them their own group, so size and
 * colour survive together — `cn("text-micro …", "text-positive")` now keeps
 * both. Add any new size utility from `globals.css` to the list below.
 */
export const cn = createCn({
    extend: {
        classGroups: {
            "font-size": [{ text: ["micro", "body-sm", "meta"] }],
        },
    },
});
