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

### Rename Refactoring
Rename CSS classes across your entire project - the extension updates both the CSS file and all TypeScript/JavaScript usages:
- Position cursor on a class name (e.g., `styles.oldName`)
- Press **F2** or right-click → "Rename Symbol"
- Enter new name - all usages update automatically

```typescript
// Before: styles.oldName
<div className={styles.oldName}>

// After rename to "newName":
<div className={styles.newName}>
// CSS file also updated: .oldName → .newName
```

### Automatic .d.ts Filtering
By default, the extension uses a TypeScript plugin to automatically filter `.d.ts` declaration files from "Go to Definition" results. This means **F12** and **Ctrl+Click** will directly open CSS module files without showing intermediate type declaration files.

**How it works:**
- Uses [typescript-cleanup-definitions](https://www.npmjs.com/package/typescript-cleanup-definitions) plugin
- Filters `*.module.css`, `*.module.scss`, `*.module.sass`, `*.module.less`, `*.module.styl` from showing `.d.ts` results
- Works automatically with standard F12 / Ctrl+Click navigation
- Can be disabled via `quick-css-modules.enableTypeScriptPlugin` setting

**Alternative:** If you prefer manual control, disable the plugin and use **Ctrl+Alt+D** for filtered navigation.

## How to Use

### Navigation Shortcuts
- **F12** or **Ctrl+Click** - Direct navigation to CSS files (automatic .d.ts filtering enabled by default)
- **Ctrl+Alt+D** - Alternative navigation command with .d.ts filtering

### Available Commands
Access these commands via Command Palette (Ctrl+Shift+P):
- `Quick CSS Modules: Go to CSS Module` - Navigate to CSS module file
- `Quick CSS Modules: Go to Definition (CSS Modules Aware)` - Navigate with automatic `.d.ts` filtering

## Configuration

### Extension Settings

This extension contributes the following settings:

- `quick-css-modules.enableTypeScriptPlugin` - Enable TypeScript plugin to automatically filter .d.ts files (default: `true`). When enabled, F12/Ctrl+Click directly opens CSS modules
- `quick-css-modules.filterDeclarationFiles` - Enable/disable filtering of `.d.ts` files during navigation (default: `true`)
- `quick-css-modules.overrideGoToDefinition` - Show hint about F12 override (default: `false`)

**Recommended:** Keep `enableTypeScriptPlugin` enabled for the best experience - F12 will work like Ctrl+Alt+D automatically!

### Custom Keybindings (Optional)

If you disabled the TypeScript plugin and prefer manual keybinding override, add this to your `keybindings.json`:

```json
{
  "key": "f12",
  "command": "quick-css-modules.revealDefinition",
  "when": "editorTextFocus && (editorLangId == typescript || editorLangId == typescriptreact)"
}
```

## Supported File Types

### CSS Module Files
- `*.module.css` - Standard CSS Modules
- `*.module.scss` - Sass/SCSS Modules
- `*.module.sass` - Sass indented syntax
- `*.module.less` - LESS Modules
- `*.module.styl` / `*.module.stylus` - Stylus Modules

### Source Files
- TypeScript (`.ts`, `.tsx`)
- JavaScript (`.js`, `.jsx`)
- Vue Single File Components (`.vue`) - with `<style module>` support

## Known Issues

- **First time activation**: After installing the extension, you may need to reload VS Code window for the TypeScript plugin to activate properly
- **Import line navigation**: When using Ctrl+Click directly on the import statement, TypeScript may open the `.d.ts` declaration file
  - **Solution**: The TypeScript plugin filters most `.d.ts` results automatically, but import statements may still show type files
  - **Workaround**: Click on `styles` in the actual code (not in the import line)
- **Class detection**: The extension uses text-based search for CSS classes (`.className` pattern). This works reliably with most CSS/SCSS features including nested selectors, mixins, and variables

## Requirements

VS Code version 1.107.0 or higher

## Release Notes

### 0.0.1 - Initial Release

Features included:
- **TypeScript plugin integration** - Automatically filters .d.ts files from F12/Ctrl+Click navigation ⭐ NEW
- Smart navigation to CSS modules with Ctrl+Click
- Automatic class creation for non-existent classes
- IntelliSense autocompletion for CSS class names
- CSS preview on hover (Ctrl+Hover)
- Declaration file filtering with Ctrl+Alt+D fallback
- **Rename refactoring** - rename classes across CSS and all usages (F2)
- **Extended file format support** - .less, .styl/.stylus modules
- **Framework support** - Vue SFC with `<style module>`

---

**Enjoy!**
