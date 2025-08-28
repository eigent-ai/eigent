const { notarize } = require("@electron/notarize");
require("dotenv").config();

exports.default = async function notarizing(context) {
	if (process.platform !== "darwin") {
		return;
	}
	const appOutDir = context.appOutDir;
	const appName = context.packager.appInfo.productName;
	console.log("appOutDir", appOutDir);
	
	// Validate required environment variables
	if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
		console.error("Missing required environment variables for notarization");
		console.error("Required: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID");
		throw new Error("Notarization failed: Missing required environment variables");
	}
	
	return notarize({
		tool: "notarytool",
		teamId: process.env.APPLE_TEAM_ID,
		appBundleId: "com.eigent.app",
		appPath: `${appOutDir}/${appName}.app`,
		appleId: process.env.APPLE_ID,
		appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
		ascProvider: process.env.APPLE_TEAM_ID,
	})
		.then((res) => {
			console.log("success!");
		})
		.catch(console.log);
};
