# Quick CSS Modules

Удобная работа с CSS модулями в VSCode - навигация по классам и автоматическое создание.

## Возможности

### 1. Ctrl+Click по переменной CSS модуля
Кликните на переменную `styles` в коде (не в строке импорта) - откроется CSS/SCSS модуль:
```typescript
import styles from './Button.module.scss';

const x = styles; // Ctrl+Click на "styles" → откроется Button.module.scss
```

### 2. Ctrl+Click по классу
Кликните на свойство CSS модуля - переход к классу в файле:
```typescript
<div className={styles.container}>  // Ctrl+Click на "container" → переход к .container
```

### 3. Автосоздание классов
Если класс не существует - он будет создан автоматически:
```typescript
<div className={styles.newClass}>  // Ctrl+Click создаст .newClass { } в CSS файле
```

### 4. Фильтрация .d.ts файлов (новое!)
Используйте **Ctrl+Alt+D** вместо F12 для перехода, который автоматически отфильтрует `.d.ts` файлы и перейдет сразу в CSS модуль.

## Использование

### Основной способ (работает всегда):
- **Ctrl+Click** (F12) на `styles.className` в коде
- **Ctrl+Click** (F12) на `styles` в использовании (не в импорте)

### Альтернативный способ (фильтрует .d.ts):
- **Ctrl+Alt+D** на любом месте CSS модуля - автоматически откроет CSS файл вместо `.d.ts`

### Команды:
- `Quick CSS Modules: Go to CSS Module` - явный переход к CSS модулю
- `Quick CSS Modules: Go to Definition (CSS Modules Aware)` - переход с фильтрацией .d.ts

## Настройки

```json
{
  // Фильтровать .d.ts файлы при навигации (по умолчанию: true)
  "quick-css-modules.filterDeclarationFiles": true,
  
  // Показать подсказку об переопределении F12 (по умолчанию: false)
  "quick-css-modules.overrideGoToDefinition": false
}
```

## Переопределение F12 (опционально)

Если хотите, чтобы **F12** всегда фильтровал `.d.ts` файлы, добавьте в `keybindings.json`:

```json
{
  "key": "f12",
  "command": "quick-css-modules.revealDefinition",
  "when": "editorTextFocus && (editorLangId == typescript || editorLangId == typescriptreact)"
}
```

## Поддерживаемые форматы

- `*.module.css`
- `*.module.scss`
- `*.module.sass` (добавить легко)

## Поддерживаемые языки

- TypeScript (`.ts`)
- TypeScript React (`.tsx`)
- JavaScript (`.js`)
- JavaScript React (`.jsx`)

## Известные ограничения

- При Ctrl+Click **в строке импорта** TypeScript может показать `.d.ts` файл первым
  - **Решение**: используйте Ctrl+Alt+D или кликайте на `styles` в месте использования
- Поиск классов работает через простой текстовый поиск `.className`
  - Это работает с вложенными селекторами, миксинами и т.д.

## Требования

- VS Code 1.107.0 или выше

## Release Notes

### 0.0.1

Первый релиз:
- Навигация по CSS модулям
- Автосоздание классов
- Фильтрация .d.ts файлов
- Альтернативный кейбиндинг Ctrl+Alt+D
