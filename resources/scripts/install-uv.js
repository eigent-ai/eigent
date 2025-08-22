// @ts-check
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import * as tar from "tar";
import AdmZip from "adm-zip";
import { downloadWithRedirects } from "./download.js";

// Base URL for downloading uv binaries
const UV_RELEASE_BASE_URL = "https://github.com/astral-sh/uv/releases/download";
const DEFAULT_UV_VERSION = "0.6.14";

// Mapping of platform+arch to binary package name
const UV_PACKAGES = {
	"darwin-arm64": "uv-aarch64-apple-darwin.tar.gz",
	"darwin-x64": "uv-x86_64-apple-darwin.tar.gz",
	"win32-arm64": "uv-aarch64-pc-windows-msvc.zip",
	"win32-ia32": "uv-i686-pc-windows-msvc.zip",
	"win32-x64": "uv-x86_64-pc-windows-msvc.zip",
	"linux-arm64": "uv-aarch64-unknown-linux-gnu.tar.gz",
	"linux-ia32": "uv-i686-unknown-linux-gnu.tar.gz",
	"linux-ppc64": "uv-powerpc64-unknown-linux-gnu.tar.gz",
	"linux-ppc64le": "uv-powerpc64le-unknown-linux-gnu.tar.gz",
	"linux-s390x": "uv-s390x-unknown-linux-gnu.tar.gz",
	"linux-x64": "uv-x86_64-unknown-linux-gnu.tar.gz",
	"linux-armv7l": "uv-armv7-unknown-linux-gnueabihf.tar.gz",
	// MUSL variants
	"linux-musl-arm64": "uv-aarch64-unknown-linux-musl.tar.gz",
	"linux-musl-ia32": "uv-i686-unknown-linux-musl.tar.gz",
	"linux-musl-x64": "uv-x86_64-unknown-linux-musl.tar.gz",
	"linux-musl-armv6l": "uv-arm-unknown-linux-musleabihf.tar.gz",
	"linux-musl-armv7l": "uv-armv7-unknown-linux-musleabihf.tar.gz",
};

/**
 * Downloads and extracts the uv binary for the specified platform and architecture
 * @param {string} platform Platform to download for (e.g., 'darwin', 'win32', 'linux')
 * @param {string} arch Architecture to download for (e.g., 'x64', 'arm64')
 * @param {string} version Version of uv to download
 * @param {boolean} isMusl Whether to use MUSL variant for Linux
 */
async function downloadUvBinary(
	uv_download_url,
	platform,
	arch,
	version = DEFAULT_UV_VERSION,
	isMusl = false
) {
  console.log('[START] downloadUvBinary:', uv_download_url);
	const platformKey = isMusl
		? `${platform}-musl-${arch}`
		: `${platform}-${arch}`;
	const packageName = UV_PACKAGES[platformKey];

	if (!packageName) {
		console.error(`No binary available for ${platformKey}`);
		return false;
	}

	// Create output directory structure
	const binDir = path.join(os.homedir(), ".eigent", "bin");
	// Ensure directories exist
	fs.mkdirSync(binDir, { recursive: true });

	// Download URL for the specific binary
	const downloadUrl = `${uv_download_url}/${version}/${packageName}`;
	const tempdir = os.tmpdir();
	const tempFilename = path.join(tempdir, packageName);

	try {
		console.log(`Downloading uv ${version} for ${platformKey}...`);
		console.log(`URL: ${downloadUrl}`);
		if (fs.existsSync(tempFilename)) fs.unlinkSync(tempFilename)
		await downloadWithRedirects(downloadUrl, tempFilename);

		console.log(`Extracting ${packageName} to ${binDir}...`);

		if (packageName.endsWith(".zip")) {
			// use adm-zip to handle zip file
			const zip = new AdmZip(tempFilename);
			zip.extractAllTo(binDir, true);
			fs.unlinkSync(tempFilename);
			console.log(
				`Successfully installed uv ${version} for ${platform}-${arch}`
			);
			return true;
		} else {
			// handle tar.gz file
			await tar.x({
				file: tempFilename,
				cwd: binDir,
				strip: 1,
				z: true,
				filter: (path) => {
					// Only extract the uv binary
					return path.endsWith('uv') || path.endsWith('uv.exe');
				}
			});

			// Set executable permissions for non-Windows platforms
			if (platform !== "win32") {
				const uvPath = path.join(binDir, "uv");
				if (fs.existsSync(uvPath)) {
					try {
						fs.chmodSync(uvPath, "755");
					} catch (error) {
						console.warn(
							`Warning: Failed to set executable permissions: ${error.message}`
						);
					}
				}
			}

			// Clean up
			fs.unlinkSync(tempFilename);
		}

		console.log(`Successfully installed uv ${version} for ${platform}-${arch}`);
		return true;
	} catch (error) {
		console.error(`Error installing uv for ${platformKey}: ${error.message}`);
		if (fs.existsSync(tempFilename)) {
			fs.unlinkSync(tempFilename);
		}

		// Check if binDir is empty and remove it if so
		try {
			const files = fs.readdirSync(binDir);
			if (files.length === 0) {
				fs.rmSync(binDir, { recursive: true });
				console.log(`Removed empty directory: ${binDir}`);
			}
		} catch (cleanupError) {
			console.warn(
				`Warning: Failed to clean up directory: ${cleanupError.message}`
			);
		}

		return false;
	}
}

/**
 * Detects current platform and architecture
 */
function detectPlatformAndArch() {
	const platform = os.platform();
	const arch = os.arch();
	const isMusl = platform === "linux" && detectIsMusl();

	return { platform, arch, isMusl };
}

/**
 * Attempts to detect if running on MUSL libc
 */
function detectIsMusl() {
	try {
		// Simple check for Alpine Linux which uses MUSL
		const output = execSync("cat /etc/os-release").toString();
		return output.toLowerCase().includes("alpine");
	} catch (error) {
		return false;
	}
}

/**
 * Main function to install uv
 */
async function installUv() {
	// Get the latest version if no specific version is provided
	const version = DEFAULT_UV_VERSION;
	console.log(`Using uv version: ${version}`);

	const { platform, arch, isMusl } = detectPlatformAndArch();

	console.log(
		`Installing uv ${version} for ${platform}-${arch}${
			isMusl ? " (MUSL)" : ""
		}...`
	);

	let isInstalled = await downloadUvBinary(
		UV_RELEASE_BASE_URL,
		platform,
		arch,
		version,
		isMusl
	);
	if (!isInstalled) {
		// Wait for the file lock handle to be released
		await new Promise(r => setTimeout(r, 200))
		console.log("Downloading uv from gitcode.com");
		isInstalled = await downloadUvBinary(
			"https://gitcode.com/CherryHQ/uv/releases/download",
			platform,
			arch,
			version,
			isMusl
		);
		console.log("Downloading uv from gitcode.com ####", isInstalled);
	}
}

// Run the installation
installUv()
	.then(() => {
		console.log("Installation successful");
		process.exit(0);
	})
	.catch((error) => {
		console.error("Installation failed:", error);
		process.exit(1);
	});
