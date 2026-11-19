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

import {
  BrowserWindow,
  WebContentsView,
  type IpcMainEvent,
  type NativeImage,
  type Rectangle,
  type WebContents,
} from 'electron';

interface Layer {
  id: number;
  bounds: Rectangle;
}
interface Subscription {
  contents: WebContents;
  pending: boolean;
  lastFrame: number;
  throttled: boolean;
}

/** Subscribe only to this window and the WebContentsViews it currently owns. */
export class WindowCompositor {
  private subscriptions = new Map<number, Subscription>();
  private timer: ReturnType<typeof setInterval>;
  private disposed = false;
  constructor(
    private source: BrowserWindow,
    private worker: BrowserWindow
  ) {
    this.sync();
    this.timer = setInterval(() => this.sync(), 100);
  }

  private sync() {
    if (this.disposed || this.source.isDestroyed() || this.worker.isDestroyed())
      return;
    for (const entry of this.subscriptions.values()) {
      if (entry.pending && Date.now() - entry.lastFrame > 12000) {
        this.worker.webContents.send('recording-worker-source-ended');
        this.dispose();
        return;
      }
    }
    const [width, height] = this.source.getContentSize();
    const layers: Layer[] = [
      { id: this.source.webContents.id, bounds: { x: 0, y: 0, width, height } },
    ];
    const contents = [this.source.webContents];
    for (const view of this.source.contentView.children) {
      if (
        !(view instanceof WebContentsView) ||
        view.webContents === this.source.webContents ||
        view.webContents.isDestroyed()
      )
        continue;
      const bounds = view.getBounds();
      if (
        bounds.width <= 0 ||
        bounds.height <= 0 ||
        bounds.x >= width ||
        bounds.y >= height ||
        bounds.x + bounds.width <= 0 ||
        bounds.y + bounds.height <= 0
      )
        continue;
      layers.push({ id: view.webContents.id, bounds });
      contents.push(view.webContents);
    }
    // No more than eight visible owned views. Fail rather than omit footage.
    if (contents.length > 8) {
      this.dispose();
      this.worker.webContents.send('recording-worker-source-ended');
      return;
    }
    this.worker.webContents.send('recording-worker-layout', {
      width,
      height,
      layers,
    });
    for (const entry of this.subscriptions.values()) {
      if (!contents.includes(entry.contents)) this.unsubscribe(entry);
    }
    for (const target of contents) {
      if (this.subscriptions.has(target.id)) continue;
      const entry: Subscription = {
        contents: target,
        pending: false,
        lastFrame: 0,
        throttled: target.getBackgroundThrottling(),
      };
      this.subscriptions.set(target.id, entry);
      target.setBackgroundThrottling(false);
      target.beginFrameSubscription(false, (image) => this.send(entry, image));
      void target
        .capturePage()
        .then((image) => this.send(entry, image))
        .catch(() => {});
    }
  }

  private send(entry: Subscription, image: NativeImage) {
    if (
      this.disposed ||
      entry.pending ||
      this.worker.isDestroyed() ||
      Date.now() - entry.lastFrame < 1000 / 24
    )
      return;
    const size = image.getSize();
    const scale = Math.min(1, 1920 / size.width, 1080 / size.height);
    const png = (
      scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
          })
        : image
    ).toPNG();
    if (png.length > 8 * 1024 * 1024) {
      this.worker.webContents.send('recording-worker-source-ended');
      return;
    }
    entry.pending = true;
    entry.lastFrame = Date.now();
    this.worker.webContents.send('recording-worker-frame', {
      id: entry.contents.id,
      bytes: png,
    });
  }

  acknowledge(event: IpcMainEvent, id: unknown) {
    if (
      this.worker.isDestroyed() ||
      event.sender !== this.worker.webContents ||
      event.senderFrame !== this.worker.webContents.mainFrame ||
      typeof id !== 'number'
    )
      return;
    const entry = this.subscriptions.get(id);
    if (entry) entry.pending = false;
  }

  private unsubscribe(entry: Subscription) {
    this.subscriptions.delete(entry.contents.id);
    if (!entry.contents.isDestroyed()) {
      entry.contents.endFrameSubscription();
      entry.contents.setBackgroundThrottling(entry.throttled);
    }
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    for (const entry of this.subscriptions.values()) this.unsubscribe(entry);
  }
}
