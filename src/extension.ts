import * as vscode from 'vscode';
import * as path from 'path';

interface CSSModuleImport {
	variableName: string;
	filePath: string;
	range: vscode.Range;
}

export function activate(context: vscode.ExtensionContext) {
	console.log('CSS Modules extension is now active!');

	// Register Definition Provider for TypeScript, JavaScript, TSX, JSX, Vue
	const selector = [
		{ scheme: 'file', language: 'typescript' },
		{ scheme: 'file', language: 'javascript' },
		{ scheme: 'file', language: 'typescriptreact' },
		{ scheme: 'file', language: 'javascriptreact' },
		{ scheme: 'file', language: 'vue' }
	];

	const provider = new CSSModuleDefinitionProvider();
	
	const definitionProvider = vscode.languages.registerDefinitionProvider(
		selector,
		provider
	);

	// Register Hover Provider to show CSS classes
	const hoverProvider = vscode.languages.registerHoverProvider(
		selector,
		new CSSModuleHoverProvider()
	);

	// Register Completion Provider for class autocompletion
	const completionProvider = vscode.languages.registerCompletionItemProvider(
		selector,
		new CSSModuleCompletionProvider(),
		'.' // Trigger character - dot
	);

	// Register Rename Provider for refactoring CSS class names
	const renameProvider = vscode.languages.registerRenameProvider(
		selector,
		new CSSModuleRenameProvider()
	);

	// Register command for explicit navigation to CSS module
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

	// Add setting for filtering .d.ts files
	const config = vscode.workspace.getConfiguration('quick-css-modules');
	const filterDTS = config.get<boolean>('filterDeclarationFiles', true);

	if (filterDTS) {
		// Intercept clicks and filter results
		setupDefinitionFilter(context);
	}

	// Check if we need to override F12
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
	// Intercept editor.action.revealDefinition command
	const originalCommand = 'editor.action.revealDefinition';
	
	// Register handler for current editor
	context.subscriptions.push(
		vscode.commands.registerCommand('quick-css-modules.revealDefinition', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return vscode.commands.executeCommand(originalCommand);
			}

			const position = editor.selection.active;
			const document = editor.document;
			
			// Check if this is a CSS module
			const wordRange = document.getWordRangeAtPosition(position);
			if (!wordRange) {
				return vscode.commands.executeCommand(originalCommand);
			}

			const word = document.getText(wordRange);
			const helper = new CSSModuleDefinitionProvider();
			const cssImports = helper['findCSSModuleImports'](document);
			
			// If this is a CSS module variable or its property - use our provider
			const isCSSModule = cssImports.some(imp => imp.variableName === word) ||
				isCSSModuleProperty(document, position, word, cssImports);
			
			if (isCSSModule) {
				// Get all definitions
				const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
					'vscode.executeDefinitionProvider',
					document.uri,
					position
				);
				
				if (definitions && definitions.length > 0) {
					// Filter .d.ts files
					const filtered = definitions.filter(def => {
						if (!def) {
							return false;
						}
						// Check Location
						if ('uri' in def && def.uri) {
							return !def.uri.fsPath.endsWith('.d.ts');
						}
						// Check LocationLink
						if ('targetUri' in def && def.targetUri) {
							return !def.targetUri.fsPath.endsWith('.d.ts');
						}
						return false;
					});
					
					if (filtered.length > 0) {
						// Navigate to first filtered result
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
			
			// In other cases - call standard command
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

	// Check objectName.property
	const beforeWord = line.substring(0, wordRange.start.character);
	const dotMatch = beforeWord.match(/(\w+)\.$/);
	
	if (dotMatch) {
		return cssImports.some(imp => imp.variableName === dotMatch[1]);
	}

	// Check property after objectName
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

		// Find all CSS module imports in the document
		const cssModuleImports = this.findCSSModuleImports(document);
		
		// If no CSS module imports - don't process
		if (cssModuleImports.length === 0) {
			return undefined;
		}
		
		// Check if clicked on object property (e.g., styles.className)
		const propertyMatch = this.getPropertyAccess(document, position, word);
		if (propertyMatch) {
			const { objectName, propertyName } = propertyMatch;
			
			// Find corresponding import
			const cssImport = cssModuleImports.find(imp => imp.variableName === objectName);
			if (cssImport) {
				// Find or create class in CSS module
				return this.findOrCreateCSSClass(document, cssImport.filePath, propertyName);
			}
		}

		// Check if clicked on CSS module variable (e.g., "styles")
		// This should be after property check to handle styles.className correctly
		const cssImport = cssModuleImports.find(imp => imp.variableName === word);
		if (cssImport) {
			// Click on import variable - open module file
			return this.openCSSModuleFile(document, cssImport.filePath);
		}

		return undefined;
	}

	private findCSSModuleImports(document: vscode.TextDocument): CSSModuleImport[] {
		const imports: CSSModuleImport[] = [];
		const text = document.getText();
		
		// Regex to find imports like: import styles from './file.module.scss'
		// Supports: .css, .scss, .sass, .less, .styl, .stylus
		const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.(scss|css|sass|less|styl|stylus))['"]/g;
		
		let match;
		while ((match = importRegex.exec(text)) !== null) {
			const variableName = match[1];
			const relativePath = match[2];
			
			// Calculate absolute file path
			const documentDir = path.dirname(document.uri.fsPath);
			const absolutePath = path.resolve(documentDir, relativePath);
			
			// Find variable position in document
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
			// Clicked on propertyName in objectName.propertyName
			return {
				objectName: dotMatch[1],
				propertyName: word
			};
		}

		// Check if clicked on objectName in objectName.propertyName
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
			
			// Read CSS file content
			let cssDocument: vscode.TextDocument;
			try {
				cssDocument = await vscode.workspace.openTextDocument(uri);
			} catch (error) {
				// File doesn't exist - create it
				const workspaceEdit = new vscode.WorkspaceEdit();
				workspaceEdit.createFile(uri, { ignoreIfExists: true });
				await vscode.workspace.applyEdit(workspaceEdit);
				cssDocument = await vscode.workspace.openTextDocument(uri);
			}

			const cssContent = cssDocument.getText();
			
			// Find class in CSS file (simple substring search for .className)
			const classPattern = `.${className}`;
			const classIndex = cssContent.indexOf(classPattern);
			
			if (classIndex !== -1) {
				// Class found - navigate to it
				const position = cssDocument.positionAt(classIndex);
				return new vscode.Location(uri, position);
			} else {
				// Class not found - create it
				const newClass = `\n.${className} {\n\t\n}\n`;
				const workspaceEdit = new vscode.WorkspaceEdit();
				
				// Add class to end of file
				const lastLine = cssDocument.lineCount;
				const insertPosition = new vscode.Position(lastLine, 0);
				workspaceEdit.insert(uri, insertPosition, newClass);
				
				await vscode.workspace.applyEdit(workspaceEdit);
				
				// Save document
				await cssDocument.save();
				
				// Return position of new class
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
		
		// Find all CSS module imports
		const cssImports = this.findCSSModuleImports(document);
		if (cssImports.length === 0) {
			return undefined;
		}

		// Check if this is CSS module property (styles.className)
		const propertyMatch = this.getPropertyAccess(document, position, word);
		if (!propertyMatch) {
			return undefined;
		}

		const { objectName, propertyName } = propertyMatch;
		
		// Find corresponding import
		const cssImport = cssImports.find(imp => imp.variableName === objectName);
		if (!cssImport) {
			return undefined;
		}

		// Read CSS file and find class
		try {
			const uri = vscode.Uri.file(cssImport.filePath);
			const cssDocument = await vscode.workspace.openTextDocument(uri);
			const cssContent = cssDocument.getText();
			
			// Find class in CSS file
			const classPattern = `.${propertyName}`;
			const classIndex = cssContent.indexOf(classPattern);
			
			if (classIndex === -1) {
				return new vscode.Hover(
					new vscode.MarkdownString(`**CSS Module Class**\n\nClass \`.${propertyName}\` not found. Click to create.`)
				);
			}

			// Extract class content
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
		// Find start of class
		let start = classIndex;
		
		// Find opening brace
		const openBraceIndex = cssContent.indexOf('{', start);
		if (openBraceIndex === -1) {
			return cssContent.substring(start, Math.min(start + 100, cssContent.length));
		}

		// Find closing brace (considering nesting)
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

		// Extract entire class
		const classContent = cssContent.substring(start, closeBraceIndex + 1);
		
		return classContent;
	}

	private findCSSModuleImports(document: vscode.TextDocument): CSSModuleImport[] {
		const imports: CSSModuleImport[] = [];
		const text = document.getText();
		
		const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.(scss|css|sass|less|styl|stylus))['"]/g;
		
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
		
		// Find pattern "variableName." or "variableName.partialText"
		const match = textBeforeCursor.match(/(\w+)\.(\w*)$/);
		if (!match) {
			return undefined;
		}

		const variableName = match[1];

		// Find CSS module imports
		const cssImports = this.findCSSModuleImports(document);
		const cssImport = cssImports.find(imp => imp.variableName === variableName);
		
		if (!cssImport) {
			return undefined;
		}

		// Read CSS file and extract all classes
		try {
			const uri = vscode.Uri.file(cssImport.filePath);
			const cssDocument = await vscode.workspace.openTextDocument(uri);
			const cssContent = cssDocument.getText();
			
			const classNames = this.extractClassNames(cssContent);
			
			// Create completion items
			return classNames.map(className => {
				const item = new vscode.CompletionItem(className, vscode.CompletionItemKind.Property);
				item.detail = `CSS Module class from ${path.basename(cssImport.filePath)}`;
				
				// Add documentation with class preview
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
		
		// Regex to find classes: .className
		// Supports simple and nested classes
		const classRegex = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g;
		
		let match;
		while ((match = classRegex.exec(cssContent)) !== null) {
			const className = match[1];
			// Exclude pseudo-classes and pseudo-elements
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

		// Find opening brace
		const openBraceIndex = cssContent.indexOf('{', classIndex);
		if (openBraceIndex === -1) {
			return undefined;
		}

		// Find closing brace
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

// Rename Provider for CSS class refactoring
class CSSModuleRenameProvider implements vscode.RenameProvider {
	async provideRenameEdits(
		document: vscode.TextDocument,
		position: vscode.Position,
		newName: string,
		token: vscode.CancellationToken
	): Promise<vscode.WorkspaceEdit | undefined> {
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return undefined;
		}

		const word = document.getText(wordRange);
		
		// Find CSS module imports
		const cssImports = this.findCSSModuleImports(document);
		
		// Check if renaming a CSS module property
		const propertyMatch = this.getPropertyAccess(document, position, word);
		if (!propertyMatch) {
			return undefined;
		}

		const { objectName, propertyName } = propertyMatch;
		const cssImport = cssImports.find(imp => imp.variableName === objectName);
		
		if (!cssImport) {
			return undefined;
		}

		const workspaceEdit = new vscode.WorkspaceEdit();

		// 1. Rename in CSS file
		await this.renameInCSSFile(cssImport.filePath, propertyName, newName, workspaceEdit);

		// 2. Find all usages in workspace and rename
		await this.renameInWorkspace(cssImport.filePath, objectName, propertyName, newName, workspaceEdit);

		return workspaceEdit;
	}

	async prepareRename(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.Range | { range: vscode.Range; placeholder: string } | undefined> {
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return undefined;
		}

		const word = document.getText(wordRange);
		const cssImports = this.findCSSModuleImports(document);
		const propertyMatch = this.getPropertyAccess(document, position, word);
		
		if (!propertyMatch) {
			throw new Error('Cannot rename: Not a CSS module property');
		}

		const { objectName, propertyName } = propertyMatch;
		const cssImport = cssImports.find(imp => imp.variableName === objectName);
		
		if (!cssImport) {
			throw new Error('Cannot rename: CSS module not found');
		}

		return {
			range: wordRange,
			placeholder: propertyName
		};
	}

	private async renameInCSSFile(
		cssFilePath: string,
		oldName: string,
		newName: string,
		edit: vscode.WorkspaceEdit
	): Promise<void> {
		try {
			const uri = vscode.Uri.file(cssFilePath);
			const cssDocument = await vscode.workspace.openTextDocument(uri);
			const cssContent = cssDocument.getText();

			// Find all occurrences of .oldName in CSS
			const regex = new RegExp(`\\.${oldName}\\b`, 'g');
			let match;

			while ((match = regex.exec(cssContent)) !== null) {
				const startPos = cssDocument.positionAt(match.index + 1); // +1 to skip the dot
				const endPos = cssDocument.positionAt(match.index + 1 + oldName.length);
				const range = new vscode.Range(startPos, endPos);
				edit.replace(uri, range, newName);
			}
		} catch (error) {
			console.error('Error renaming in CSS file:', error);
		}
	}

	private async renameInWorkspace(
		cssFilePath: string,
		variableName: string,
		oldName: string,
		newName: string,
		edit: vscode.WorkspaceEdit
	): Promise<void> {
		// Find all TypeScript/JavaScript files in workspace
		const files = await vscode.workspace.findFiles(
			'**/*.{ts,tsx,js,jsx}',
			'**/node_modules/**'
		);

		for (const fileUri of files) {
			try {
				const document = await vscode.workspace.openTextDocument(fileUri);
				const imports = this.findCSSModuleImports(document);

				// Check if this file imports the same CSS module
				const relevantImport = imports.find(imp => 
					path.normalize(imp.filePath) === path.normalize(cssFilePath)
				);

				if (!relevantImport) {
					continue;
				}

				// Find all usages of variableName.oldName
				const text = document.getText();
				const usageRegex = new RegExp(`\\b${relevantImport.variableName}\\.${oldName}\\b`, 'g');
				let match;

				while ((match = usageRegex.exec(text)) !== null) {
					// Calculate position of the property name (after the dot)
					const dotIndex = match.index + relevantImport.variableName.length + 1;
					const startPos = document.positionAt(dotIndex);
					const endPos = document.positionAt(dotIndex + oldName.length);
					const range = new vscode.Range(startPos, endPos);
					edit.replace(fileUri, range, newName);
				}
			} catch (error) {
				console.error(`Error processing file ${fileUri.fsPath}:`, error);
			}
		}
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

		return undefined;
	}

	private findCSSModuleImports(document: vscode.TextDocument): CSSModuleImport[] {
		const imports: CSSModuleImport[] = [];
		const text = document.getText();
		
		const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.(scss|css|sass|less|styl|stylus))['"]/g;
		
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
