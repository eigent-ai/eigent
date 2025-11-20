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
		console.warn("Missing Apple environment variables for notarization");
		console.warn("Skipping notarization. Required: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID");
		return;
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
