const { notarize } = require("@electron/notarize");
require("dotenv").config();

exports.default = async function notarizing(context) {
	if (process.platform !== "darwin") {
		return;
	}
	const appOutDir = context.appOutDir;
	const appName = context.packager.appInfo.productName;
	console.log("appOutDir", appOutDir);
	console.log("process.env.APPLEID", process.env.APPLEID);
	console.log("process.env.APPLEIDPASS", process.env.APPLEIDPASS);
	console.log("process.env.APPLETEAMID", process.env.APPLETEAMID);
	return notarize({
		tool: "notarytool",
		teamId: process.env.APPLETEAMID,
		appBundleId: "com.eigent.app",
		appPath: `${appOutDir}/${appName}.app`,
		appleId: process.env.APPLEID,
		appleIdPassword: process.env.APPLEIDPASS,
		ascProvider: process.env.APPLETEAMID,
	})
		.then((res) => {
			console.log("success!");
		})
		.catch(console.log);
};
