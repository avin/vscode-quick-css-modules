import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface CSSModuleImport {
	variableName: string;
	filePath: string;
	range: vscode.Range;
}

// Diagnostic code for missing CSS class
const MISSING_CSS_CLASS_CODE = 'cssModules.missingClass';

// Diagnostics collection for CSS module class validation
let diagnosticCollection: vscode.DiagnosticCollection;

// Resolve aliased path from tsconfig/jsconfig (synchronous version)
function resolveAliasedPathSync(importPath: string, document: vscode.TextDocument): string {
	// If it's a relative path, resolve normally
	if (importPath.startsWith('.') || importPath.startsWith('/')) {
		const documentDir = path.dirname(document.uri.fsPath);
		return path.resolve(documentDir, importPath);
	}

	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
	if (!workspaceFolder) {
		return importPath;
	}

	const configFiles = ['tsconfig.json', 'jsconfig.json'];
	
	for (const configFile of configFiles) {
		const configPath = path.join(workspaceFolder.uri.fsPath, configFile);
		
		try {
			if (fs.existsSync(configPath)) {
				const content = fs.readFileSync(configPath, 'utf8');
				// Remove comments
				const jsonContent = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
				const config = JSON.parse(jsonContent);
				
				const baseUrl = config.compilerOptions?.baseUrl;
				const paths = config.compilerOptions?.paths;
				
				if (paths) {
					for (const [alias, targets] of Object.entries(paths)) {
						const aliasPattern = alias.replace(/\*/g, '(.*)');
						const regex = new RegExp(`^${aliasPattern.replace(/\//g, '\\/')}$`);
						const match = importPath.match(regex);
						
						if (match) {
							for (const target of targets as string[]) {
								let resolvedTarget = target;
								if (match[1]) {
									resolvedTarget = target.replace('*', match[1]);
								}
								
								const basePath = baseUrl 
									? path.join(workspaceFolder.uri.fsPath, baseUrl)
									: workspaceFolder.uri.fsPath;
								
								const fullPath = path.join(basePath, resolvedTarget);
								
								if (fs.existsSync(fullPath)) {
									return fullPath;
								}
							}
						}
					}
				}
				
				// Try baseUrl only
				if (baseUrl) {
					const basePath = path.join(workspaceFolder.uri.fsPath, baseUrl);
					const resolved = path.join(basePath, importPath);
					if (fs.existsSync(resolved)) {
						return resolved;
					}
				}
			}
		} catch (error) {
			console.error(`Error parsing ${configFile}:`, error);
		}
	}
	
	return importPath;
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

	// Register Auto-import Completion Provider
	const autoImportProvider = vscode.languages.registerCompletionItemProvider(
		selector,
		new CSSModuleAutoImportProvider(),
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

	// Register Definition Provider for CSS files (composes support)
	const cssDefinitionProvider = vscode.languages.registerDefinitionProvider(
		cssSelector,
		new CSSComposesDefinitionProvider()
	);

	// Register Document Symbol Provider for CSS module files (Outline)
	const documentSymbolProvider = vscode.languages.registerDocumentSymbolProvider(
		cssSelector,
		new CSSModuleSymbolProvider()
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

	// Register command for creating CSS class (used by Quick Fix)
	const createCSSClassCommand = vscode.commands.registerCommand(
		'quick-css-modules.createCSSClass',
		async (cssFilePath: string, className: string) => {
			try {
				const uri = vscode.Uri.file(cssFilePath);
				const document = await vscode.workspace.openTextDocument(uri);
				const text = document.getText();
				
				// Add new class at the end of the file
				const lastLine = document.lineCount - 1;
				const lastLineText = document.lineAt(lastLine).text;
				const insertPosition = new vscode.Position(lastLine, lastLineText.length);
				
				const newClassContent = `\n\n.${className} {\n\t\n}`;
				
				const edit = new vscode.WorkspaceEdit();
				edit.insert(uri, insertPosition, newClassContent);
				await vscode.workspace.applyEdit(edit);
				
				// Save the document
				await document.save();
				
				// Open the file and position cursor inside the class
				const editor = await vscode.window.showTextDocument(uri);
				const newPosition = new vscode.Position(lastLine + 3, 1);
				editor.selection = new vscode.Selection(newPosition, newPosition);
				
				vscode.window.showInformationMessage(`Created CSS class '.${className}'`);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to create CSS class: ${error}`);
			}
		}
	);

	// Setup Diagnostics Provider
	diagnosticCollection = vscode.languages.createDiagnosticCollection('cssModules');
	const diagnosticsProvider = new CSSModuleDiagnosticsProvider(diagnosticCollection);
	
	// Update diagnostics when document changes
	const onDidChangeDocument = vscode.workspace.onDidChangeTextDocument((e) => {
		diagnosticsProvider.updateDiagnostics(e.document);
	});
	
	// Update diagnostics when document opens
	const onDidOpenDocument = vscode.workspace.onDidOpenTextDocument((document) => {
		diagnosticsProvider.updateDiagnostics(document);
	});
	
	// Update diagnostics when document saves
	const onDidSaveDocument = vscode.workspace.onDidSaveTextDocument((document) => {
		diagnosticsProvider.updateDiagnostics(document);
	});
	
	// Clear diagnostics when document closes
	const onDidCloseDocument = vscode.workspace.onDidCloseTextDocument((document) => {
		diagnosticsProvider.clearDiagnostics(document);
	});
	
	// Update diagnostics for all open documents
	vscode.workspace.textDocuments.forEach((document) => {
		diagnosticsProvider.updateDiagnostics(document);
	});

	// Register Code Action Provider for Quick Fix
	const codeActionProvider = vscode.languages.registerCodeActionsProvider(
		selector,
		new CSSModuleCodeActionProvider(),
		{
			providedCodeActionKinds: CSSModuleCodeActionProvider.providedCodeActionKinds
		}
	);

	// Watch for CSS file changes to update diagnostics
	const cssWatcher = vscode.workspace.createFileSystemWatcher('**/*.module.{css,scss,sass,less,styl,stylus}');
	cssWatcher.onDidChange(() => {
		vscode.workspace.textDocuments.forEach((document) => {
			diagnosticsProvider.updateDiagnostics(document);
		});
	});

	// Listen for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e.affectsConfiguration('quick-css-modules.enableTypeScriptPlugin')) {
				await configureTypeScriptPlugin();
			}
			if (e.affectsConfiguration('quick-css-modules.enableDiagnostics')) {
				vscode.workspace.textDocuments.forEach((document) => {
					diagnosticsProvider.updateDiagnostics(document);
				});
			}
		})
	);

	context.subscriptions.push(
		definitionProvider, hoverProvider, completionProvider, autoImportProvider, 
		renameProvider, referenceProvider, cssDefinitionProvider, documentSymbolProvider, 
		goToCSSModuleCommand, createCSSClassCommand, codeActionProvider, diagnosticCollection,
		onDidChangeDocument, onDidOpenDocument, onDidSaveDocument, onDidCloseDocument, cssWatcher
	);
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
			const importPath = match[2];
			
			// Resolve path (supports aliases from tsconfig/jsconfig)
			const absolutePath = resolveAliasedPathSync(importPath, document);
			
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

				const imports = this.findCSSModuleImportsForRef(document);

				// Check if this file imports the CSS module we're searching from
				const relevantImport = imports.find((imp: CSSModuleImport) => {
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

	private findCSSModuleImportsForRef(document: vscode.TextDocument): CSSModuleImport[] {
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

// Definition Provider for CSS composes directive
class CSSComposesDefinitionProvider implements vscode.DefinitionProvider {
	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.Definition | undefined> {
		const line = document.lineAt(position.line).text;
		
		// Check if this line contains composes
		// Format: composes: className from './file.module.css';
		// or: composes: className1 className2 from './file.module.css';
		// or: composes: className from global;
		const composesMatch = line.match(/composes:\s*([^;]+)/);
		if (!composesMatch) {
			return undefined;
		}

		const composesContent = composesMatch[1];
		const composesStart = line.indexOf('composes:') + 'composes:'.length;
		
		// Check if clicking on "from './path'" part
		const fromMatch = composesContent.match(/from\s+['"]([^'"]+)['"]/);
		if (fromMatch) {
			const fromPath = fromMatch[1];
			const fromIndex = line.indexOf(fromPath);
			const fromEndIndex = fromIndex + fromPath.length;
			
			// Check if cursor is on the path
			if (position.character >= fromIndex && position.character <= fromEndIndex) {
				// Navigate to the file
				const documentDir = path.dirname(document.uri.fsPath);
				const absolutePath = path.resolve(documentDir, fromPath);
				
				try {
					const uri = vscode.Uri.file(absolutePath);
					return new vscode.Location(uri, new vscode.Position(0, 0));
				} catch {
					return undefined;
				}
			}
		}
		
		// Check if clicking on a class name
		// Extract class names (before "from" if present)
		const classNamesPart = composesContent.includes(' from ')
			? composesContent.substring(0, composesContent.indexOf(' from ')).trim()
			: composesContent.trim().replace(/;$/, '');
		
		const classNames = classNamesPart.split(/\s+/).filter(c => c.length > 0);
		
		// Find which class name cursor is on
		let currentPos = composesStart;
		for (const className of classNames) {
			const classIndex = line.indexOf(className, currentPos);
			if (classIndex === -1) {
				continue;
			}
			
			const classEndIndex = classIndex + className.length;
			currentPos = classEndIndex;
			
			if (position.character >= classIndex && position.character <= classEndIndex) {
				// Cursor is on this class name
				// Determine where to navigate
				if (fromMatch) {
					// Navigate to external file
					const fromPath = fromMatch[1];
					const documentDir = path.dirname(document.uri.fsPath);
					const absolutePath = path.resolve(documentDir, fromPath);
					
					return this.findClassInFile(absolutePath, className);
				} else {
					// Local class - find in same file
					return this.findClassInFile(document.uri.fsPath, className);
				}
			}
		}
		
		return undefined;
	}

	private async findClassInFile(filePath: string, className: string): Promise<vscode.Location | undefined> {
		try {
			const uri = vscode.Uri.file(filePath);
			const document = await vscode.workspace.openTextDocument(uri);
			const text = document.getText();
			
			// Find class definition
			const classPattern = `.${className}`;
			const classIndex = text.indexOf(classPattern);
			
			if (classIndex !== -1) {
				const position = document.positionAt(classIndex);
				return new vscode.Location(uri, position);
			}
		} catch (error) {
			console.error('Error finding class in file:', error);
		}
		
		return undefined;
	}
}

// Document Symbol Provider for CSS module files (shows classes in Outline)
class CSSModuleSymbolProvider implements vscode.DocumentSymbolProvider {
	provideDocumentSymbols(
		document: vscode.TextDocument,
		token: vscode.CancellationToken
	): vscode.DocumentSymbol[] | undefined {
		// Only process CSS module files
		if (!this.isCSSModuleFile(document.uri.fsPath)) {
			return undefined;
		}

		const symbols: vscode.DocumentSymbol[] = [];
		const text = document.getText();
		
		// Find all class selectors
		const classRegex = /\.([a-zA-Z_][a-zA-Z0-9_-]*)\s*\{/g;
		let match;
		
		while ((match = classRegex.exec(text)) !== null) {
			const className = match[1];
			const startPos = document.positionAt(match.index);
			
			// Find the end of the class (closing brace)
			const openBraceIndex = match.index + match[0].length - 1;
			let depth = 1;
			let closeBraceIndex = openBraceIndex + 1;
			
			for (let i = openBraceIndex + 1; i < text.length && depth > 0; i++) {
				if (text[i] === '{') {
					depth++;
				} else if (text[i] === '}') {
					depth--;
					if (depth === 0) {
						closeBraceIndex = i;
					}
				}
			}
			
			const endPos = document.positionAt(closeBraceIndex + 1);
			const range = new vscode.Range(startPos, endPos);
			const selectionRange = new vscode.Range(
				startPos,
				document.positionAt(match.index + match[0].length - 1)
			);
			
			// Extract CSS properties for detail
			const classContent = text.substring(openBraceIndex + 1, closeBraceIndex);
			const properties = this.extractProperties(classContent);
			const detail = properties.length > 0 ? properties.slice(0, 3).join(', ') + (properties.length > 3 ? '...' : '') : '';
			
			const symbol = new vscode.DocumentSymbol(
				`.${className}`,
				detail,
				vscode.SymbolKind.Class,
				range,
				selectionRange
			);
			
			symbols.push(symbol);
		}
		
		return symbols;
	}

	private isCSSModuleFile(filePath: string): boolean {
		return /\.module\.(scss|css|sass|less|styl|stylus)$/i.test(filePath);
	}

	private extractProperties(classContent: string): string[] {
		const properties: string[] = [];
		// Match CSS properties like "color: red" or "margin: 10px"
		const propRegex = /([a-z-]+)\s*:/gi;
		let match;
		
		while ((match = propRegex.exec(classContent)) !== null) {
			properties.push(match[1]);
		}
		
		return properties;
	}
}

// Auto-import Completion Provider for CSS modules
class CSSModuleAutoImportProvider implements vscode.CompletionItemProvider {
	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		context: vscode.CompletionContext
	): Promise<vscode.CompletionItem[] | undefined> {
		// Check if auto-import is enabled
		const config = vscode.workspace.getConfiguration('quick-css-modules');
		if (!config.get<boolean>('enableAutoImport', true)) {
			return undefined;
		}

		const line = document.lineAt(position.line).text;
		const textBeforeCursor = line.substring(0, position.character);
		
		// Check if user is typing a variable name followed by dot that might be CSS module
		// e.g., "styles." but styles is not imported yet
		const match = textBeforeCursor.match(/(\w+)\.$/);
		if (!match) {
			return undefined;
		}

		const variableName = match[1];
		
		// Check if this variable is already imported
		const existingImports = this.findCSSModuleImports(document);
		if (existingImports.some(imp => imp.variableName === variableName)) {
			// Already imported, let the regular completion provider handle it
			return undefined;
		}

		// Get configured variable names for auto-import
		const autoImportNames = config.get<string[]>('autoImportVariableNames', ['styles', 'classes']);
		if (!autoImportNames.some((name: string) => name.toLowerCase() === variableName.toLowerCase())) {
			return undefined;
		}

		// Find potential CSS module files in the same directory or nearby
		const documentDir = path.dirname(document.uri.fsPath);
		const documentName = path.basename(document.uri.fsPath);
		const baseName = documentName.replace(/\.(tsx?|jsx?|vue)$/, '');
		
		const cssModuleFiles = await this.findCSSModuleFilesNearby(documentDir, baseName);
		
		if (cssModuleFiles.length === 0) {
			return undefined;
		}

		// Create completion items with auto-import
		const items: vscode.CompletionItem[] = [];
		
		for (const cssFile of cssModuleFiles) {
			const relativePath = this.getRelativePath(document.uri.fsPath, cssFile.fsPath);
			
			// Read the CSS file to get class names
			try {
				const cssDocument = await vscode.workspace.openTextDocument(cssFile);
				const cssContent = cssDocument.getText();
				const classNames = this.extractClassNames(cssContent);
				
				for (const className of classNames) {
					const item = new vscode.CompletionItem(
						className,
						vscode.CompletionItemKind.Property
					);
					
					item.detail = `Auto-import from ${path.basename(cssFile.fsPath)}`;
					item.sortText = '0' + className; // Prioritize these completions
					
					// Add documentation with class preview
					const classContent = this.getClassPreview(cssContent, className);
					if (classContent) {
						item.documentation = new vscode.MarkdownString();
						item.documentation.appendCodeblock(classContent, 'scss');
						item.documentation.appendText(`\n\n📦 Will add import: \`import ${variableName} from '${relativePath}'\``);
					}
					
					// Create additional text edit to add import statement
					const importStatement = `import ${variableName} from '${relativePath}';\n`;
					const importPosition = this.findImportInsertPosition(document);
					
					item.additionalTextEdits = [
						vscode.TextEdit.insert(importPosition, importStatement)
					];
					
					items.push(item);
				}
			} catch (error) {
				console.error('Error reading CSS file for auto-import:', error);
			}
		}
		
		return items;
	}

	private findCSSModuleImports(document: vscode.TextDocument): CSSModuleImport[] {
		const imports: CSSModuleImport[] = [];
		const text = document.getText();
		
		const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.(scss|css|sass|less|styl|stylus))['"]/g;
		
		let match;
		while ((match = importRegex.exec(text)) !== null) {
			imports.push({
				variableName: match[1],
				filePath: match[2],
				range: new vscode.Range(0, 0, 0, 0)
			});
		}
		
		return imports;
	}

	private async findCSSModuleFilesNearby(directory: string, baseName: string): Promise<vscode.Uri[]> {
		const results: vscode.Uri[] = [];
		
		// Look for CSS modules with the same base name
		const extensions = ['scss', 'css', 'sass', 'less', 'styl', 'stylus'];
		
		for (const ext of extensions) {
			// Try ComponentName.module.scss
			const exactMatch = path.join(directory, `${baseName}.module.${ext}`);
			try {
				const uri = vscode.Uri.file(exactMatch);
				await vscode.workspace.fs.stat(uri);
				results.push(uri);
			} catch {
				// File doesn't exist
			}
		}
		
		// If no exact match, search for any CSS module in the directory
		if (results.length === 0) {
			try {
				const pattern = new vscode.RelativePattern(directory, '*.module.{scss,css,sass,less,styl,stylus}');
				const files = await vscode.workspace.findFiles(pattern, null, 5);
				results.push(...files);
			} catch (error) {
				console.error('Error finding CSS module files:', error);
			}
		}
		
		return results;
	}

	private getRelativePath(fromPath: string, toPath: string): string {
		const fromDir = path.dirname(fromPath);
		let relativePath = path.relative(fromDir, toPath);
		
		// Ensure forward slashes
		relativePath = relativePath.replace(/\\/g, '/');
		
		// Add ./ prefix if needed
		if (!relativePath.startsWith('.') && !relativePath.startsWith('/')) {
			relativePath = './' + relativePath;
		}
		
		return relativePath;
	}

	private findImportInsertPosition(document: vscode.TextDocument): vscode.Position {
		const text = document.getText();
		
		// Find the last import statement
		const importRegex = /^import\s+.*$/gm;
		let lastImportEnd = 0;
		let match;
		
		while ((match = importRegex.exec(text)) !== null) {
			lastImportEnd = match.index + match[0].length;
		}
		
		if (lastImportEnd > 0) {
			// Insert after the last import
			const position = document.positionAt(lastImportEnd);
			return new vscode.Position(position.line + 1, 0);
		}
		
		// No imports found, insert at the beginning
		return new vscode.Position(0, 0);
	}

	private extractClassNames(cssContent: string): string[] {
		const classNames = new Set<string>();
		const classRegex = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g;
		
		let match;
		while ((match = classRegex.exec(cssContent)) !== null) {
			const className = match[1];
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

		const openBraceIndex = cssContent.indexOf('{', classIndex);
		if (openBraceIndex === -1) {
			return undefined;
		}

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
}

// Diagnostics Provider for validating CSS module class usage
class CSSModuleDiagnosticsProvider {
	private collection: vscode.DiagnosticCollection;

	constructor(collection: vscode.DiagnosticCollection) {
		this.collection = collection;
	}

	async updateDiagnostics(document: vscode.TextDocument): Promise<void> {
		// Check if diagnostics are enabled
		const config = vscode.workspace.getConfiguration('quick-css-modules');
		if (!config.get<boolean>('enableDiagnostics', true)) {
			this.collection.delete(document.uri);
			return;
		}

		// Only process supported file types
		const supportedLanguages = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'vue'];
		if (!supportedLanguages.includes(document.languageId)) {
			return;
		}

		const diagnostics: vscode.Diagnostic[] = [];
		const text = document.getText();

		// Find CSS module imports
		const imports = this.findCSSModuleImports(document);
		
		if (imports.length === 0) {
			this.collection.delete(document.uri);
			return;
		}

		// Cache for CSS class names per file
		const cssClassesCache = new Map<string, Set<string>>();

		// Find all usages of CSS module classes
		for (const cssImport of imports) {
			// Check if CSS file exists
			if (!fs.existsSync(cssImport.filePath)) {
				continue;
			}

			// Get CSS classes from file (cached)
			let cssClasses = cssClassesCache.get(cssImport.filePath);
			if (!cssClasses) {
				cssClasses = this.extractCSSClasses(cssImport.filePath);
				cssClassesCache.set(cssImport.filePath, cssClasses);
			}

			// Find usages: styles.className or styles['className']
			const varName = cssImport.variableName;
			
			// Dot notation: styles.className
			const dotRegex = new RegExp(`\\b${varName}\\.(\\w+)`, 'g');
			let match;
			
			while ((match = dotRegex.exec(text)) !== null) {
				const className = match[1];
				
				if (!cssClasses.has(className)) {
					const classNameStart = match.index + varName.length + 1;
					const startPos = document.positionAt(classNameStart);
					const endPos = document.positionAt(classNameStart + className.length);
					const range = new vscode.Range(startPos, endPos);
					
					const diagnostic = new vscode.Diagnostic(
						range,
						`CSS class '${className}' does not exist in '${path.basename(cssImport.filePath)}'`,
						vscode.DiagnosticSeverity.Warning
					);
					diagnostic.code = MISSING_CSS_CLASS_CODE;
					diagnostic.source = 'CSS Modules';
					// Store data for quick fix
					(diagnostic as any).cssFilePath = cssImport.filePath;
					(diagnostic as any).className = className;
					
					diagnostics.push(diagnostic);
				}
			}

			// Bracket notation: styles['className'] or styles["className"]
			const bracketRegex = new RegExp(`\\b${varName}\\[['"]([\\w-]+)['"]\\]`, 'g');
			
			while ((match = bracketRegex.exec(text)) !== null) {
				const className = match[1];
				
				if (!cssClasses.has(className)) {
					const fullMatch = match[0];
					const classNameStart = match.index + fullMatch.indexOf(className);
					const startPos = document.positionAt(classNameStart);
					const endPos = document.positionAt(classNameStart + className.length);
					const range = new vscode.Range(startPos, endPos);
					
					const diagnostic = new vscode.Diagnostic(
						range,
						`CSS class '${className}' does not exist in '${path.basename(cssImport.filePath)}'`,
						vscode.DiagnosticSeverity.Warning
					);
					diagnostic.code = MISSING_CSS_CLASS_CODE;
					diagnostic.source = 'CSS Modules';
					(diagnostic as any).cssFilePath = cssImport.filePath;
					(diagnostic as any).className = className;
					
					diagnostics.push(diagnostic);
				}
			}
		}

		this.collection.set(document.uri, diagnostics);
	}

	clearDiagnostics(document: vscode.TextDocument): void {
		this.collection.delete(document.uri);
	}

	private findCSSModuleImports(document: vscode.TextDocument): CSSModuleImport[] {
		const imports: CSSModuleImport[] = [];
		const text = document.getText();
		
		const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.(scss|css|sass|less|styl|stylus))['"]/g;
		
		let match;
		while ((match = importRegex.exec(text)) !== null) {
			const variableName = match[1];
			const importPath = match[2];
			
			const absolutePath = resolveAliasedPathSync(importPath, document);
			
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

	private extractCSSClasses(filePath: string): Set<string> {
		const classes = new Set<string>();
		
		try {
			const content = fs.readFileSync(filePath, 'utf8');
			const classRegex = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g;
			
			let match;
			while ((match = classRegex.exec(content)) !== null) {
				classes.add(match[1]);
			}
		} catch (error) {
			console.error('Error reading CSS file:', error);
		}
		
		return classes;
	}
}

// Code Action Provider for Quick Fix - create missing CSS class
class CSSModuleCodeActionProvider implements vscode.CodeActionProvider {
	static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): vscode.CodeAction[] | undefined {
		const actions: vscode.CodeAction[] = [];

		for (const diagnostic of context.diagnostics) {
			if (diagnostic.code === MISSING_CSS_CLASS_CODE) {
				const cssFilePath = (diagnostic as any).cssFilePath;
				const className = (diagnostic as any).className;
				
				if (cssFilePath && className) {
					const action = this.createQuickFix(diagnostic, cssFilePath, className);
					if (action) {
						actions.push(action);
					}
				}
			}
		}

		return actions;
	}

	private createQuickFix(
		diagnostic: vscode.Diagnostic,
		cssFilePath: string,
		className: string
	): vscode.CodeAction | undefined {
		const action = new vscode.CodeAction(
			`Create CSS class '.${className}'`,
			vscode.CodeActionKind.QuickFix
		);
		
		action.diagnostics = [diagnostic];
		action.isPreferred = true;
		
		// Create command to add the class
		action.command = {
			title: 'Create CSS class',
			command: 'quick-css-modules.createCSSClass',
			arguments: [cssFilePath, className]
		};
		
		return action;
	}
}

