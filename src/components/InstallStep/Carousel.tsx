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

import addWorkerVideo from '@/assets/add_worker.mp4';
import dynamicWorkforceVideo from '@/assets/dynamic_workforce.mp4';
import localModelVideo from '@/assets/local_model.mp4';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from '@/components/ui/carousel';
import { useAuthStore } from '@/store/authStore';
import { Pause, Play } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

export const CarouselStep: React.FC = () => {
  const { setInitState: _setInitState } = useAuthStore();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [_isHovered, setIsHovered] = useState(false);
  const [api, setApi] = useState<any>(null);
  const [isDismissed, _setIsDismissed] = useState(false);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [isPaused, setIsPaused] = useState(false);
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

    api.on('select', onSelect);
    return () => {
      api.off('select', onSelect);
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
          console.warn('video.play() error:', err);
        });
      }
    }
  };

  const carouselItems = [
    {
      title: 'Dynamic Workforce break it down, get task done',
      video: dynamicWorkforceVideo,
    },
    {
      title: 'Add worker with pluggable MCP',
      video: addWorkerVideo,
    },
    {
      title: 'Private and secure with local model settings',
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
            console.warn('video.play() error:', err);
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
          video.removeEventListener('loadedmetadata', handler);
        };
        video.addEventListener('loadedmetadata', handler);
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
    <div className="flex h-full w-full flex-col">
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="mb-md text-heading-sm font-bold text-text-heading">
          {carouselItems[currentSlide].title}
        </div>

        <Carousel
          className="min-h-0 flex-1 bg-transparent"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          setApi={setApi}
        >
          <CarouselContent className="h-full">
            {carouselItems.map((_, index) => (
              <CarouselItem key={index} className="h-full">
                <div className="h-full w-full p-0">
                  <CardContent className="flex h-full w-full items-center justify-center p-0">
                    <div
                      key={
                        index === currentSlide
                          ? `slide-active-${currentSlide}`
                          : `slide-${index}`
                      }
                      className={`h-full w-full ${
                        index === currentSlide ? 'animate-fade-in' : ''
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
                        className="h-full w-full rounded-3xl object-contain"
                      />
                    </div>
                  </CardContent>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>
      <div className="relative mt-2 flex items-center justify-center gap-sm">
        <div className="flex items-center justify-center gap-6">
          {carouselItems.map((item, index) => (
            <div
              key={index}
              onMouseEnter={() => handleIndicatorHover(index)}
              className={`h-1 w-32 cursor-pointer rounded-full transition-all duration-300 ${
                index === currentSlide
                  ? 'bg-fill-fill-secondary'
                  : 'bg-fill-fill-tertiary hover:bg-fill-fill-secondary'
              }`}
            ></div>
          ))}
        </div>
        <Button
          onClick={handleTogglePause}
          variant="ghost"
          size="icon"
          className="absolute bottom-0 right-0 rounded-full"
          aria-label={isPaused ? 'Resume' : 'Pause'}
        >
          {isPaused ? (
            <Play className="h-4 w-4" />
          ) : (
            <Pause className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
};
