import * as vscode from 'vscode';
import * as path from 'path';

interface CSSModuleImport {
	variableName: string;
	filePath: string;
	range: vscode.Range;
}

export function activate(context: vscode.ExtensionContext) {
	console.log('CSS Modules extension is now active!');

	// Регистрируем Definition Provider для TypeScript, JavaScript, TSX, JSX
	const selector = [
		{ scheme: 'file', language: 'typescript' },
		{ scheme: 'file', language: 'javascript' },
		{ scheme: 'file', language: 'typescriptreact' },
		{ scheme: 'file', language: 'javascriptreact' }
	];

	const provider = new CSSModuleDefinitionProvider();
	
	const definitionProvider = vscode.languages.registerDefinitionProvider(
		selector,
		provider
	);

	// Регистрируем Hover Provider для показа CSS классов
	const hoverProvider = vscode.languages.registerHoverProvider(
		selector,
		new CSSModuleHoverProvider()
	);

	// Регистрируем Completion Provider для автодополнения классов
	const completionProvider = vscode.languages.registerCompletionItemProvider(
		selector,
		new CSSModuleCompletionProvider(),
		'.' // Триггер - точка
	);

	// Регистрируем команду для явного перехода к CSS модулю
	const goToCSSModuleCommand = vscode.commands.registerCommand('quick-css-modules.goToCSSModule', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		const position = editor.selection.active;
		const locations = await provider.provideDefinition(editor.document, position, new vscode.CancellationTokenSource().token);
		
		if (locations) {
			const locationArray = Array.isArray(locations) ? locations : [locations];
			const location = locationArray[0] as vscode.Location;
			
			if (location && location.uri) {
				await vscode.window.showTextDocument(location.uri, {
					selection: location.range
				});
			}
		} else {
			vscode.window.showInformationMessage('No CSS module found at cursor position');
		}
	});

	// Добавляем настройку для фильтрации .d.ts файлов
	const config = vscode.workspace.getConfiguration('quick-css-modules');
	const filterDTS = config.get<boolean>('filterDeclarationFiles', true);

	if (filterDTS) {
		// Перехватываем клики и фильтруем результаты
		setupDefinitionFilter(context);
	}

	// Проверяем, нужно ли переопределить F12
	const overrideF12 = config.get<boolean>('overrideGoToDefinition', false);
	if (overrideF12) {
		vscode.window.showInformationMessage(
			'CSS Modules: To override F12, please manually add this to your keybindings.json:\n' +
			'{ "key": "f12", "command": "quick-css-modules.revealDefinition", "when": "editorTextFocus" }'
		);
	}

	context.subscriptions.push(definitionProvider, hoverProvider, completionProvider, goToCSSModuleCommand);
}

function setupDefinitionFilter(context: vscode.ExtensionContext) {
	// Перехватываем команду editor.action.revealDefinition
	const originalCommand = 'editor.action.revealDefinition';
	
	// Регистрируем обработчик для текущего редактора
	context.subscriptions.push(
		vscode.commands.registerCommand('quick-css-modules.revealDefinition', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return vscode.commands.executeCommand(originalCommand);
			}

			const position = editor.selection.active;
			const document = editor.document;
			
			// Проверяем, является ли это CSS модулем
			const wordRange = document.getWordRangeAtPosition(position);
			if (!wordRange) {
				return vscode.commands.executeCommand(originalCommand);
			}

			const word = document.getText(wordRange);
			const helper = new CSSModuleDefinitionProvider();
			const cssImports = helper['findCSSModuleImports'](document);
			
			// Если это переменная CSS модуля или её свойство - используем наш провайдер
			const isCSSModule = cssImports.some(imp => imp.variableName === word) ||
				isCSSModuleProperty(document, position, word, cssImports);
			
			if (isCSSModule) {
				// Получаем все определения
				const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
					'vscode.executeDefinitionProvider',
					document.uri,
					position
				);
				
				if (definitions && definitions.length > 0) {
					// Фильтруем .d.ts файлы
					const filtered = definitions.filter(def => {
						if (!def) {
							return false;
						}
						// Проверяем Location
						if ('uri' in def && def.uri) {
							return !def.uri.fsPath.endsWith('.d.ts');
						}
						// Проверяем LocationLink
						if ('targetUri' in def && def.targetUri) {
							return !def.targetUri.fsPath.endsWith('.d.ts');
						}
						return false;
					});
					
					if (filtered.length > 0) {
						// Переходим к первому отфильтрованному результату
						const target = filtered[0];
						
						let uri: vscode.Uri;
						let range: vscode.Range;
						
						if ('targetUri' in target) {
							uri = target.targetUri;
							range = target.targetRange;
						} else {
							uri = target.uri;
							range = target.range;
						}
						
						await vscode.window.showTextDocument(uri, {
							selection: range
						});
						return;
					}
				}
			}
			
			// В остальных случаях - вызываем стандартную команду
			return vscode.commands.executeCommand(originalCommand);
		})
	);
}

function isCSSModuleProperty(
	document: vscode.TextDocument,
	position: vscode.Position,
	word: string,
	cssImports: CSSModuleImport[]
): boolean {
	const line = document.lineAt(position.line).text;
	const wordRange = document.getWordRangeAtPosition(position);
	
	if (!wordRange) {
		return false;
	}

	// Проверяем objectName.property
	const beforeWord = line.substring(0, wordRange.start.character);
	const dotMatch = beforeWord.match(/(\w+)\.$/);
	
	if (dotMatch) {
		return cssImports.some(imp => imp.variableName === dotMatch[1]);
	}

	// Проверяем property после objectName
	const afterWord = line.substring(wordRange.end.character);
	if (afterWord.startsWith('.')) {
		return cssImports.some(imp => imp.variableName === word);
	}

	return false;
}

export function deactivate() {}

class CSSModuleDefinitionProvider implements vscode.DefinitionProvider {
	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.Definition | undefined> {
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return undefined;
		}

		const word = document.getText(wordRange);

		// Ищем все импорты CSS модулей в документе
		const cssModuleImports = this.findCSSModuleImports(document);
		
		// Если нет импортов CSS модулей - не обрабатываем
		if (cssModuleImports.length === 0) {
			return undefined;
		}
		
		// Проверяем, не кликнули ли на свойство объекта (например, styles.className)
		const propertyMatch = this.getPropertyAccess(document, position, word);
		if (propertyMatch) {
			const { objectName, propertyName } = propertyMatch;
			
			// Ищем соответствующий импорт
			const cssImport = cssModuleImports.find(imp => imp.variableName === objectName);
			if (cssImport) {
				// Ищем или создаем класс в CSS модуле
				return this.findOrCreateCSSClass(document, cssImport.filePath, propertyName);
			}
		}

		// Проверяем, не кликнули ли на переменную CSS модуля (например, "styles")
		// Это должно быть после проверки свойств, чтобы styles.className обрабатывался правильно
		const cssImport = cssModuleImports.find(imp => imp.variableName === word);
		if (cssImport) {
			// Клик по переменной импорта - открываем файл модуля
			return this.openCSSModuleFile(document, cssImport.filePath);
		}

		return undefined;
	}

	private findCSSModuleImports(document: vscode.TextDocument): CSSModuleImport[] {
		const imports: CSSModuleImport[] = [];
		const text = document.getText();
		
		// Regex для поиска импортов вида: import styles from './file.module.scss'
		const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.(scss|css))['"]/g;
		
		let match;
		while ((match = importRegex.exec(text)) !== null) {
			const variableName = match[1];
			const relativePath = match[2];
			
			// Вычисляем абсолютный путь к файлу
			const documentDir = path.dirname(document.uri.fsPath);
			const absolutePath = path.resolve(documentDir, relativePath);
			
			// Находим позицию переменной в документе
			const startPos = document.positionAt(match.index + match[0].indexOf(variableName));
			const endPos = document.positionAt(match.index + match[0].indexOf(variableName) + variableName.length);
			
			imports.push({
				variableName,
				filePath: absolutePath,
				range: new vscode.Range(startPos, endPos)
			});
		}
		
		return imports;
	}

	private getPropertyAccess(
		document: vscode.TextDocument,
		position: vscode.Position,
		word: string
	): { objectName: string; propertyName: string } | undefined {
		const line = document.lineAt(position.line).text;
		const wordRange = document.getWordRangeAtPosition(position);
		
		if (!wordRange) {
			return undefined;
		}

		const beforeWord = line.substring(0, wordRange.start.character);
		const dotMatch = beforeWord.match(/(\w+)\.$/);
		
		if (dotMatch) {
			// Кликнули на propertyName в objectName.propertyName
			return {
				objectName: dotMatch[1],
				propertyName: word
			};
		}

		// Проверяем, не кликнули ли на objectName в objectName.propertyName
		const afterWord = line.substring(wordRange.end.character);
		if (afterWord.startsWith('.')) {
			const propertyMatch = afterWord.match(/^\.(\w+)/);
			if (propertyMatch) {
				return {
					objectName: word,
					propertyName: propertyMatch[1]
				};
			}
		}

		return undefined;
	}

	private async openCSSModuleFile(
		document: vscode.TextDocument,
		cssFilePath: string
	): Promise<vscode.Location | undefined> {
		try {
			const uri = vscode.Uri.file(cssFilePath);
			return new vscode.Location(uri, new vscode.Position(0, 0));
		} catch (error) {
			console.error('Error opening CSS module file:', error);
			return undefined;
		}
	}

	private async findOrCreateCSSClass(
		document: vscode.TextDocument,
		cssFilePath: string,
		className: string
	): Promise<vscode.Location | undefined> {
		try {
			const uri = vscode.Uri.file(cssFilePath);
			
			// Читаем содержимое CSS файла
			let cssDocument: vscode.TextDocument;
			try {
				cssDocument = await vscode.workspace.openTextDocument(uri);
			} catch (error) {
				// Файл не существует - создаем его
				const workspaceEdit = new vscode.WorkspaceEdit();
				workspaceEdit.createFile(uri, { ignoreIfExists: true });
				await vscode.workspace.applyEdit(workspaceEdit);
				cssDocument = await vscode.workspace.openTextDocument(uri);
			}

			const cssContent = cssDocument.getText();
			
			// Ищем класс в CSS файле (простой поиск подстроки .className)
			const classPattern = `.${className}`;
			const classIndex = cssContent.indexOf(classPattern);
			
			if (classIndex !== -1) {
				// Класс найден - переходим к нему
				const position = cssDocument.positionAt(classIndex);
				return new vscode.Location(uri, position);
			} else {
				// Класс не найден - создаем его
				const newClass = `\n.${className} {\n\t\n}\n`;
				const workspaceEdit = new vscode.WorkspaceEdit();
				
				// Добавляем класс в конец файла
				const lastLine = cssDocument.lineCount;
				const insertPosition = new vscode.Position(lastLine, 0);
				workspaceEdit.insert(uri, insertPosition, newClass);
				
				await vscode.workspace.applyEdit(workspaceEdit);
				
				// Пересохраняем документ
				await cssDocument.save();
				
				// Возвращаем позицию нового класса
				const newPosition = new vscode.Position(lastLine + 1, 0);
				return new vscode.Location(uri, newPosition);
			}
		} catch (error) {
			console.error('Error finding or creating CSS class:', error);
			vscode.window.showErrorMessage(`Failed to process CSS class: ${error}`);
			return undefined;
		}
	}
}

class CSSModuleHoverProvider implements vscode.HoverProvider {
	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.Hover | undefined> {
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return undefined;
		}

		const word = document.getText(wordRange);
		
		// Ищем все импорты CSS модулей
		const cssImports = this.findCSSModuleImports(document);
		if (cssImports.length === 0) {
			return undefined;
		}

		// Проверяем, является ли это свойством CSS модуля (styles.className)
		const propertyMatch = this.getPropertyAccess(document, position, word);
		if (!propertyMatch) {
			return undefined;
		}

		const { objectName, propertyName } = propertyMatch;
		
		// Ищем соответствующий импорт
		const cssImport = cssImports.find(imp => imp.variableName === objectName);
		if (!cssImport) {
			return undefined;
		}

		// Читаем CSS файл и ищем класс
		try {
			const uri = vscode.Uri.file(cssImport.filePath);
			const cssDocument = await vscode.workspace.openTextDocument(uri);
			const cssContent = cssDocument.getText();
			
			// Ищем класс в CSS файле
			const classPattern = `.${propertyName}`;
			const classIndex = cssContent.indexOf(classPattern);
			
			if (classIndex === -1) {
				return new vscode.Hover(
					new vscode.MarkdownString(`**CSS Module Class**\n\nClass \`.${propertyName}\` not found. Click to create.`)
				);
			}

			// Извлекаем содержимое класса
			const classContent = this.extractClassContent(cssContent, classIndex);
			
			const markdown = new vscode.MarkdownString();
			markdown.appendCodeblock(classContent, 'scss');
			markdown.appendText(`\n\nFrom: ${path.basename(cssImport.filePath)}`);
			
			return new vscode.Hover(markdown);
		} catch (error) {
			console.error('Error reading CSS file:', error);
			return undefined;
		}
	}

	private extractClassContent(cssContent: string, classIndex: number): string {
		// Находим начало класса
		let start = classIndex;
		
		// Ищем открывающую скобку
		const openBraceIndex = cssContent.indexOf('{', start);
		if (openBraceIndex === -1) {
			return cssContent.substring(start, Math.min(start + 100, cssContent.length));
		}

		// Ищем закрывающую скобку (учитываем вложенность)
		let depth = 0;
		let closeBraceIndex = openBraceIndex;
		
		for (let i = openBraceIndex; i < cssContent.length; i++) {
			if (cssContent[i] === '{') {
				depth++;
			} else if (cssContent[i] === '}') {
				depth--;
				if (depth === 0) {
					closeBraceIndex = i;
					break;
				}
			}
		}

		// Извлекаем весь класс
		const classContent = cssContent.substring(start, closeBraceIndex + 1);
		
		return classContent;
	}

	private findCSSModuleImports(document: vscode.TextDocument): CSSModuleImport[] {
		const imports: CSSModuleImport[] = [];
		const text = document.getText();
		
		const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.(scss|css))['"]/g;
		
		let match;
		while ((match = importRegex.exec(text)) !== null) {
			const variableName = match[1];
			const relativePath = match[2];
			
			const documentDir = path.dirname(document.uri.fsPath);
			const absolutePath = path.resolve(documentDir, relativePath);
			
			const startPos = document.positionAt(match.index + match[0].indexOf(variableName));
			const endPos = document.positionAt(match.index + match[0].indexOf(variableName) + variableName.length);
			
			imports.push({
				variableName,
				filePath: absolutePath,
				range: new vscode.Range(startPos, endPos)
			});
		}
		
		return imports;
	}

	private getPropertyAccess(
		document: vscode.TextDocument,
		position: vscode.Position,
		word: string
	): { objectName: string; propertyName: string } | undefined {
		const line = document.lineAt(position.line).text;
		const wordRange = document.getWordRangeAtPosition(position);
		
		if (!wordRange) {
			return undefined;
		}

		const beforeWord = line.substring(0, wordRange.start.character);
		const dotMatch = beforeWord.match(/(\w+)\.$/);
		
		if (dotMatch) {
			return {
				objectName: dotMatch[1],
				propertyName: word
			};
		}

		const afterWord = line.substring(wordRange.end.character);
		if (afterWord.startsWith('.')) {
			const propertyMatch = afterWord.match(/^\.(\w+)/);
			if (propertyMatch) {
				return {
					objectName: word,
					propertyName: propertyMatch[1]
				};
			}
		}

		return undefined;
	}
}

class CSSModuleCompletionProvider implements vscode.CompletionItemProvider {
	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		context: vscode.CompletionContext
	): Promise<vscode.CompletionItem[] | undefined> {
		const line = document.lineAt(position.line).text;
		const textBeforeCursor = line.substring(0, position.character);
		
		// Ищем паттерн "variableName." или "variableName.partialText"
		const match = textBeforeCursor.match(/(\w+)\.(\w*)$/);
		if (!match) {
			return undefined;
		}

		const variableName = match[1];

		// Ищем импорты CSS модулей
		const cssImports = this.findCSSModuleImports(document);
		const cssImport = cssImports.find(imp => imp.variableName === variableName);
		
		if (!cssImport) {
			return undefined;
		}

		// Читаем CSS файл и извлекаем все классы
		try {
			const uri = vscode.Uri.file(cssImport.filePath);
			const cssDocument = await vscode.workspace.openTextDocument(uri);
			const cssContent = cssDocument.getText();
			
			const classNames = this.extractClassNames(cssContent);
			
			// Создаем completion items
			return classNames.map(className => {
				const item = new vscode.CompletionItem(className, vscode.CompletionItemKind.Property);
				item.detail = `CSS Module class from ${path.basename(cssImport.filePath)}`;
				
				// Добавляем документацию с превью класса
				const classContent = this.getClassPreview(cssContent, className);
				if (classContent) {
					item.documentation = new vscode.MarkdownString();
					item.documentation.appendCodeblock(classContent, 'scss');
				}
				
				return item;
			});
		} catch (error) {
			console.error('Error reading CSS file for completion:', error);
			return undefined;
		}
	}

	private extractClassNames(cssContent: string): string[] {
		const classNames = new Set<string>();
		
		// Regex для поиска классов: .className
		// Поддерживает простые классы и вложенные
		const classRegex = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g;
		
		let match;
		while ((match = classRegex.exec(cssContent)) !== null) {
			const className = match[1];
			// Исключаем псевдоклассы и псевдоэлементы
			if (!className.startsWith(':') && !className.startsWith('::')) {
				classNames.add(className);
			}
		}
		
		return Array.from(classNames).sort();
	}

	private getClassPreview(cssContent: string, className: string): string | undefined {
		const classPattern = `.${className}`;
		const classIndex = cssContent.indexOf(classPattern);
		
		if (classIndex === -1) {
			return undefined;
		}

		// Ищем открывающую скобку
		const openBraceIndex = cssContent.indexOf('{', classIndex);
		if (openBraceIndex === -1) {
			return undefined;
		}

		// Ищем закрывающую скобку
		let depth = 0;
		let closeBraceIndex = openBraceIndex;
		
		for (let i = openBraceIndex; i < cssContent.length; i++) {
			if (cssContent[i] === '{') {
				depth++;
			} else if (cssContent[i] === '}') {
				depth--;
				if (depth === 0) {
					closeBraceIndex = i;
					break;
				}
			}
		}

		return cssContent.substring(classIndex, closeBraceIndex + 1);
	}

	private findCSSModuleImports(document: vscode.TextDocument): CSSModuleImport[] {
		const imports: CSSModuleImport[] = [];
		const text = document.getText();
		
		const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.(scss|css))['"]/g;
		
		let match;
		while ((match = importRegex.exec(text)) !== null) {
			const variableName = match[1];
			const relativePath = match[2];
			
			const documentDir = path.dirname(document.uri.fsPath);
			const absolutePath = path.resolve(documentDir, relativePath);
			
			const startPos = document.positionAt(match.index + match[0].indexOf(variableName));
			const endPos = document.positionAt(match.index + match[0].indexOf(variableName) + variableName.length);
			
			imports.push({
				variableName,
				filePath: absolutePath,
				range: new vscode.Range(startPos, endPos)
			});
		}
		
		return imports;
	}
}
