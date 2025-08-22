import React, { useState, useEffect, useRef } from "react";
import { useAuthStore } from "@/store/authStore";
import { Button } from "../ui/button";
import { ArrowRight } from "lucide-react";
import Autoplay from "embla-carousel-autoplay";
import { CardContent } from "@/components/ui/card";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
} from "@/components/ui/carousel";

import addWorkerVideo from "@/assets/add_worker.mp4";
import dynamicWorkforceVideo from "@/assets/dynamic_workforce.mp4";
import localModelVideo from "@/assets/local_model.mp4";

export const CarouselStep: React.FC = () => {
	const { setInitState } = useAuthStore();
	const [currentSlide, setCurrentSlide] = useState(0);
	const [isHovered, setIsHovered] = useState(false);
	const [api, setApi] = useState<any>(null);
	const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
	// listen to carousel change
	useEffect(() => {
		if (!api) return;

		const onSelect = () => {
			setCurrentSlide(api.selectedScrollSnap());
		};

		api.on("select", onSelect);
		return () => {
			api.off("select", onSelect);
		};
	}, [api]);

	// click indicator to jump to corresponding slide
	const scrollTo = (index: number) => {
		if (api) {
			api.scrollTo(index);
		}
	};

	// mouse hover control
	const handleMouseEnter = () => {
		setIsHovered(true);
	};

	const handleMouseLeave = () => {
		setIsHovered(false);
	};

	const handleIndicatorHover = (index: number) => {
		scrollTo(index);
	};
	const carouselItems = [
		{
			title: "“Dynamic Workforce break it down, get task done”",
			video: dynamicWorkforceVideo,
		},
		{
			title: "“Add worker with pluggable mcp”",
			video: addWorkerVideo,
		},
		{
			title: "“private and secure with local model settings”",
			video: localModelVideo,
		},
	];

	useEffect(() => {
		if (!api) return;

		const video = videoRefs.current[currentSlide];
		if (video) {
			const tryPlay = () => {
				video.currentTime = 0;
				video.play().catch((err) => {
					console.warn("video.play() error:", err);
				});
			};

			if (video.readyState >= 1) {
				// metadata already loaded
				tryPlay();
			} else {
				// wait for metadata to load before playing
				const handler = () => {
					tryPlay();
					video.removeEventListener("loadedmetadata", handler);
				};
				video.addEventListener("loadedmetadata", handler);
			}
		}
	}, [currentSlide, api]);
	return (
		<div className="flex flex-col gap-lg w-[1120px] max-lg:w-[100%]">
			<div className="flex flex-col gap-md  ">
				<div className="text-text-heading font-bold text-4xl leading-5xl">
					{carouselItems[currentSlide].title}
				</div>

				<Carousel
					className="min-h-[400px] max-h-[490px] bg-white-100% rounded-3xl p-0 short:max-h-[300px] short:overflow-y-auto scrollbar"
					onMouseEnter={handleMouseEnter}
					onMouseLeave={handleMouseLeave}
					setApi={setApi}
				>
					<CarouselContent className="h-full">
						{carouselItems.map((_, index) => (
							<CarouselItem key={index} className="h-full">
								<div className="p-0 h-full">
									<CardContent className="w-full h-full items-center justify-center p-0">
										<video
											ref={(el) => (videoRefs.current[index] = el)}
											src={carouselItems[index].video}
											muted
											playsInline
											preload="auto"
											onEnded={() => {
												if (api) {
													const currentIndex = api.selectedScrollSnap();
													if (currentIndex < carouselItems.length - 1) {
														api.scrollNext();
													} else {
														api.scrollTo(0);
													}
												}
											}}
											className="rounded-3xl w-full h-full object-contain"
										/>
									</CardContent>
								</div>
							</CarouselItem>
						))}
					</CarouselContent>
				</Carousel>
			</div>
			<div className="flex justify-between items-center gap-sm">
				<div className="flex justify-center items-center gap-6">
					{carouselItems.map((item, index) => (
						<div
							key={index}
							onMouseEnter={() => handleIndicatorHover(index)}
							className={`w-[120px] h-1.5 rounded-full cursor-pointer transition-all duration-300 ${
								index === currentSlide
									? "bg-fill-fill-secondary"
									: "bg-white-100% hover:bg-fill-fill-secondary"
							}`}
						></div>
					))}
				</div>
				<div className="flex justify-center items-center gap-sm">
					<Button
						onClick={() => setInitState("done")}
						variant="ghost"
						size="sm"
					>
						skip
					</Button>
					<Button
						onClick={() => {
							if (currentSlide < carouselItems.length - 1) {
								api?.scrollNext(); // not last page, switch to next page
							} else {
								setInitState("done"); // last page, execute done logic
							}
						}}
						variant="primary"
						size="sm"
					>
						<div>Next</div>
						<ArrowRight size={24} className="text-white-100%" />
					</Button>
				</div>
			</div>
		</div>
	);
};
