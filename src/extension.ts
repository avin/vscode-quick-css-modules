import * as vscode from 'vscode';
import * as path from 'path';

interface CSSModuleImport {
	variableName: string;
	filePath: string;
	range: vscode.Range;
}

async function configureTypeScriptPlugin() {
	const config = vscode.workspace.getConfiguration('quick-css-modules');
	const enablePlugin = config.get<boolean>('enableTypeScriptPlugin', true);

	if (!enablePlugin) {
		return;
	}

	try {
		// Get TypeScript extension
		const tsExtension = vscode.extensions.getExtension('vscode.typescript-language-features');
		if (!tsExtension) {
			console.warn('TypeScript extension not found');
			return;
		}

		// Activate TypeScript extension
		if (!tsExtension.isActive) {
			await tsExtension.activate();
		}

		// Get TypeScript API
		const tsApi = tsExtension.exports;
		if (!tsApi || !tsApi.getAPI) {
			console.warn('TypeScript API not available');
			return;
		}

		const api = tsApi.getAPI(0);
		if (!api || !api.configurePlugin) {
			console.warn('TypeScript API configurePlugin not available');
			return;
		}

		// Configure the cleanup plugin
		api.configurePlugin('typescript-cleanup-definitions', {
			name: 'typescript-cleanup-definitions',
			enable: true,
			modules: [
				'*.module.css',
				'*.module.scss',
				'*.module.sass',
				'*.module.less',
				'*.module.styl',
				'*.module.stylus'
			]
		});

		console.log('TypeScript cleanup plugin configured successfully');
	} catch (error) {
		console.error('Error configuring TypeScript plugin:', error);
	}
}

export async function activate(context: vscode.ExtensionContext) {
	console.log('CSS Modules extension is now active!');

	// Configure TypeScript plugin to filter .d.ts files
	await configureTypeScriptPlugin();

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

	// Register Reference Provider for finding usages of CSS classes from CSS files
	const cssSelector = [
		{ scheme: 'file', language: 'css' },
		{ scheme: 'file', language: 'scss' },
		{ scheme: 'file', language: 'sass' },
		{ scheme: 'file', language: 'less' },
		{ scheme: 'file', language: 'stylus' }
	];

	const referenceProvider = vscode.languages.registerReferenceProvider(
		cssSelector,
		new CSSModuleReferenceProvider()
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

	// Listen for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e.affectsConfiguration('quick-css-modules.enableTypeScriptPlugin')) {
				await configureTypeScriptPlugin();
			}
		})
	);

	context.subscriptions.push(definitionProvider, hoverProvider, completionProvider, renameProvider, referenceProvider, goToCSSModuleCommand);
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

		// Check for bracket notation: objectName['propertyName'] or objectName["propertyName"]
		// Clicked on propertyName inside quotes
		const bracketMatch = beforeWord.match(/(\w+)\[['"]$/);
		if (bracketMatch) {
			const afterQuote = line.substring(wordRange.end.character);
			// Verify it ends with '] or "]
			if (/^['"]/.test(afterQuote)) {
				return {
					objectName: bracketMatch[1],
					propertyName: word
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
				
				// Return position inside the class with indent (on the line with tab)
				const newPosition = new vscode.Position(lastLine + 2, 1); // Line with \t, after tab character
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

		// Check for bracket notation: objectName['propertyName'] or objectName["propertyName"]
		const bracketMatch = beforeWord.match(/(\w+)\[['"]$/);
		if (bracketMatch) {
			const afterQuote = line.substring(wordRange.end.character);
			if (/^['"]/.test(afterQuote)) {
				return {
					objectName: bracketMatch[1],
					propertyName: word
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

// Reference Provider for finding usages of CSS classes from CSS module files
class CSSModuleReferenceProvider implements vscode.ReferenceProvider {
	async provideReferences(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.ReferenceContext,
		token: vscode.CancellationToken
	): Promise<vscode.Location[] | undefined> {
		// Check if this is a CSS module file
		const filePath = document.uri.fsPath;
		if (!this.isCSSModuleFile(filePath)) {
			return undefined;
		}

		// Get the class name at cursor position
		const className = this.getClassNameAtPosition(document, position);
		if (!className) {
			return undefined;
		}

		// Find all usages of this class in workspace
		const references = await this.findClassUsages(document.uri, className, context.includeDeclaration);
		
		return references.length > 0 ? references : undefined;
	}

	private isCSSModuleFile(filePath: string): boolean {
		return /\.module\.(scss|css|sass|less|styl|stylus)$/i.test(filePath);
	}

	private getClassNameAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
		const line = document.lineAt(position.line).text;
		
		// Find if cursor is on a class selector (.className)
		// Use regex to find all class names in the line
		const classRegex = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g;
		let match;
		
		while ((match = classRegex.exec(line)) !== null) {
			const classStart = match.index;
			const classEnd = match.index + match[0].length;
			
			// Check if cursor position is within this class name
			if (position.character >= classStart && position.character <= classEnd) {
				return match[1]; // Return the class name without the dot
			}
		}
		
		return undefined;
	}

	private async findClassUsages(
		cssFileUri: vscode.Uri,
		className: string,
		includeDeclaration: boolean
	): Promise<vscode.Location[]> {
		const references: vscode.Location[] = [];
		const cssFilePath = cssFileUri.fsPath;
		const cssFileName = path.basename(cssFilePath);

		// Escape special regex characters in className (for classes like kebab-case)
		const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

		// Step 1: Find candidate files using VS Code's optimized file search
		// First, look in already opened documents (instant, no I/O)
		const openDocuments = vscode.workspace.textDocuments.filter(doc => 
			/\.(ts|tsx|js|jsx|vue)$/.test(doc.uri.fsPath) &&
			!doc.uri.fsPath.includes('node_modules') &&
			doc.getText().includes(cssFileName)
		);

		// Then find files via workspace API
		let files = await vscode.workspace.findFiles(
			'**/*.{ts,tsx,js,jsx,vue}',
			'**/node_modules/**'
		);

		// If no files found via workspace, try local directory (for tests)
		if (files.length === 0) {
			const fs = await import('fs');
			const cssDir = path.dirname(cssFilePath);
			try {
				const dirFiles = fs.readdirSync(cssDir);
				const tsFiles = dirFiles.filter(f => /\.(ts|tsx|js|jsx|vue)$/.test(f));
				files = tsFiles.map(f => vscode.Uri.file(path.join(cssDir, f)));
			} catch (error) {
				console.error('Error reading directory:', error);
			}
		}

		// Merge: prioritize already-open documents, then add remaining files
		const processedPaths = new Set<string>();
		const filesToProcess: vscode.Uri[] = [];

		// Add open documents first (they're already in memory - fast!)
		for (const doc of openDocuments) {
			processedPaths.add(doc.uri.fsPath.toLowerCase());
			filesToProcess.push(doc.uri);
		}

		// Add remaining files (will need to be read from disk)
		for (const uri of files) {
			if (!processedPaths.has(uri.fsPath.toLowerCase())) {
				filesToProcess.push(uri);
			}
		}

		// Step 2: Process files - use parallel processing for better performance
		const processFile = async (fileUri: vscode.Uri): Promise<vscode.Location[]> => {
			const fileRefs: vscode.Location[] = [];
			try {
				const document = await vscode.workspace.openTextDocument(fileUri);
				const text = document.getText();
				
				// Quick check: skip file if it doesn't contain the CSS module filename
				if (!text.includes(cssFileName)) {
					return fileRefs;
				}

				const imports = this.findCSSModuleImports(document);

				// Check if this file imports the CSS module we're searching from
				const relevantImport = imports.find(imp => {
					const normalizedImp = path.normalize(imp.filePath).toLowerCase();
					const normalizedCss = path.normalize(cssFilePath).toLowerCase();
					return normalizedImp === normalizedCss;
				});

				if (!relevantImport) {
					return fileRefs;
				}

				// Find all usages of variableName.className
				const usageRegex = new RegExp(`\\b${relevantImport.variableName}\\.${escapedClassName}\\b`, 'g');
				let match;

				while ((match = usageRegex.exec(text)) !== null) {
					const dotIndex = match.index + relevantImport.variableName.length + 1;
					const startPos = document.positionAt(dotIndex);
					const endPos = document.positionAt(dotIndex + className.length);
					const range = new vscode.Range(startPos, endPos);
					fileRefs.push(new vscode.Location(fileUri, range));
				}

				// Also check for bracket notation: variableName['className'] or variableName["className"]
				const bracketRegex = new RegExp(`\\b${relevantImport.variableName}\\[['"]${escapedClassName}['"]\\]`, 'g');
				while ((match = bracketRegex.exec(text)) !== null) {
					const nameStart = match.index + relevantImport.variableName.length + 2;
					const startPos = document.positionAt(nameStart);
					const endPos = document.positionAt(nameStart + className.length);
					const range = new vscode.Range(startPos, endPos);
					fileRefs.push(new vscode.Location(fileUri, range));
				}
			} catch (error) {
				console.error(`Error processing file ${fileUri.fsPath}:`, error);
			}
			return fileRefs;
		};

		// Process files in parallel batches for better performance
		const BATCH_SIZE = 10;
		for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
			const batch = filesToProcess.slice(i, i + BATCH_SIZE);
			const batchResults = await Promise.all(batch.map(processFile));
			for (const fileRefs of batchResults) {
				references.push(...fileRefs);
			}
		}

		// Include declaration (the class definition in CSS file) if requested
		if (includeDeclaration) {
			const declarationLocation = await this.findClassDeclaration(cssFileUri, className);
			if (declarationLocation) {
				references.push(declarationLocation);
			}
		}

		return references;
	}

	private async findClassDeclaration(
		cssFileUri: vscode.Uri,
		className: string
	): Promise<vscode.Location | undefined> {
		try {
			const document = await vscode.workspace.openTextDocument(cssFileUri);
			const text = document.getText();
			
			// Find the class definition .className
			const classPattern = `.${className}`;
			const classIndex = text.indexOf(classPattern);
			
			if (classIndex !== -1) {
				const startPos = document.positionAt(classIndex);
				const endPos = document.positionAt(classIndex + classPattern.length);
				return new vscode.Location(cssFileUri, new vscode.Range(startPos, endPos));
			}
		} catch (error) {
			console.error('Error finding class declaration:', error);
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
