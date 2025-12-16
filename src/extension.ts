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

	const definitionProvider = vscode.languages.registerDefinitionProvider(
		selector,
		new CSSModuleDefinitionProvider()
	);

	context.subscriptions.push(definitionProvider);
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
