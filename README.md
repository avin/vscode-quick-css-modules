# Quick CSS Modules

A VS Code extension for enhanced CSS Modules workflow with smart navigation, diagnostics, refactoring, and auto-import features.

## Features

### 🔍 Smart Navigation (Go to Definition)

Navigate from TypeScript/JavaScript code to CSS module files and class definitions:

- **Ctrl+Click** on `styles` variable → opens the CSS module file
- **Ctrl+Click** on class names (`styles.container` or `styles['container']`) → jumps to the class definition

```typescript
import styles from './Button.module.scss';

// Ctrl+Click on "styles" → opens Button.module.scss
const x = styles;

// Ctrl+Click on "container" → jumps to .container in CSS
<div className={styles.container}>

// Also works with bracket notation
<div className={styles['my-class']}>
```

### ✨ Auto-create Missing Classes

When you Ctrl+Click on a class that doesn't exist, it's automatically created in the CSS file:

```typescript
<div className={styles.newClass}>  // Ctrl+Click creates .newClass in CSS
```

### 💡 IntelliSense Autocompletion

Get autocomplete suggestions when typing `styles.` — all available CSS classes appear with preview:

```typescript
styles.  // Shows: container, title, button, ...
```

### 🔎 CSS Preview on Hover

Hover over CSS module properties to preview class content without opening the file:

```typescript
<div className={styles.container}>  // Hover shows CSS content
```

### ✏️ Rename Refactoring

Rename CSS classes across your entire project (F2):

- Position cursor on class name (`styles.oldName`)
- Press **F2** or right-click → "Rename Symbol"
- All usages in TS/JS and CSS files update automatically

### 🔗 Find All References

Find all usages of a CSS class from within CSS files (**Shift+F12**):

```scss
.container {  // Shift+F12 here → shows all TS/JS files using this class
  display: flex;
}
```

### ⚠️ Diagnostics for Missing Classes

Real-time validation of CSS class usage — non-existent classes are underlined with warnings:

```typescript
<div className={styles.nonExistent}>  // ⚠️ Warning: CSS class 'nonExistent' does not exist
```

### 🔧 Quick Fix: Create Missing Class

When a class doesn't exist, click the 💡 lightbulb to create it:

- Shows "Create CSS class '.className'" action
- Adds the class to the end of the CSS file
- Opens CSS file with cursor inside the new class

### 📦 Auto-import CSS Modules

When typing `styles.` without an import, the extension suggests classes from nearby CSS modules and auto-adds the import:

```typescript
// No import yet
styles.  // Shows classes from ComponentName.module.scss, adds import automatically
```

### 🧭 Composes Navigation

Navigate within CSS `composes` directives:

```scss
.button {
  composes: baseButton from './Base.module.scss';  // Ctrl+Click → jumps to baseButton
  composes: localStyle;  // Ctrl+Click → jumps to .localStyle in same file
}
```

### 📑 Document Symbols (Outline)

CSS module classes appear in VS Code's Outline panel (**Ctrl+Shift+O**):

- Shows all `.className` selectors
- Displays CSS properties as details
- Quick navigation within CSS files

### 🛤️ Path Aliases Support

Supports `tsconfig.json` / `jsconfig.json` path aliases:

```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@styles/*": ["src/styles/*"]
    }
  }
}
```

```typescript
import styles from '@styles/Button.module.scss';  // ✓ Resolved correctly
```

### 🔒 Automatic .d.ts Filtering

F12 and Ctrl+Click directly open CSS files without showing `.d.ts` declaration files.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `quick-css-modules.enableTypeScriptPlugin` | `true` | Filter .d.ts files from Go to Definition results |
| `quick-css-modules.enableDiagnostics` | `true` | Show warnings for non-existent CSS classes |
| `quick-css-modules.enableAutoImport` | `true` | Enable auto-import suggestions for CSS modules |
| `quick-css-modules.autoImportVariableNames` | `["styles", "classes"]` | Variable names that trigger auto-import |

### Example settings.json

```json
{
  "quick-css-modules.enableDiagnostics": true,
  "quick-css-modules.enableAutoImport": true,
  "quick-css-modules.autoImportVariableNames": ["styles", "classes", "css"]
}
```

## Supported File Types

### CSS Modules
- `.module.css` — Standard CSS
- `.module.scss` — Sass/SCSS
- `.module.sass` — Sass indented syntax
- `.module.less` — LESS
- `.module.styl` / `.module.stylus` — Stylus

### Source Files
- TypeScript (`.ts`, `.tsx`)
- JavaScript (`.js`, `.jsx`)
- Vue Single File Components (`.vue`)

## Commands

Access via Command Palette (**Ctrl+Shift+P**):

| Command | Description |
|---------|-------------|
| `Quick CSS Modules: Go to CSS Module` | Navigate to CSS module from cursor position |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+Click** / **F12** | Go to Definition (class or file) |
| **Shift+F12** | Find All References (from CSS file) |
| **F2** | Rename class across all files |
| **Ctrl+Shift+O** | Open Outline (shows CSS classes) |
| **Ctrl+.** | Quick Fix (create missing class) |

## Requirements

VS Code version 1.30.0 or higher

## Known Issues

- Import line navigation may still show `.d.ts` files — use class usages instead
- Path alias resolution requires valid `tsconfig.json` / `jsconfig.json` in workspace root

