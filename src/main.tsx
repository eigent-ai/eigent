import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { HashRouter } from "react-router-dom";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "./style/index.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { TooltipProvider } from "./components/ui/tooltip";
import "./i18n";

// If you want use Node.js, the`nodeIntegration` needs to be enabled in the Main process.
// import './demos/node'
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	// <React.StrictMode>
	<Suspense fallback={<div></div>}>
		<HashRouter>
			<ThemeProvider>
				<TooltipProvider>
					<App />
				</TooltipProvider>
			</ThemeProvider>
		</HashRouter>
	</Suspense>
	// </React.StrictMode>
);

postMessage({ payload: "removeLoading" }, "*");
