import { ipcMain, WebContentsView, BrowserWindow } from "electron";

interface WebViewInfo {
	id: string;
	view: WebContentsView;
	initialUrl: string;
	currentUrl: string;
	isActive: boolean;
	isShow: boolean;
}

interface Size {
	x: number;
	y: number;
	width: number;
	height: number;
}

export class WebViewManager {
	private webViews = new Map<string, WebViewInfo>();
	private win: BrowserWindow | null = null;
	private size: Size = { x: 0, y: 0, width: 0, height: 0 };
	constructor(window: BrowserWindow) {
		this.win = window;
	}

	// Remove automatic IPC handler registration from constructor
	// IPC handlers should be registered once in the main process

	public async captureWebview(webviewId: string) {
		const webContents = this.webViews.get(webviewId);
		if (!webContents) return null;

		const image = await webContents.view.webContents.capturePage();
		const jpegBuffer = image.toJPEG(10);
		return "data:image/jpeg;base64," + jpegBuffer.toString("base64");
	}

	public setSize(size: Size) {
		this.size = size;
		this.webViews.forEach((webview) => {
			if (webview.isActive && webview.isShow) {
				this.changeViewSize(webview.id, size);
			}
		});
	}

	public getActiveWebview() {
		const activeWebviews = Array.from(this.webViews.values()).filter(
			(webview) => webview.isActive,
		);

		return activeWebviews.map((webview) => webview.id);
	}

	public async createWebview(
		id: string = "1",
		url: string = "about:blank?use=0",
	) {
		try {
			// If webview with this id already exists, return error
			if (this.webViews.has(id)) {
				return {
					success: false,
					error: `Webview with id ${id} already exists`,
				};
			}
			const view = new WebContentsView({
				webPreferences: {
					nodeIntegration: false,
					contextIsolation: true,
				},
			});
			view.webContents.on("did-finish-load", () => {
				view.webContents.executeJavaScript(`
          window.addEventListener('mousedown', (e) => {
            if (!(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement)) {
              e.preventDefault();
            }
          }, true);
        `);
			});

			// Set to muted state when created
			view.webContents.audioMuted = true;
			let newId = Number(id);
			view.setBounds({
				x: -9999 + newId * 100,
				y: -9999 + newId * 100,
				width: 100,
				height: 100,
			});
			view.setBorderRadius(16);

			await view.webContents.loadURL(url);

			const webViewInfo: WebViewInfo = {
				id,
				view,
				initialUrl: url,
				currentUrl: url,
				isActive: false,
				isShow: false,
			};
			// view.webContents.on("did-navigate", (event, url) => {
			//   const win = BrowserWindow.fromWebContents(event.sender);
			//   win?.webContents.send("url-updated", url);
			// });

			view.webContents.on("did-navigate-in-page", (event, url) => {
				if (
					webViewInfo.isActive &&
					webViewInfo.isShow &&
					url !== "about:blank?use=0" &&
					url !== "about:blank"
				) {
					console.log("did-navigate-in-page", id, url);
					this.win?.webContents.send("url-updated", url);
					return;
				}
			});
			// Listen for URL change events
			view.webContents.on("did-navigate", (event, navigationUrl) => {
				webViewInfo.currentUrl = navigationUrl;
				if (navigationUrl !== webViewInfo.initialUrl) {
					webViewInfo.isActive = true;
				}
				console.log(`Webview ${id} navigated to: ${navigationUrl}`);
				if (
					webViewInfo.isActive &&
					webViewInfo.isShow &&
					navigationUrl !== "about:blank?use=0" &&
					navigationUrl !== "about:blank"
				) {
					console.log("did-navigate", id, url);
					this.win?.webContents.send("url-updated", url);
					return;
				}
				webViewInfo.view.setBounds({
					x: -1919,
					y: -1079,
					width: 1920,
					height: 1080,
				});
				const activeSize = this.getActiveWebview().length;
				const allSize = Array.from(this.webViews.values()).length;
				if (allSize - activeSize <= 3) {
					const newId = Array.from(this.webViews.keys()).length + 2;
					this.createWebview(newId.toString(), "about:blank?use=0");
					this.createWebview((newId + 1).toString(), "about:blank?use=0");
					this.createWebview((newId + 2).toString(), "about:blank?use=0");
				}

				// setTimeout(() => {
				//   let newId = Number(id)
				//   view.setBounds({ x: -9999 + newId * 100, y: -9999 + newId * 100, width: 100, height: 100 })
				// }, 500)
				// Notify frontend when URL changes
				if (this.win && !this.win.isDestroyed()) {
					this.win.webContents.send("webview-navigated", id, navigationUrl);
				}
			});

			view.webContents.setWindowOpenHandler(({ url }) => {
				view.webContents.loadURL(url);

				return { action: "deny" };
			});
			// Store in Map
			this.webViews.set(id, webViewInfo);

			this.win?.contentView.addChildView(view);
			return { success: true, id, hidden: true };
		} catch (error: any) {
			console.error(`Failed to create hidden webview ${id}:`, error);
			return { success: false, error: error.message };
		}
	}

	public changeViewSize(id: string, size: Size) {
		try {
			const webViewInfo = this.webViews.get(id);
			if (!webViewInfo) {
				return { success: false, error: `Webview with id ${id} not found` };
			}

			const { x, y, width, height } = size;
			if (webViewInfo.isActive && webViewInfo.isShow) {
				webViewInfo.view.setBounds({
					x,
					y,
					width: Math.max(width, 100),
					height: Math.max(height, 100),
				});
			} else {
				let newId = Number(id);
				webViewInfo.view.setBounds({
					x: -9999 + newId * 100,
					y: -9999 + newId * 100,
					width: Math.max(width, 100),
					height: Math.max(height, 100),
				});
			}

			return { success: true };
		} catch (error: any) {
			console.error(`Failed to resize all webviews:`, error);
			return { success: false, error: error.message };
		}
	}

	public hideWebview(id: string) {
		const webViewInfo = this.webViews.get(id);
		if (!webViewInfo) {
			return { success: false, error: `Webview with id ${id} not found` };
		}
		let newId = Number(id);
		webViewInfo.view.setBounds({
			x: -9999 + newId * 100,
			y: -9999 + newId * 100,
			width: 100,
			height: 100,
		});
		webViewInfo.isShow = false;

		return { success: true };
	}
	public hideAllWebview() {
		this.webViews.forEach((webview) => {
			let newId = Number(webview.id);
			webview.view.setBounds({
				x: -9999 + newId * 100,
				y: -9999 + newId * 100,
				width: 100,
				height: 100,
			});
			webview.isShow = false;
		});
	}

	public showWebview(id: string) {
		const webViewInfo = this.webViews.get(id);
		if (!webViewInfo) {
			return { success: false, error: `Webview with id ${id} not found` };
		}
		const currentUrl = webViewInfo.view.webContents.getURL();
		this.win?.webContents.send("url-updated", currentUrl);
		webViewInfo.isShow = true;
		this.changeViewSize(id, this.size);
		console.log("showWebview", id, this.size);
		if (this.win && !this.win.isDestroyed()) {
			this.win.webContents.send("webview-show", id);
		}

		return { success: true };
	}
	public getShowWebview() {
		return JSON.parse(
			JSON.stringify(
				Array.from(this.webViews.values())
					.filter((webview) => webview.isShow)
					.map((webview) => webview.id),
			),
		);
	}

	public destroyWebview(id: string) {
		try {
			const webViewInfo = this.webViews.get(id);
			if (!webViewInfo) {
				return { success: false, error: `Webview with id ${id} not found` };
			}

			// remove webview from parent container
			if (this.win?.contentView) {
				this.win.contentView.removeChildView(webViewInfo.view);
			}

			// destroy webview
			webViewInfo.view.webContents.close();

			// remove from Map
			this.webViews.delete(id);

			console.log(`Webview ${id} destroyed successfully`);
			return { success: true };
		} catch (error: any) {
			console.error(`Failed to destroy webview ${id}:`, error);
			return { success: false, error: error.message };
		}
	}

	public distroy() {
		// TODO: Destroy all webviews
	}
}
