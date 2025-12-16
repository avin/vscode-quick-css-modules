import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

suite('CSS Modules Extension Test Suite', () => {
	vscode.window.showInformationMessage('Starting CSS Modules tests.');

	const testFilesDir = path.join(__dirname, '..', '..', 'test-files');
	
	setup(async () => {
		// Активируем расширение
		const ext = vscode.extensions.getExtension('undefined_publisher.quick-css-modules');
		if (ext && !ext.isActive) {
			await ext.activate();
		}
		
		// Создаем тестовые файлы если их нет
		if (!fs.existsSync(testFilesDir)) {
			fs.mkdirSync(testFilesDir, { recursive: true });
		}
		
		// Создаем тестовый CSS модуль
		const cssPath = path.join(testFilesDir, 'Test.module.scss');
		const cssContent = `.existing {\n\tcolor: red;\n}\n`;
		if (!fs.existsSync(cssPath)) {
			fs.writeFileSync(cssPath, cssContent, 'utf8');
		}
		
		// Создаем тестовый TypeScript файл
		const tsPath = path.join(testFilesDir, 'Test.tsx');
		const tsContent = `import React from 'react';\nimport styles from './Test.module.scss';\n\nexport const Test = () => {\n\treturn <div className={styles.existing}>Test</div>;\n};\n`;
		if (!fs.existsSync(tsPath)) {
			fs.writeFileSync(tsPath, tsContent, 'utf8');
		}
	});

	test('Should find CSS module imports', async () => {
		const tsPath = path.join(testFilesDir, 'Test.tsx');
		const doc = await vscode.workspace.openTextDocument(tsPath);
		
		// Проверяем что документ открылся
		assert.ok(doc);
		
		const text = doc.getText();
		assert.ok(text.includes("import styles from './Test.module.scss'"), 'Import statement should exist');
	});

	test('Should provide definition for CSS module variable in usage', async () => {
		const tsPath = path.join(testFilesDir, 'TestUsage.tsx');
		
		// Создаем CSS модуль
		const cssPath = path.join(testFilesDir, 'TestUsage.module.scss');
		fs.writeFileSync(cssPath, '.test { color: blue; }\n', 'utf8');
		
		// Создаем TS файл где styles используется БЕЗ точки (отдельно)
		const tsContent = `import React from 'react';\nimport styles from './TestUsage.module.scss';\n\nconst x = styles;\nexport const Test = () => <div>{x}</div>;\n`;
		fs.writeFileSync(tsPath, tsContent, 'utf8');
		
		const doc = await vscode.workspace.openTextDocument(tsPath);
		await vscode.window.showTextDocument(doc);
		
		await new Promise(resolve => setTimeout(resolve, 500));
		
		// Ищем позицию слова "styles" в строке "const x = styles"
		const text = doc.getText();
		const usageIndex = text.indexOf('const x = styles') + 'const x = '.length;
		const position = doc.positionAt(usageIndex);
		
		// Вызываем команду Go to Definition
		const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeDefinitionProvider',
			doc.uri,
			position
		);
		
		assert.ok(definitions, 'Should return definitions');
		assert.ok(definitions.length > 0, 'Should have at least one definition');
		
		// Проверяем что хотя бы одна дефиниция указывает на наш CSS модуль
		const cssDefinition = definitions.find(def => 
			def && def.uri && def.uri.fsPath.endsWith('TestUsage.module.scss')
		);
		
		const paths = definitions.filter(d => d && d.uri).map(d => d.uri.fsPath);
		assert.ok(cssDefinition, `Should have definition pointing to CSS module file. Got: ${paths.join(', ')}`);
		
		// Cleanup
		if (fs.existsSync(cssPath)) {
			fs.unlinkSync(cssPath);
		}
		if (fs.existsSync(tsPath)) {
			fs.unlinkSync(tsPath);
		}
	});

	test('Should provide definition for CSS class property', async () => {
		const tsPath = path.join(testFilesDir, 'Test.tsx');
		const doc = await vscode.workspace.openTextDocument(tsPath);
		await vscode.window.showTextDocument(doc);
		
		await new Promise(resolve => setTimeout(resolve, 500));
		
		const text = doc.getText();
		const classNameIndex = text.indexOf('styles.existing') + 'styles.'.length;
		const position = doc.positionAt(classNameIndex);
		
		const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeDefinitionProvider',
			doc.uri,
			position
		);
		
		assert.ok(definitions, 'Should return definitions');
		assert.ok(definitions.length > 0, 'Should have at least one definition');
		
		const cssDefinition = definitions.find(def => 
			def.uri.fsPath.endsWith('Test.module.scss')
		);
		
		assert.ok(cssDefinition, 'Should point to CSS module');
		
		// Проверяем что позиция указывает на класс
		if (cssDefinition) {
			const cssDoc = await vscode.workspace.openTextDocument(cssDefinition.uri);
			const cssText = cssDoc.getText();
			const lineText = cssDoc.lineAt(cssDefinition.range.start.line).text;
			
			assert.ok(
				lineText.includes('.existing') || cssText.includes('.existing'),
				'Should point to .existing class in CSS'
			);
		}
	});

	test('Should create new CSS class if not exists', async () => {
		const cssPath = path.join(testFilesDir, 'TestCreate.module.scss');
		const tsPath = path.join(testFilesDir, 'TestCreate.tsx');
		
		// Создаем пустой CSS модуль
		fs.writeFileSync(cssPath, '', 'utf8');
		
		// Создаем TS файл с несуществующим классом
		const tsContent = `import React from 'react';\nimport styles from './TestCreate.module.scss';\n\nexport const Test = () => {\n\treturn <div className={styles.newClass}>Test</div>;\n};\n`;
		fs.writeFileSync(tsPath, tsContent, 'utf8');
		
		const doc = await vscode.workspace.openTextDocument(tsPath);
		await vscode.window.showTextDocument(doc);
		
		await new Promise(resolve => setTimeout(resolve, 500));
		
		const text = doc.getText();
		const classNameIndex = text.indexOf('styles.newClass') + 'styles.'.length;
		const position = doc.positionAt(classNameIndex);
		
		const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeDefinitionProvider',
			doc.uri,
			position
		);
		
		assert.ok(definitions, 'Should return definitions');
		
		// Проверяем что класс был создан в CSS файле
		await new Promise(resolve => setTimeout(resolve, 500));
		
		const cssContent = fs.readFileSync(cssPath, 'utf8');
		assert.ok(cssContent.includes('.newClass'), 'Should create .newClass in CSS file');
		
		// Cleanup
		if (fs.existsSync(cssPath)) {
			fs.unlinkSync(cssPath);
		}
		if (fs.existsSync(tsPath)) {
			fs.unlinkSync(tsPath);
		}
	});

	test('Should show hover with CSS class content', async () => {
		const tsPath = path.join(testFilesDir, 'Test.tsx');
		const doc = await vscode.workspace.openTextDocument(tsPath);
		await vscode.window.showTextDocument(doc);
		
		await new Promise(resolve => setTimeout(resolve, 500));
		
		const text = doc.getText();
		const classNameIndex = text.indexOf('styles.existing') + 'styles.'.length;
		const position = doc.positionAt(classNameIndex);
		
		// Вызываем Hover Provider
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider',
			doc.uri,
			position
		);
		
		assert.ok(hovers, 'Should return hovers');
		assert.ok(hovers.length > 0, 'Should have at least one hover');
		
		// Проверяем что хотя бы один hover содержит CSS код
		const cssHover = hovers.find(hover => {
			const contents = hover.contents;
			return contents.some(content => {
				const text = typeof content === 'string' ? content : content.value;
				return text.includes('.existing') && text.includes('color: red');
			});
		});
		
		assert.ok(cssHover, 'Should have hover with CSS class content');
	});
});
