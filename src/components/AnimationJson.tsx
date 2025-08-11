import lottie from "lottie-web";
import { useEffect } from "react";
export function AnimationJson({
	animationData = "",
	onComplete,
}: {
	animationData: any;
	onComplete?: () => void;
}) {
	useEffect(() => {
		const animation = lottie.loadAnimation({
			container: document.getElementById("lottie-container")!,
			renderer: "svg",
			loop: false,
			autoplay: true,
			animationData,
		});
		// listen to animation completion
		animation.addEventListener("complete", () => {
			console.log("animation completed");
			onComplete?.(); // call the callback passed in externally
		});

		return () => {
			animation.destroy(); // clean up resources
		};
	}, []);

	return (
		<div
			id="lottie-container"
			className="fixed inset-0 h-full w-full z-[9999] bg-white-100%"
		></div>
	);
}
