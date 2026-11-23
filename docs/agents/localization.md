# Localization

[i18n.js](../../i18n.js) owns Finnish and English strings, locale formatting, and persistence of the language preference. Both [index.html](../../index.html) and [viewer.html](../../viewer.html) use it.

## Preserve these behaviors

- Add both Finnish and English for each new key. Use `data-text`, `data-title`, `data-aria-label`, and `data-placeholder` for static markup, and `MosaicI18n.text` for dynamic labels and feedback.
- Use the locale helpers for displayed dimensions, counts, percentages, and sorting. Keep numeric project data in numeric form and preserve user-supplied names and tags when switching languages.
- Rerender affected dynamic labels on language change. Preserve the active project, view, and selection. Keep the Finnish default and the saved preference separate from project files.

## Check changes

- Switch between both languages while the affected tool, dialog, or error is active. Verify visible labels and accessible names.
- Reload to check that the language persists. Confirm that the current project and user-entered labels survive the language switch.
