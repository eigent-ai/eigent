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

import lottie from 'lottie-web';
import { useEffect } from 'react';
export function AnimationJson({
  animationData = '',
  onComplete,
}: {
  animationData: any;
  onComplete?: () => void;
}) {
  useEffect(() => {
    const animation = lottie.loadAnimation({
      container: document.getElementById('lottie-container')!,
      renderer: 'svg',
      loop: false,
      autoplay: true,
      animationData,
    });
    // listen to animation completion
    animation.addEventListener('complete', () => {
      console.log('animation completed');
      onComplete?.(); // call the callback passed in externally
    });

    return () => {
      animation.destroy(); // clean up resources
    };
  }, [animationData, onComplete]);

  return (
    <div
      id="lottie-container"
      className="fixed inset-0 z-[9999] h-full w-full bg-white-100%"
    ></div>
  );
}
