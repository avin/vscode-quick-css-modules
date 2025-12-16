# Quick CSS Modules

A VS Code extension that enhances CSS Modules workflow with smart navigation, autocomplete, and auto-creation features.

## Features

### Smart Navigation
Navigate from TypeScript/JavaScript code to CSS module files and specific class definitions:
- **Ctrl+Click** on `styles` variable to open the CSS module file
- **Ctrl+Click** on class names (e.g., `styles.container`) to jump directly to the class definition in the CSS file

```typescript
import styles from './Button.module.scss';

// Ctrl+Click on "styles" → opens Button.module.scss
const x = styles;

// Ctrl+Click on "container" → jumps to .container in CSS
<div className={styles.container}>
```

### Auto-create Missing Classes
When you Ctrl+Click on a class that doesn't exist, the extension automatically creates it in the CSS file with a basic template:
```typescript
// Ctrl+Click on non-existent class
<div className={styles.newClass}>
```
Creates in CSS:
```css
.newClass {
  
}
```

### IntelliSense Autocompletion
Get autocomplete suggestions when typing `styles.` - all available CSS classes appear in the suggestion list with their full content in the documentation preview.

```typescript
styles.  // ← IntelliSense shows: container, title, button, ...
```

### CSS Preview on Hover
Hover over CSS module properties with **Ctrl** held down to preview the class content without opening the file:
```typescript
<div className={styles.container}>  // Ctrl+Hover shows CSS content
```

### Filter Declaration Files
Use **Ctrl+Alt+D** for navigation that skips TypeScript `.d.ts` declaration files and goes directly to the CSS module file.

## How to Use

### Navigation Shortcuts
- **F12** or **Ctrl+Click** - Standard "Go to Definition" (works on both `styles` variable and class names)
- **Ctrl+Alt+D** - Enhanced navigation that filters out `.d.ts` files (recommended for CSS modules)

### Available Commands
Access these commands via Command Palette (Ctrl+Shift+P):
- `Quick CSS Modules: Go to CSS Module` - Navigate to CSS module file
- `Quick CSS Modules: Go to Definition (CSS Modules Aware)` - Navigate with automatic `.d.ts` filtering

## Configuration

### Extension Settings

This extension contributes the following settings:

- `quick-css-modules.filterDeclarationFiles` - Enable/disable filtering of `.d.ts` files during navigation (default: `true`)
- `quick-css-modules.overrideGoToDefinition` - Show hint about F12 override (default: `false`)

### Custom Keybindings

You can override the default F12 behavior to always filter `.d.ts` files. Add this to your `keybindings.json`:

```json
{
  "key": "f12",
  "command": "quick-css-modules.revealDefinition",
  "when": "editorTextFocus && (editorLangId == typescript || editorLangId == typescriptreact)"
}
```

## Supported File Types

### CSS Module Files
- `*.module.css`
- `*.module.scss`
- `*.module.sass`

### Source Files
- TypeScript (`.ts`, `.tsx`)
- JavaScript (`.js`, `.jsx`)

## Known Issues

- **Import line navigation**: When using Ctrl+Click directly on the import statement, TypeScript may open the `.d.ts` declaration file instead of the CSS module. 
  - **Workaround**: Use Ctrl+Alt+D, or click on `styles` in the actual code (not in the import line)
  
- **Class detection**: The extension uses text-based search for CSS classes (`.className` pattern). This approach works reliably with most CSS/SCSS features including nested selectors, mixins, and variables.

## Requirements

VS Code version 1.107.0 or higher

## Release Notes

### 0.0.1 - Initial Release

Features included:
- Smart navigation to CSS modules with Ctrl+Click
- Automatic class creation for non-existent classes
- IntelliSense autocompletion for CSS class names
- CSS preview on hover (Ctrl+Hover)
- Declaration file filtering
- Enhanced navigation keybinding (Ctrl+Alt+D)

---

**Enjoy!**
