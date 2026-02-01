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

import { CardContent } from '@/components/ui/card';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from '@/components/ui/carousel';
import { useAuthStore } from '@/store/authStore';
import React, { useEffect, useRef, useState } from 'react';

import addWorkerVideo from '@/assets/add_worker.mp4';
import dynamicWorkforceVideo from '@/assets/dynamic_workforce.mp4';
import localModelVideo from '@/assets/local_model.mp4';

export const CarouselStep: React.FC = () => {
  const { setInitState: _setInitState } = useAuthStore();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [_isHovered, setIsHovered] = useState(false);
  const [api, setApi] = useState<any>(null);
  const [isDismissed, _setIsDismissed] = useState(false);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  // listen to carousel change
  useEffect(() => {
    if (!api) return;

    const onSelect = () => {
      setCurrentSlide(api.selectedScrollSnap());
    };

    api.on('select', onSelect);
    return () => {
      api.off('select', onSelect);
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
      title: '“Dynamic Workforce break it down, get task done”',
      video: dynamicWorkforceVideo,
    },
    {
      title: '“Add worker with pluggable mcp”',
      video: addWorkerVideo,
    },
    {
      title: '“private and secure with local model settings”',
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
          console.warn('video.play() error:', err);
        });
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
  }, [currentSlide, api]);

  // If carousel is dismissed, don't show anything
  // The actual transition to 'done' will be handled by useInstallationSetup
  // when both installation and backend are ready
  if (isDismissed) {
    return null;
  }

  return (
    <div className="flex w-[1120px] flex-col gap-lg max-lg:w-[100%]">
      <div className="flex flex-col gap-md">
        <div className="text-4xl font-bold leading-5xl text-text-heading">
          {carouselItems[currentSlide].title}
        </div>

        <Carousel
          className="scrollbar max-h-[490px] min-h-[400px] rounded-3xl bg-white-100% p-0 short:max-h-[300px] short:overflow-y-auto"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          setApi={setApi}
        >
          <CarouselContent className="h-full">
            {carouselItems.map((_, index) => (
              <CarouselItem key={index} className="h-full">
                <div className="h-full p-0">
                  <CardContent className="h-full w-full items-center justify-center p-0">
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
                      className="h-full w-full rounded-3xl object-contain"
                    />
                  </CardContent>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>
      <div className="flex items-center justify-center gap-sm">
        <div className="flex items-center justify-center gap-6">
          {carouselItems.map((item, index) => (
            <div
              key={index}
              onMouseEnter={() => handleIndicatorHover(index)}
              className={`h-1.5 w-[120px] cursor-pointer rounded-full transition-all duration-300 ${
                index === currentSlide
                  ? 'bg-fill-fill-secondary'
                  : 'bg-white-100% hover:bg-fill-fill-secondary'
              }`}
            ></div>
          ))}
        </div>
      </div>
    </div>
  );
};
