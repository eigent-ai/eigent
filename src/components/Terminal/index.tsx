import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

// Terminal Component Properties Interface
interface TerminalComponentProps {
	content?: string[]; // terminal content array
	instanceId?: string; // terminal instance identifier, for multiple terminals
	showWelcome?: boolean; // whether to show welcome information
}

export default function TerminalComponent({
	content,
	instanceId = "default",
	showWelcome = false,
}: TerminalComponentProps) {
	//Get Chatstore for the active project's task
	const { chatStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	

	// DOM references
	const terminalContainerRef = useRef<HTMLDivElement>(null); // terminal container reference
	const terminalRef = useRef<HTMLDivElement>(null); // terminal element reference

	// xterm.js related references
	const xtermRef = useRef<Terminal | null>(null); // xterm instance reference
	const fitAddonRef = useRef<FitAddon | null>(null); // fit addon reference

	// state management
	const lastTerminalLength = useRef<number>(0); // record last content length, for incremental update
	const [currentLine, setCurrentLine] = useState<string>(""); // current input line
	const [cursorPos, setCursorPos] = useState<number>(0); // cursor position
	const currentLineRef = useRef<string>(""); // current input line ref, for event handling
	const cursorPosRef = useRef<number>(0); // cursor position ref, for event handling

	// terminal configuration
	const promptText = "Eigent:~$ "; // prompt text
	const isInitialized = useRef<boolean>(false); // initialization identifier, prevent duplicate initialization

	// synchronize state to ref, for event handling
	useEffect(() => {
		currentLineRef.current = currentLine;
	}, [currentLine]);

	useEffect(() => {
		cursorPosRef.current = cursorPos;
	}, [cursorPos]);

	// keyboard input handling function
	const handleKeyInput = useCallback(
		({ key, domEvent }: { key: string; domEvent: KeyboardEvent }) => {
			const ev = domEvent;
			const printable = !ev.altKey && !ev.ctrlKey && !ev.metaKey; // check if it is printable character
			const terminal = xtermRef.current;
			if (!terminal) return;

			if (ev.keyCode === 13) {
				// Enter key: execute command
				terminal.writeln("");
				if (currentLineRef.current.trim()) {
					terminal.writeln(
						`\x1b[90m# Executed: ${currentLineRef.current}\x1b[0m`
					);
					terminal.writeln(
						`\x1b[33m⚠ Interactive mode not fully implemented\x1b[0m`
					);
				}
				setCurrentLine("");
				setCursorPos(0);
				terminal.write(promptText);
			} else if (ev.keyCode === 8) {
				// Backspace key: delete character
				if (cursorPosRef.current > 0) {
					const newLine =
						currentLineRef.current.slice(0, cursorPosRef.current - 1) +
						currentLineRef.current.slice(cursorPosRef.current);
					setCurrentLine(newLine);
					setCursorPos(cursorPosRef.current - 1);
					terminal.write("\b \b"); // delete character before cursor
				}
			} else if (ev.keyCode === 37) {
				// left arrow: move cursor left
				if (cursorPosRef.current > 0) {
					setCursorPos(cursorPosRef.current - 1);
					terminal.write("\x1b[D"); // ANSI escape sequence: move cursor left
				}
			} else if (ev.keyCode === 39) {
				// right arrow: move cursor right
				if (cursorPosRef.current < currentLineRef.current.length) {
					setCursorPos(cursorPosRef.current + 1);
					terminal.write("\x1b[C"); // ANSI escape sequence: move cursor right
				}
			} else if (printable) {
				// printable character: insert at cursor position
				const newLine =
					currentLineRef.current.slice(0, cursorPosRef.current) +
					key +
					currentLineRef.current.slice(cursorPosRef.current);
				setCurrentLine(newLine);
				setCursorPos(cursorPosRef.current + 1);
				terminal.write(key);
			}
		},
		[promptText]
	);

	// initialize xterm terminal
	useEffect(() => {
		if (!terminalRef.current || isInitialized.current) return;
		console.log("isInitialized.current", isInitialized.current);
		// mark as initialized
		isInitialized.current = true;

		// create terminal instance
		const terminal = new Terminal({
			theme: {
				background: "transparent", // transparent background
				foreground: "#ffffff", // white foreground
				cursor: "#00ff00", // green cursor
				cursorAccent: "#00ff00", // cursor accent
			},
			fontFamily: '"Courier New", Courier, monospace', // monospace font
			fontSize: 12, // font size
			lineHeight: 1.2, // line height
			letterSpacing: 0, // letter spacing
			cursorBlink: true, // cursor blink
			allowProposedApi: true, // allow proposed API
			scrollback: 1000, // scrollback lines
			rightClickSelectsWord: true, // right click selects word
			smoothScrollDuration: 0, // smooth scroll duration
			fastScrollModifier: "alt", // fast scroll modifier
			convertEol: true, // convert end of line
			windowsMode: true, // Windows mode
			cols: 100, // columns
			rows: 30, // rows
		});

		// add plugins
		const fitAddon = new FitAddon(); // fit addon
		const webLinksAddon = new WebLinksAddon(); // web links addon

		terminal.loadAddon(fitAddon);
		terminal.loadAddon(webLinksAddon);

		// open terminal
		terminal.open(terminalRef.current);

		// wait for layout to stabilize and adapt size, then write content
		setTimeout(() => {
			fitAddon.fit(); // adapt container size

			// only show welcome information when needed
			if (showWelcome) {
				terminal.writeln("\x1b[32m=== Eigent Terminal ===\x1b[0m");
				terminal.writeln(`\x1b[32mInstance: ${instanceId}\x1b[0m`);
				terminal.writeln("\x1b[32mReady for commands...\x1b[0m");
				terminal.writeln("");
			}

			// show prompt
			// terminal.write(promptText);
		}, 300);

		// save reference
		xtermRef.current = terminal;
		fitAddonRef.current = fitAddon;

		// add keyboard input handling
		terminal.onKey(handleKeyInput);

		// clean up function
		return () => {
			terminal.dispose(); // destroy terminal instance
			xtermRef.current = null;
			isInitialized.current = false;
		};
	}, [handleKeyInput, promptText, showWelcome, instanceId]);

	// listen to container size change
	useEffect(() => {
		if (!terminalContainerRef.current || !fitAddonRef.current) return;

		// use ResizeObserver to listen to container size change
		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// delay execution of fit to ensure layout stability
				setTimeout(() => {
					if (fitAddonRef.current) {
						fitAddonRef.current.fit();
					}
				}, 100);
			}
		});

		resizeObserver.observe(terminalContainerRef.current);

		// listen to window size change
		const handleResize = () => {
			setTimeout(() => {
				if (fitAddonRef.current) {
					fitAddonRef.current.fit();
				}
			}, 150);
		};
		window.addEventListener("resize", handleResize);

		// clean up listeners
		return () => {
			resizeObserver.disconnect();
			window.removeEventListener("resize", handleResize);
		};
	}, []);

	// listen to terminal data change and write to xterm
	useEffect(() => {
		if (!xtermRef.current || !content) return;
		const terminalData = content;
		const currentLength = terminalData.length;

		// check if it is the case of component re-initialization
		// if lastTerminalLength is 0 but content has data, it means re-initialization
		if (lastTerminalLength.current === 0 && currentLength > 0) {
			console.log("component re-initialization, skip history data write");
			lastTerminalLength.current = currentLength;
			return;
		}

		// only process new data (incremental update)
		if (currentLength > lastTerminalLength.current) {
			const newData = terminalData.slice(lastTerminalLength.current);

			console.log("newData", newData);
			newData.forEach((item) => {
				if (!xtermRef.current) return;

				// move to line head and clear whole line
				xtermRef.current.write("\r");
				xtermRef.current.write("\x1b[2K"); // clear whole line

				// process output content
				const formattedOutput = item
					.replace(/\r?\n$/, "") // remove trailing newline
					.replace(/\t/g, "    ") // convert tab to 4 spaces
					.replace(/\r/g, ""); // remove carriage return

				if (formattedOutput.trim()) {
					xtermRef.current.writeln(`\x1b[36m[Eigent]\x1b[0m ${formattedOutput}`);
				} else {
					xtermRef.current.writeln("");
				}

				// re-display prompt
				xtermRef.current.write(promptText);

				// re-display current input
				if (currentLineRef.current) {
					xtermRef.current.write(currentLineRef.current);

					// if cursor is not at the end, move to the correct position
					if (cursorPosRef.current < currentLineRef.current.length) {
						const moveBack =
							currentLineRef.current.length - cursorPosRef.current;
						for (let i = 0; i < moveBack; i++) {
							xtermRef.current.write("\x1b[D"); // move cursor left
						}
					}
				}
			});

			lastTerminalLength.current = currentLength;
		}
	}, [content, promptText]);

	// reset terminal when switching task
	useEffect(() => {
		if (!xtermRef.current) return;

		// clear terminal
		xtermRef.current.clear();

		// reset state
		lastTerminalLength.current = 0;
		setCurrentLine("");
		setCursorPos(0);

		// delay re-initialization
		setTimeout(() => {
			if (!xtermRef.current || !fitAddonRef.current) return;

			// re-adapt size
			fitAddonRef.current.fit();

			// only show switch information on main instance
			if (showWelcome) {
				xtermRef.current.writeln("\x1b[32m=== Eigent Terminal ===\x1b[0m");
				xtermRef.current.writeln(`\x1b[32mInstance: ${instanceId}\x1b[0m`);
				xtermRef.current.writeln("\x1b[32mTask switched...\x1b[0m");
				xtermRef.current.writeln("");
			}

			// if there is history data, re-write
			if (chatStore.activeTaskId) {
				const terminalData = content || [];
				if (terminalData.length > 0) {
					xtermRef.current.writeln("\x1b[90m--- Previous Output ---\x1b[0m");
					terminalData.forEach((item) => {
						const formattedOutput = item
							.replace(/\r?\n$/, "")
							.replace(/\t/g, "    ")
							.replace(/\r/g, "");

						if (formattedOutput.trim()) {
							xtermRef.current?.writeln(
								`\x1b[36m[Eigent]\x1b[0m ${formattedOutput}`
							);
						}
					});
					xtermRef.current.writeln(
						"\x1b[90m--- End Previous Output ---\x1b[0m"
					);
					xtermRef.current.writeln("");
				}
				lastTerminalLength.current = terminalData.length;
			}

			// show prompt
			xtermRef.current.write(promptText);
		}, 200);
	}, [chatStore.activeTaskId, showWelcome, instanceId]);

	// render terminal component
	return (
		<div
			ref={terminalContainerRef}
			className="w-full h-full flex flex-col rounded-2xl border border-zinc-300 border-solid relative overflow-hidden"
			style={{ fontFamily: '"Courier New", Courier, monospace' }}
		>
			{/* background blur effect */}
			<div className="absolute inset-0 blur-bg pointer-events-none bg-black-100% rounded-xl"></div>

			{/* terminal container */}
			<div
				ref={terminalRef}
				className="absolute inset-0 z-10"
				style={{
					margin: "16px",
					width: "calc(100% - 32px)",
					height: "calc(100% - 32px)",
					fontFamily: '"Courier New", Courier, monospace',
				}}
			/>

			{/* custom style: override xterm.js character spacing */}
			<style
				dangerouslySetInnerHTML={{
					__html: `
					.xterm span {
						letter-spacing: 0.5px !important;
					}
				`,
				}}
			/>
		</div>
	);
}
