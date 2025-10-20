import { ipcMain, BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import mammoth from 'mammoth'
import Papa from 'papaparse'
import * as unzipper from 'unzipper'
import { parseStringPromise } from 'xml2js'
import https from 'https'
import http from 'http'
import { URL } from 'url'


export class FileReader {
	private win: BrowserWindow | null = null
	constructor(window: BrowserWindow) {
		this.win = window
	}

	// Remove automatic IPC handler registration from constructor
	// IPC handlers should be registered once in the main process

	private async parseDocx(filePath: string): Promise<string> {
		try {
			const result = await mammoth.convertToHtml({ path: filePath })
			return result.value // The generated HTML
		} catch (error) {
			console.error('DOCX parsing error:', error)
			throw error
		}
	}

	private async parseDoc(filePath: string): Promise<string> {
		try {
			const result = await mammoth.convertToHtml({ path: filePath })
			return result.value // The generated HTML
		} catch (error) {
			console.error('DOC parsing error:', error)
			throw error
		}
	}

	private async parseXlsx(filePath: string): Promise<string> {
		try {
			const directory = await unzipper.Open.file(filePath);

			// Find the shared strings file and worksheets
			const sharedStringsFile = directory.files.find((f: any) => f.path === 'xl/sharedStrings.xml');
			const worksheetFiles = directory.files.filter((f: any) => f.path.match(/^xl\/worksheets\/sheet\d+\.xml$/));

			// Parse shared strings if exists
			let sharedStrings: string[] = [];
			if (sharedStringsFile) {
				const sharedStringsBuffer = await sharedStringsFile.buffer();
				const sharedStringsContent = sharedStringsBuffer.toString('utf-8');
				const parsedSharedStrings = await parseStringPromise(sharedStringsContent);

				if (parsedSharedStrings.sst && parsedSharedStrings.sst.si) {
					sharedStrings = parsedSharedStrings.sst.si.map((si: any) => {
						// Handle simple text nodes
						if (si.t && si.t[0]) {
							return typeof si.t[0] === 'string' ? si.t[0] : String(si.t[0]);
						}
						// Handle rich text nodes
						if (si.r) {
							return si.r.map((r: any) => {
								if (r.t && r.t[0]) {
									return typeof r.t[0] === 'string' ? r.t[0] : String(r.t[0]);
								}
								return '';
							}).join('');
						}
						// Handle direct string values
						if (typeof si === 'string') {
							return si;
						}
						return '';
					});
					console.log(`Parsed ${sharedStrings.length} shared strings`);
				}
			}

			let html = `
				<style>
					.xlsx-container {
						font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
						padding: 20px;
					}
					.xlsx-table {
						border-collapse: collapse;
						width: 100%;
						margin: 10px 0;
						font-size: 14px;
						box-shadow: 0 1px 3px rgba(0,0,0,0.1);
					}
					.xlsx-table th {
						background-color: #f8f9fa;
						border: 1px solid #dee2e6;
						padding: 12px 8px;
						text-align: left;
						font-weight: 600;
						color: #495057;
						position: sticky;
						top: 0;
						z-index: 10;
					}
					.xlsx-table td {
						border: 1px solid #dee2e6;
						padding: 8px;
						color: #212529;
					}
					.xlsx-table tr:nth-child(even) {
						background-color: #f8f9fa;
					}
					.xlsx-table tr:hover {
						background-color: #e9ecef;
					}
					.sheet-title {
						font-size: 18px;
						font-weight: 600;
						margin: 20px 0 10px 0;
						color: #212529;
					}
				</style>
				<div class="xlsx-container">
			`;

			// Process each worksheet
			for (let i = 0; i < worksheetFiles.length && i < 5; i++) { // Limit to first 5 sheets
				const file = worksheetFiles[i];
				const contentBuffer = await file.buffer();
				const content = contentBuffer.toString('utf-8');
				const parsed = await parseStringPromise(content);

				if (worksheetFiles.length > 1) {
					html += `<h3 class="sheet-title">Sheet ${i + 1}</h3>`;
				}

				// Create table
				html += '<table class="xlsx-table">';

				// Get all rows
				const rows = parsed.worksheet?.sheetData?.[0]?.row || [];

				// Find the maximum column to create column headers
				let maxCol = 0;
				for (const row of rows) {
					const cells = row.c || [];
					for (const cell of cells) {
						if (cell.$ && cell.$.r) {
							const colMatch = cell.$.r.match(/^([A-Z]+)/);
							if (colMatch) {
								const colIndex = this.columnToNumber(colMatch[1]);
								maxCol = Math.max(maxCol, colIndex);
							}
						}
					}
				}

				// Add column headers row (A, B, C, ...)
				html += '<thead><tr>';
				html += '<th style="background-color: #e9ecef; width: 50px;"></th>'; // Empty cell for row numbers
				for (let i = 0; i < maxCol; i++) {
					html += `<th>${this.numberToColumn(i + 1)}</th>`;
				}
				html += '</tr></thead>';

				// Add data rows
				html += '<tbody>';
				for (const row of rows) {
					html += '<tr>';

					// Add row number
					const rowNum = row.$ && row.$.r ? row.$.r : '';
					html += `<th style="background-color: #e9ecef; text-align: center;">${rowNum}</th>`;

					// Create cells array with proper indexing
					const cells = row.c || [];
					const cellMap = new Map();

					// Map cells by column index
					for (const cell of cells) {
						if (cell.$ && cell.$.r) {
							const colMatch = cell.$.r.match(/^([A-Z]+)/);
							if (colMatch) {
								const colIndex = this.columnToNumber(colMatch[1]);
								cellMap.set(colIndex, cell);
							}
						}
					}

					// Add cells in order, including empty cells
					for (let i = 1; i <= maxCol; i++) {
						const cell = cellMap.get(i);
						const cellValue = cell ? this.getCellValue(cell, sharedStrings) : '';
						html += `<td>${cellValue}</td>`;
					}

					html += '</tr>';
				}
				html += '</tbody>';

				html += '</table>';
			}

			html += '</div></div>';
			return html;
		} catch (error) {
			console.error('XLSX parsing error:', error);
			throw error;
		}
	}

	private columnToNumber(column: string): number {
		let result = 0;
		for (let i = 0; i < column.length; i++) {
			result = result * 26 + (column.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
		}
		return result;
	}

	private numberToColumn(num: number): string {
		let column = '';
		while (num > 0) {
			num--;
			column = String.fromCharCode((num % 26) + 'A'.charCodeAt(0)) + column;
			num = Math.floor(num / 26);
		}
		return column;
	}

	private getCellValue(cell: any, sharedStrings: string[]): string {
		try {
			// If cell has a value
			if (cell.v && cell.v[0] !== undefined) {
				const value = cell.v[0];

				// Check cell type
				if (cell.$ && cell.$.t === 's') {
					// Shared string
					const index = parseInt(value);
					if (!isNaN(index) && index >= 0 && index < sharedStrings.length) {
						return sharedStrings[index] || '';
					}
					console.warn(`Shared string index ${index} out of bounds (array length: ${sharedStrings.length})`);
					return value; // Return raw value as fallback
				} else if (cell.$ && cell.$.t === 'inlineStr') {
					// Inline string
					return cell.is?.[0]?.t?.[0] || '';
				} else if (cell.$ && cell.$.t === 'str') {
					// Formula result string
					return value;
				} else {
					// Number or other value
					// Format numbers to avoid long decimals
					const numValue = parseFloat(value);
					if (!isNaN(numValue) && numValue % 1 !== 0) {
						return numValue.toFixed(2);
					}
					return value;
				}
			}

			// Check for inline string without type attribute
			if (cell.is && cell.is[0] && cell.is[0].t && cell.is[0].t[0]) {
				return cell.is[0].t[0];
			}

			// Check for formula cells
			if (cell.f && cell.f[0] && cell.v && cell.v[0]) {
				return cell.v[0];
			}

			return '';
		} catch (error) {
			console.error('Error getting cell value:', error, 'Cell:', JSON.stringify(cell));
			return '';
		}
	}

	private async parsePptx(filePath: string): Promise<string> {
		try {
			const directory = await unzipper.Open.file(filePath)
			const slideFiles = directory.files.filter((f: any) => f.path.match(/^ppt\/slides\/slide\d+\.xml$/))

			let html = '<div style="font-family: sans-serif;">'

			for (let i = 0; i < slideFiles.length; i++) {
				const file = slideFiles[i]
				const contentBuffer = await file.buffer()
				const content = contentBuffer.toString('utf-8')
				const parsed = await parseStringPromise(content)

				html += `<h3>Slide ${i + 1}</h3><ul>`

				const texts = parsed['p:sld']['p:cSld'][0]['p:spTree'][0]['p:sp'] || []

				for (const textNode of texts) {
					const paras = textNode?.['p:txBody']?.[0]?.['a:p'] || []
					for (const para of paras) {
						const runs = para?.['a:r'] || []
						for (const run of runs) {
							const text = run?.['a:t']?.[0]
							if (text) {
								html += `<li>${text}</li>`
							}
						}
					}
				}

				html += '</ul><hr/>'
			}

			html += '</div>'
			return html
		} catch (error) {
			console.error('PPTX unzip parse error:', error)
			throw error
		}
	}

	private async parseCsv(filePath: string): Promise<string> {
		try {
			const fileContent = fs.readFileSync(filePath, 'utf-8')
			const result = Papa.parse(fileContent, {
				header: true,
				skipEmptyLines: true,
				delimiter: ","
			})

			// Convert to HTML table
			if (result.data && result.data.length > 0) {
				const headers = Object.keys(result.data[0] as string[])
				let html = '<table style="border-collapse: collapse; width: 100%; font-family: monospace;">'

				// Header row
				html += '<thead><tr style="background-color: #f5f5f5;">'
				headers.forEach(header => {
					html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left;">${header}</th>`
				})
				html += '</tr></thead>'

				// Data rows
				html += '<tbody>'
				result.data.forEach((row: any) => {
					html += '<tr>'
					headers.forEach(header => {
						html += `<td style="border: 1px solid #ddd; padding: 8px;">${row[header] || ''}</td>`
					})
					html += '</tr>'
				})
				html += '</tbody></table>'

				return html
			}
			return '<p>Empty CSV file</p>'
		} catch (error) {
			console.error('CSV parsing error:', error)
			throw error
		}
	}

	// add download file method
	private async downloadFile(url: string, localPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const urlObj = new URL(url);
			const protocol = urlObj.protocol === 'https:' ? https : http;

			const request = protocol.get(url, (response) => {
				if (response.statusCode !== 200) {
					reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
					return;
				}

				const fileStream = fs.createWriteStream(localPath);
				response.pipe(fileStream);

				fileStream.on('finish', () => {
					fileStream.close();
					resolve();
				});

				fileStream.on('error', (err) => {
					fs.unlink(localPath, (unlinkErr) => {
						if (unlinkErr) console.error('Failed to delete incomplete file:', unlinkErr);
					}); // delete incomplete file
					reject(err);
				});
			});

			request.on('error', (err) => {
				reject(err);
			});

			request.setTimeout(30000, () => {
				request.destroy();
				reject(new Error('Download timeout'));
			});
		});
	}

	// check if it is a local file path
	private isLocalFile(filePath: string): boolean {
		return filePath.startsWith('localfile://') ||
			filePath.startsWith('file://') ||
			(!filePath.startsWith('http://') && !filePath.startsWith('https://') && !filePath.includes('://'));
	}

	// get temporary file path
	private getTempFilePath(originalPath: string, type: string): string {
		const userData = app.getPath('userData');
		const tempDir = path.join(userData, 'temp');

		// ensure temporary directory exists
		if (!fs.existsSync(tempDir)) {
			fs.mkdirSync(tempDir, { recursive: true });
		}

		const fileName = path.basename(originalPath) || `temp_${Date.now()}.${type}`;
		return path.join(tempDir, fileName);
	}

	public openFile(type: string, filePath: string, isShowSourceCode: boolean) {
		return new Promise(async (resolve, reject) => {
			try {
				// check if it is a remote file
				if (!this.isLocalFile(filePath)) {
					console.log('detect remote file, start downloading:', filePath);

					// download file to temporary directory
					const tempPath = this.getTempFilePath(filePath, type);
					try {
						await this.downloadFile(filePath, tempPath);
						console.log('file download completed:', tempPath);

						// use temporary file path to continue processing
						filePath = tempPath;
					} catch (downloadError) {
						console.error('file download failed:', downloadError);
						reject(downloadError);
						return;
					}
				}

				// original file processing logic
				if (type === 'md') {
					const content = fs.readFileSync(filePath, 'utf-8')
					resolve(content)
				} else if (type === 'html') {
					const content = fs.readFileSync(filePath, 'utf-8')
					resolve(content)
				} else if (["pdf"].includes(type)) {
					resolve(filePath)
				} else if (type === "csv") {
					try {
						const htmlContent = await this.parseCsv(filePath)
						resolve(htmlContent)
					} catch (error) {
						console.warn('CSV parsing failed, reading as text:', error)
						const content = fs.readFileSync(filePath, 'utf-8')
						resolve(content)
					}
				} else if (type === "docx") {
					try {
						const htmlContent = await this.parseDocx(filePath)
						resolve(htmlContent)
					} catch (error) {
						console.warn('DOCX parsing failed, reading as text:', error)
						const content = fs.readFileSync(filePath, 'utf-8')
						resolve(content)
					}
				} else if (type === "doc") {
					try {
						const htmlContent = await this.parseDoc(filePath)
						resolve(htmlContent)
					} catch (error) {
						console.warn('DOC parsing failed, reading as text:', error)
						const content = fs.readFileSync(filePath, 'utf-8')
						resolve(content)
					}
				} else if (type === 'pptx') {
					try {
						const htmlContent = await this.parsePptx(filePath)
						resolve(htmlContent)
					} catch (error) {
						console.warn('PPTX parsing failed, reading as binary string:', error)
						const content = fs.readFileSync(filePath, 'base64') //  backup processing
						resolve(`<pre>${content}</pre>`)
					}
				} else if (type === 'xlsx') {
					try {
						const htmlContent = await this.parseXlsx(filePath)
						resolve(htmlContent)
					} catch (error) {
						console.warn('XLSX parsing failed, reading as text:', error)
						const content = fs.readFileSync(filePath, 'utf-8')
						resolve(content)
					}
				} else {
					const content = fs.readFileSync(filePath, 'utf-8')
					resolve(content)
				}
			} catch (error) {
				reject(error)
			}
		})
	}

	private getFilesRecursive(dirPath: string, basePath: string): FileInfo[] {
		try {
			const files = fs.readdirSync(dirPath);
			const result: FileInfo[] = [];

			for (const file of files) {
				if (file.startsWith(".")) continue;

				const filePath = path.join(dirPath, file);
				const stats = fs.statSync(filePath);
				const isFolder = stats.isDirectory();
				const relativePath = path.relative(basePath, dirPath);

				const fileInfo: FileInfo = {
					path: filePath,
					name: file,
					type: isFolder ? 'folder' : (file.split('.').pop()?.toLowerCase() || ''),
					isFolder: isFolder,
					relativePath: relativePath === '' ? '' : relativePath
				};

				result.push(fileInfo);

				if (isFolder) {
					const subFiles = this.getFilesRecursive(filePath, basePath);
					result.push(...subFiles);
				}
			}

			return result;
		} catch (err) {
			console.error("Error reading directory:", dirPath, err);
			return [];
		}
	}

	private findTaskInProjects(userDir: string, taskId: string): string | null {
		try {
			if (!fs.existsSync(userDir)) {
				return null;
			}

			const entries = fs.readdirSync(userDir);
			
			// Look for project directories
			for (const entry of entries) {
				if (entry.startsWith('project_')) {
					const projectDir = path.join(userDir, entry);
					const taskDir = path.join(projectDir, `task_${taskId}`);
					
					if (fs.existsSync(taskDir)) {
						return taskDir;
					}
				}
			}
			
			return null;
		} catch (err) {
			console.error("Error finding task in projects:", err);
			return null;
		}
	}

	public getFileList(email: string, taskId: string, projectId?: string): FileInfo[] {
		const safeEmail = email.split('@')[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(/^\.+|\.+$/g, "");
		const userHome = app.getPath('home');
		
		let dirPath: string;
		
		// Check if projectId is provided for new project-based structure
		if (projectId) {
			dirPath = path.join(userHome, "eigent", safeEmail, `project_${projectId}`, `task_${taskId}`);
		} else {
			// First try project-based structure (scan for existing projects)
			const userDir = path.join(userHome, "eigent", safeEmail);
			const projectBasedPath = this.findTaskInProjects(userDir, taskId);
			
			if (projectBasedPath) {
				dirPath = projectBasedPath;
			} else {
				// Fallback to legacy direct task structure
				dirPath = path.join(userHome, "eigent", safeEmail, `task_${taskId}`);
			}
		}

		try {
			if (!fs.existsSync(dirPath)) {
				return [];
			}

			return this.getFilesRecursive(dirPath, dirPath);
		} catch (err) {
			console.error("Load file failed:", err);
			return [];
		}
	}

	public deleteTaskFiles(email: string, taskId: string, projectId?: string): {
		success: boolean;
		path: { dirPath: string; logPath: string }
	}
	{
		const safeEmail = email.split('@')[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(/^\.+|\.+$/g, "");
		const userHome = app.getPath('home');
		
		let dirPath: string;
		let logPath: string;
		
		// Check if projectId is provided for new project-based structure
		if (projectId) {
			dirPath = path.join(userHome, "eigent", safeEmail, `project_${projectId}`, `task_${taskId}`);
			logPath = path.join(userHome, ".eigent", safeEmail, `project_${projectId}`, `task_${taskId}`);
		} else {
			// First try project-based structure
			const userDir = path.join(userHome, "eigent", safeEmail);
			const projectBasedPath = this.findTaskInProjects(userDir, taskId);
			
			if (projectBasedPath) {
				dirPath = projectBasedPath;
				// Extract project from path to construct log path
				const projectMatch = projectBasedPath.match(/project_([^\\\/]+)/);
				if (projectMatch) {
					logPath = path.join(userHome, ".eigent", safeEmail, projectMatch[0], `task_${taskId}`);
				} else {
					logPath = path.join(userHome, ".eigent", safeEmail, `task_${taskId}`);
				}
			} else {
				// Fallback to legacy direct task structure
				dirPath = path.join(userHome, "eigent", safeEmail, `task_${taskId}`);
				logPath = path.join(userHome, ".eigent", safeEmail, `task_${taskId}`);
			}
		}

		try {
			let success = false;
			if (fs.existsSync(dirPath)) {
				fs.rmSync(dirPath, { recursive: true, force: true });
				success = true;
			}
			if (fs.existsSync(logPath)) {
				fs.rmSync(logPath, { recursive: true, force: true });
				success = true;
			}
			return { success, path: { dirPath, logPath } };
		} catch (err) {
			console.error("Delete task files failed:", dirPath, err);
			return { success: false, path: { dirPath, logPath } };
		}
	}

	public getLogFolder(email: string): string {
		const safeEmail = email.split('@')[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(/^\.+|\.+$/g, "");
		const userHome = app.getPath('home');
		const dirPath = path.join(userHome, "eigent", safeEmail);

		try {
			if (!fs.existsSync(dirPath)) {
				return '';
			}

			return dirPath
		} catch (err) {
			console.error("Load file failed:", err);
			return '';
		}
	}

	public createProjectStructure(email: string, projectId: string): { success: boolean; path: string } {
		const safeEmail = email.split('@')[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(/^\.+|\.+$/g, "");
		const userHome = app.getPath('home');
		const projectPath = path.join(userHome, "eigent", safeEmail, `project_${projectId}`);

		try {
			if (!fs.existsSync(projectPath)) {
				fs.mkdirSync(projectPath, { recursive: true });
			}
			return { success: true, path: projectPath };
		} catch (err) {
			console.error("Create project structure failed:", err);
			return { success: false, path: projectPath };
		}
	}

	public getProjectList(email: string): Array<{ id: string; name: string; path: string; taskCount: number; createdAt: Date }> {
		const safeEmail = email.split('@')[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(/^\.+|\.+$/g, "");
		const userHome = app.getPath('home');
		const userDir = path.join(userHome, "eigent", safeEmail);

		try {
			if (!fs.existsSync(userDir)) {
				return [];
			}

			const entries = fs.readdirSync(userDir);
			const projects: Array<{ id: string; name: string; path: string; taskCount: number; createdAt: Date }> = [];

			for (const entry of entries) {
				if (entry.startsWith('project_')) {
					const projectPath = path.join(userDir, entry);
					const stats = fs.statSync(projectPath);
					
					if (stats.isDirectory()) {
						const projectId = entry.replace('project_', '');
						
						// Count tasks in this project
						const taskCount = this.countTasksInProject(projectPath);
						
						projects.push({
							id: projectId,
							name: `Project ${projectId}`,
							path: projectPath,
							taskCount,
							createdAt: stats.birthtime
						});
					}
				}
			}

			return projects.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		} catch (err) {
			console.error("Get project list failed:", err);
			return [];
		}
	}

	public getTasksInProject(email: string, projectId: string): Array<{ id: string; name: string; path: string; createdAt: Date }> {
		const safeEmail = email.split('@')[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(/^\.+|\.+$/g, "");
		const userHome = app.getPath('home');
		const projectPath = path.join(userHome, "eigent", safeEmail, `project_${projectId}`);

		try {
			if (!fs.existsSync(projectPath)) {
				return [];
			}

			const entries = fs.readdirSync(projectPath);
			const tasks: Array<{ id: string; name: string; path: string; createdAt: Date }> = [];

			for (const entry of entries) {
				if (entry.startsWith('task_')) {
					const taskPath = path.join(projectPath, entry);
					const stats = fs.statSync(taskPath);
					
					if (stats.isDirectory()) {
						const taskId = entry.replace('task_', '');
						
						tasks.push({
							id: taskId,
							name: `Task ${taskId}`,
							path: taskPath,
							createdAt: stats.birthtime
						});
					}
				}
			}

			return tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		} catch (err) {
			console.error("Get tasks in project failed:", err);
			return [];
		}
	}

	public moveTaskToProject(email: string, taskId: string, projectId: string): { success: boolean; message: string } {
		const safeEmail = email.split('@')[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(/^\.+|\.+$/g, "");
		const userHome = app.getPath('home');
		
		// Source path (legacy structure)
		const sourcePath = path.join(userHome, "eigent", safeEmail, `task_${taskId}`);
		const sourceLogPath = path.join(userHome, ".eigent", safeEmail, `task_${taskId}`);
		
		// Destination paths (project structure)
		const projectPath = path.join(userHome, "eigent", safeEmail, `project_${projectId}`);
		const destPath = path.join(projectPath, `task_${taskId}`);
		const destLogPath = path.join(userHome, ".eigent", safeEmail, `project_${projectId}`, `task_${taskId}`);

		try {
			// Create project structure if it doesn't exist
			if (!fs.existsSync(projectPath)) {
				fs.mkdirSync(projectPath, { recursive: true });
			}

			// Create destination log directory
			const destLogDir = path.dirname(destLogPath);
			if (!fs.existsSync(destLogDir)) {
				fs.mkdirSync(destLogDir, { recursive: true });
			}

			// Move task files
			if (fs.existsSync(sourcePath)) {
				fs.renameSync(sourcePath, destPath);
			}

			// Move log files
			if (fs.existsSync(sourceLogPath)) {
				fs.renameSync(sourceLogPath, destLogPath);
			}

			return { success: true, message: `Task ${taskId} moved to project ${projectId}` };
		} catch (err) {
			console.error("Move task to project failed:", err);
			return { success: false, message: `Failed to move task: ${err}` };
		}
	}

	public getProjectFileList(email: string, projectId: string): FileInfo[] {
		const safeEmail = email.split('@')[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(/^\.+|\.+$/g, "");
		const userHome = app.getPath('home');
		const projectPath = path.join(userHome, "eigent", safeEmail, `project_${projectId}`);

		try {
			if (!fs.existsSync(projectPath)) {
				return [];
			}

			const allFiles: FileInfo[] = [];
			const taskDirs = fs.readdirSync(projectPath);

			for (const taskDir of taskDirs) {
				if (!taskDir.startsWith('task_')) continue;

				const taskPath = path.join(projectPath, taskDir);
				const stats = fs.statSync(taskPath);
				
				if (stats.isDirectory()) {
					const taskId = taskDir.replace('task_', '');
					const taskFiles = this.getFilesRecursive(taskPath, taskPath);

					const enrichedFiles = taskFiles.map(file => {
						const fileDir = path.dirname(file.path);
						const relativeParentPath = path.relative(projectPath, fileDir);

						return {
							...file,
							task_id: taskId,
							project_id: projectId,
							relativePath: relativeParentPath === '.' ? '' : relativeParentPath
						};
					});

					allFiles.push(...enrichedFiles);
				}
			}

			return allFiles.sort((a, b) => {
				// Sort by task_id first, then by file path
				if (a.task_id !== b.task_id) {
					return a.task_id!.localeCompare(b.task_id!);
				}
				return a.path.localeCompare(b.path);
			});
		} catch (err) {
			console.error("Get project file list failed:", err);
			return [];
		}
	}

	private countTasksInProject(projectPath: string): number {
		try {
			const entries = fs.readdirSync(projectPath);
			return entries.filter(entry => entry.startsWith('task_')).length;
		} catch (err) {
			console.error("Count tasks in project failed:", err);
			return 0;
		}
	}
}

