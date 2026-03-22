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
  createWorkflowWheelHandler,
  type WorkflowWheelHandlerOptions,
} from '@/components/WorkFlow/workflowWheelHandler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createWheelEvent(partial: Partial<WheelEvent> = {}): WheelEvent {
  return {
    deltaX: 0,
    deltaY: 0,
    ctrlKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...partial,
  } as unknown as WheelEvent;
}

describe('workflowWheelHandler', () => {
  let getViewport: ReturnType<typeof vi.fn>;
  let setViewport: ReturnType<typeof vi.fn>;
  let clampViewportX: ReturnType<typeof vi.fn>;
  let options: WorkflowWheelHandlerOptions;

  beforeEach(() => {
    getViewport = vi.fn().mockReturnValue({ x: 0, y: 0, zoom: 1 });
    setViewport = vi.fn();
    clampViewportX = vi.fn((x: number) => Math.max(-1000, Math.min(0, x)));
    options = {
      isEditMode: false,
      getViewport,
      setViewport,
      clampViewportX,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('horizontal scroll (deltaX) - Mac trackpad two-finger swipe', () => {
    it('should pan viewport when horizontal scroll (deltaX) is used', () => {
      const handler = createWorkflowWheelHandler(options);
      const e = createWheelEvent({ deltaX: 100, deltaY: 0 });

      handler(e);

      expect(e.preventDefault).toHaveBeenCalled();
      expect(clampViewportX).toHaveBeenCalledWith(-100);
      expect(setViewport).toHaveBeenCalledWith(
        { x: expect.any(Number), y: 0, zoom: 1 },
        { duration: 0 }
      );
    });

    it('should pan viewport left when deltaX is negative (swipe left)', () => {
      const handler = createWorkflowWheelHandler(options);
      const e = createWheelEvent({ deltaX: -80, deltaY: 0 });

      handler(e);

      expect(clampViewportX).toHaveBeenCalledWith(80);
      expect(setViewport).toHaveBeenCalled();
    });

    it('should use deltaX over deltaY when both are present (diagonal scroll)', () => {
      const handler = createWorkflowWheelHandler(options);
      const e = createWheelEvent({ deltaX: 50, deltaY: 30 });

      handler(e);

      // panDelta should be deltaX (50), so nextX = 0 - 50 = -50
      expect(clampViewportX).toHaveBeenCalledWith(-50);
    });
  });

  describe('vertical scroll (deltaY) - mouse wheel or trackpad vertical swipe', () => {
    it('should pan viewport when vertical scroll (deltaY) is used (carousel style)', () => {
      const handler = createWorkflowWheelHandler(options);
      const e = createWheelEvent({ deltaX: 0, deltaY: 50 });

      handler(e);

      expect(e.preventDefault).toHaveBeenCalled();
      expect(clampViewportX).toHaveBeenCalledWith(-50);
      expect(setViewport).toHaveBeenCalledWith(
        { x: expect.any(Number), y: 0, zoom: 1 },
        { duration: 0 }
      );
    });

    it('should pan correctly when scroll down (positive deltaY)', () => {
      const handler = createWorkflowWheelHandler(options);
      getViewport.mockReturnValue({ x: -200, y: 0, zoom: 1 });
      const e = createWheelEvent({ deltaX: 0, deltaY: 100 });

      handler(e);

      // nextX = -200 - 100 = -300, clamped
      expect(clampViewportX).toHaveBeenCalledWith(-300);
    });

    it('should pan correctly when scroll up (negative deltaY)', () => {
      const handler = createWorkflowWheelHandler(options);
      getViewport.mockReturnValue({ x: -500, y: 0, zoom: 1 });
      const e = createWheelEvent({ deltaX: 0, deltaY: -80 });

      handler(e);

      // nextX = -500 - (-80) = -420
      expect(clampViewportX).toHaveBeenCalledWith(-420);
    });
  });

  describe('pinch-to-zoom (ctrlKey) - Mac trackpad pinch gesture', () => {
    it('should preventDefault and not pan when ctrlKey is true (pinch zoom)', () => {
      const handler = createWorkflowWheelHandler(options);
      const e = createWheelEvent({ deltaX: 0, deltaY: 50, ctrlKey: true });

      handler(e);

      expect(e.preventDefault).toHaveBeenCalled();
      expect(setViewport).not.toHaveBeenCalled();
      expect(clampViewportX).not.toHaveBeenCalled();
    });

    it('should preventDefault on pinch even with deltaX (gesture misinterpretation)', () => {
      const handler = createWorkflowWheelHandler(options);
      const e = createWheelEvent({ deltaX: 100, deltaY: 0, ctrlKey: true });

      handler(e);

      expect(e.preventDefault).toHaveBeenCalled();
      expect(setViewport).not.toHaveBeenCalled();
    });
  });

  describe('edit mode', () => {
    it('should not handle wheel events when isEditMode is true', () => {
      const handler = createWorkflowWheelHandler({
        ...options,
        isEditMode: true,
      });
      const e = createWheelEvent({ deltaX: 100, deltaY: 0 });

      handler(e);

      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(setViewport).not.toHaveBeenCalled();
      expect(clampViewportX).not.toHaveBeenCalled();
    });

    it('should not handle pinch (ctrlKey) when isEditMode is true - lets React Flow handle it', () => {
      const handler = createWorkflowWheelHandler({
        ...options,
        isEditMode: true,
      });
      const e = createWheelEvent({ deltaX: 0, deltaY: 50, ctrlKey: true });

      handler(e);

      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(setViewport).not.toHaveBeenCalled();
    });
  });

  describe('no scroll delta', () => {
    it('should not handle when both deltaX and deltaY are zero', () => {
      const handler = createWorkflowWheelHandler(options);
      const e = createWheelEvent({ deltaX: 0, deltaY: 0 });

      handler(e);

      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(setViewport).not.toHaveBeenCalled();
      expect(clampViewportX).not.toHaveBeenCalled();
    });
  });

  describe('clampViewportX', () => {
    it('should pass clamped viewport to setViewport', () => {
      clampViewportX.mockReturnValue(-150);
      const handler = createWorkflowWheelHandler(options);
      const e = createWheelEvent({ deltaX: 200, deltaY: 0 });

      handler(e);

      expect(clampViewportX).toHaveBeenCalledWith(-200);
      expect(setViewport).toHaveBeenCalledWith(
        { x: -150, y: 0, zoom: 1 },
        { duration: 0 }
      );
    });

    it('should preserve existing viewport y and zoom', () => {
      getViewport.mockReturnValue({ x: -100, y: 50, zoom: 0.8 });
      clampViewportX.mockReturnValue(-180);
      const handler = createWorkflowWheelHandler(options);
      const e = createWheelEvent({ deltaX: 80, deltaY: 0 });

      handler(e);

      expect(setViewport).toHaveBeenCalledWith(
        { x: -180, y: 50, zoom: 0.8 },
        { duration: 0 }
      );
    });
  });
});
