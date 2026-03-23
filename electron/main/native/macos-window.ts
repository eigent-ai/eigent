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

import { BrowserWindow } from 'electron';
import log from 'electron-log';
import koffi from 'koffi';
import os from 'os';

type SetRoundedCorners = (window: BrowserWindow, radius?: number) => void;

let setRoundedCorners: SetRoundedCorners = () => {};

if (os.platform() === 'darwin') {
  try {
    const objc = koffi.load('libobjc.A.dylib');

    const Ptr = 'size_t';

    const sel_registerName = objc.func('sel_registerName', Ptr, ['string']);
    const objc_msgSend = objc.func('objc_msgSend', Ptr, [Ptr, Ptr]);
    const objc_msgSend_bool = objc.func('objc_msgSend', Ptr, [
      Ptr,
      Ptr,
      'bool',
    ]);
    const objc_msgSend_double = objc.func('objc_msgSend', Ptr, [
      Ptr,
      Ptr,
      'double',
    ]);

    setRoundedCorners = (window: BrowserWindow, radius = 20) => {
      try {
        const windowHandle = window.getNativeWindowHandle();
        if (!windowHandle?.length) return;

        const nsViewPtr = windowHandle.readBigUInt64LE();
        if (!nsViewPtr) return;

        const selLayer = sel_registerName('layer');
        const selSetWantsLayer = sel_registerName('setWantsLayer:');
        const selSetCornerRadius = sel_registerName('setCornerRadius:');
        const selSetMasksToBounds = sel_registerName('setMasksToBounds:');

        objc_msgSend_bool(nsViewPtr, selSetWantsLayer, true);

        const nsLayer = objc_msgSend(nsViewPtr, selLayer);
        if (!nsLayer) {
          log.error('[MacOS] Failed to get layer for rounded corners');
          return;
        }

        objc_msgSend_double(nsLayer, selSetCornerRadius, radius);
        objc_msgSend_bool(nsLayer, selSetMasksToBounds, true);
      } catch (error) {
        log.error('[MacOS] Error applying rounded corners:', error);
      }
    };
  } catch (e) {
    log.error(
      '[MacOS] Failed to load native libraries for rounded corners:',
      e
    );
  }
}

export { setRoundedCorners };
