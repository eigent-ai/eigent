// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import React, { useState, useEffect, useRef } from "react";
import { useAuthStore } from "@/store/authStore";
import { CardContent } from "@/components/ui/card";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
} from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { Pause, Play } from "lucide-react";

import addWorkerVideo from "@/assets/add_worker.mp4";
import dynamicWorkforceVideo from "@/assets/dynamic_workforce.mp4";
import localModelVideo from "@/assets/local_model.mp4";

export const CarouselStep: React.FC = () => {
	const { setInitState } = useAuthStore();
	const [currentSlide, setCurrentSlide] = useState(0);
	const [isHovered, setIsHovered] = useState(false);
	const [api, setApi] = useState<any>(null);
	const [isDismissed, setIsDismissed] = useState(false);
	const [isPaused, setIsPaused] = useState(false);
	const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
	const videoEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	// listen to carousel change
	useEffect(() => {
		if (!api) return;

		const onSelect = () => {
			// Clear any pending video end timeout when slide changes manually
			if (videoEndTimeoutRef.current) {
				clearTimeout(videoEndTimeoutRef.current);
				videoEndTimeoutRef.current = null;
			}
			setCurrentSlide(api.selectedScrollSnap());
		};

		api.on("select", onSelect);
		return () => {
			api.off("select", onSelect);
		};
	}, [api]);

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (videoEndTimeoutRef.current) {
				clearTimeout(videoEndTimeoutRef.current);
			}
		};
	}, []);

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

	const handleTogglePause = () => {
		const newPausedState = !isPaused;
		setIsPaused(newPausedState);

		const currentVideo = videoRefs.current[currentSlide];
		if (currentVideo) {
			if (newPausedState) {
				currentVideo.pause();
			} else {
				currentVideo.play().catch((err) => {
					console.warn("video.play() error:", err);
				});
			}
		}
	};
	const carouselItems = [
		{
			title: "Dynamic Workforce break it down, get task done",
			video: dynamicWorkforceVideo,
		},
		{
			title: "Add worker with pluggable MCP",
			video: addWorkerVideo,
		},
		{
			title: "Private and secure with local model settings",
			video: localModelVideo,
		},
	];

	useEffect(() => {
		if (!api) return;

		const video = videoRefs.current[currentSlide];
		if (video) {
			const tryPlay = () => {
				video.currentTime = 0;
				if (!isPaused) {
					video.play().catch((err) => {
						console.warn("video.play() error:", err);
					});
				}
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
	}, [currentSlide, api, isPaused]);

	// If carousel is dismissed, don't show anything
	// The actual transition to 'done' will be handled by useInstallationSetup
	// when both installation and backend are ready
	if (isDismissed) {
		return null;
	}

	return (
		<div className="flex flex-col w-full h-full">
			<div className="flex flex-col w-full h-full min-h-0">
				<div className="text-text-heading font-bold text-heading-sm mb-md">
					{carouselItems[currentSlide].title}
				</div>

				<Carousel
					className="flex-1 bg-transparent min-h-0"
					onMouseEnter={handleMouseEnter}
					onMouseLeave={handleMouseLeave}
					setApi={setApi}
				>
					<CarouselContent className="h-full">
						{carouselItems.map((_, index) => (
							<CarouselItem key={index} className="h-full">
								<div className="p-0 h-full w-full">
									<CardContent className="w-full h-full items-center justify-center p-0 flex">
										<div
											key={index === currentSlide ? `slide-active-${currentSlide}` : `slide-${index}`}
											className={`w-full h-full ${
												index === currentSlide ? "animate-fade-in" : ""
											}`}
										>
											<video
												ref={(el) => (videoRefs.current[index] = el)}
												src={carouselItems[index].video}
												muted
												playsInline
												preload="auto"
												onEnded={() => {
													if (api && !isPaused) {
														// Clear any existing timeout
														if (videoEndTimeoutRef.current) {
															clearTimeout(videoEndTimeoutRef.current);
														}
														// Wait 2 seconds before moving to next video
														videoEndTimeoutRef.current = setTimeout(() => {
															const currentIndex = api.selectedScrollSnap();
															if (currentIndex < carouselItems.length - 1) {
																api.scrollNext();
															} else {
																api.scrollTo(0);
															}
															videoEndTimeoutRef.current = null;
														}, 500);
													}
												}}
												className="rounded-3xl w-full h-full object-contain"
											/>
										</div>
									</CardContent>
								</div>
							</CarouselItem>
						))}
					</CarouselContent>
				</Carousel>
			</div>
			<div className="flex justify-center items-center gap-sm mt-2 relative">
				<div className="flex justify-center items-center gap-6">
					{carouselItems.map((item, index) => (
						<div
							key={index}
							onMouseEnter={() => handleIndicatorHover(index)}
							className={`w-32 h-1 rounded-full cursor-pointer transition-all duration-300 ${
								index === currentSlide
									? "bg-fill-fill-secondary"
									: "bg-fill-fill-tertiary hover:bg-fill-fill-secondary"
							}`}
						></div>
					))}
				</div>
				<Button
					onClick={handleTogglePause}
					variant="ghost"
					size="icon"
					className="absolute right-0 bottom-0 rounded-full"
					aria-label={isPaused ? "Resume" : "Pause"}
				>
					{isPaused ? (
						<Play className="w-4 h-4" />
					) : (
						<Pause className="w-4 h-4" />
					)}
				</Button>
			</div>
		</div>
	);
};
