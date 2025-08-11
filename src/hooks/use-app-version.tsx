import { useEffect, useState } from "react";

export default function useAppVersion() {
	const [version, setVersion] = useState("");

	useEffect(() => {
		window?.ipcRenderer
			?.invoke("get-app-version")
			.then((v: string) => setVersion(v))
			.catch(() => setVersion("Unknown"));
	}, []);

	return version;
}
