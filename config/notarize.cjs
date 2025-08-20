const { notarize } = require("@electron/notarize");
require("dotenv").config();

exports.default = async function notarizing(context) {
	if (process.platform !== "darwin") {
		return;
	}
	const appOutDir = context.appOutDir;
	const appName = context.packager.appInfo.productName;
	console.log("appOutDir", appOutDir);
	console.log("process.env.APPLEID", process.env.APPLE_ID);
	console.log("process.env.APPLEIDPASS", process.env.APPLE_APP_SPECIFIC_PASSWORD);
	console.log("process.env.APPLETEAMID", process.env.APPLE_TEAM_ID);
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
