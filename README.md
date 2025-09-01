# Vanilla Task Manager (HTML/CSS/JS)

A clean, framework-free task manager to showcase **semantic HTML**, **modern CSS** (Grid/Flex, custom properties), and **vanilla ES modules** with **LocalStorage** persistence, filters, and **drag-and-drop** reordering.

## Features
- Add tasks with **title, due date, priority, tags**
- **Search & filter** by text, tag, priority, due window (today/week/overdue)
- **Drag-and-drop** task reordering (HTML5 DnD, event delegation)
- **LocalStorage** persistence
- **Keyboard shortcuts**: `n` (new task), `/` (focus search)
- **Responsive** layout, accessible labels and live regions

## Structure
```
task-manager/
  index.html
  css/
    styles.css
  js/
    app.js        # wires UI + store + filters; events & seed
    store.js      # LocalStorage CRUD
    filters.js    # pure filter logic
    ui.js         # rendering + delete + DnD hookup
    dnd.js        # event-delegated drag & drop utilities
  assets/
    icons.svg
  tests/
    (placeholder for future Jest tests)
```

## Run
Just open `index.html` in your browser — no build step required.

> Tip: Commit this to GitHub and enable **GitHub Pages** (root).

## Next Steps (to impress reviewers)
- Add **edit** in-place (double‑click title → input).
- **Kanban** view (columns: Backlog/In Progress/Done).
- **Undo** stack for delete.
- **PWA** (service worker, offline installable).
- **Unit tests** for `filters.js` and `store.js` with Jest + jsdom.
- Add a **README** screenshot or GIF demo and note performance/accessibility scores.
