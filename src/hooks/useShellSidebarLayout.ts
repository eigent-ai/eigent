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

import { PROJECT_SIDEBAR_RAIL_WIDTH_PX } from '@/components/PageSidebar/constants';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
} from 'react-resizable-panels';

const SIDEBAR_MIN_PX = 240;
const SIDEBAR_MAX_PX = 400;
const DEFAULT_SIDEBAR_WIDTH_PX = 288;

function clampPct(n: number): number {
  return Math.min(100, Math.max(1, n));
}

function readStoredSidebarWidthPx(storageKey: string): number {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH_PX;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw == null) return DEFAULT_SIDEBAR_WIDTH_PX;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return DEFAULT_SIDEBAR_WIDTH_PX;
    return Math.min(SIDEBAR_MAX_PX, Math.max(SIDEBAR_MIN_PX, n));
  } catch {
    return DEFAULT_SIDEBAR_WIDTH_PX;
  }
}

export function useShellSidebarLayout(sidebarWidthStorageKey: string) {
  const projectSidebarFolded = usePageTabStore((s) => s.projectSidebarFolded);
  const setProjectSidebarFolded = usePageTabStore(
    (s) => s.setProjectSidebarFolded
  );

  const shellPanelGroupRef = useRef<HTMLDivElement>(null);
  const shellWidthRef = useRef(0);
  const shellPanelGroupImperativeRef = useRef<ImperativePanelGroupHandle>(null);
  const projectSidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const applyingSidebarLayoutRef = useRef(false);
  const sidebarLayoutAnimationFrameRef = useRef<number | null>(null);
  const hasInitializedSidebarLayoutRef = useRef(false);
  const sidebarWidthPxRef = useRef(
    readStoredSidebarWidthPx(sidebarWidthStorageKey)
  );
  const persistSidebarWidthTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [sidebarPct, setSidebarPct] = useState({
    min: 18,
    max: 35,
    rail: 4,
  });

  const mainPanelPct = useMemo(() => {
    const min = Math.max(1, 100 - sidebarPct.max);
    const max = Math.max(min, Math.min(99, 100 - sidebarPct.min));
    return { min, max };
  }, [sidebarPct.min, sidebarPct.max]);

  const mainPanelMaxSize = useMemo(() => {
    if (projectSidebarFolded) {
      return Math.min(99, 100 - sidebarPct.rail);
    }
    return mainPanelPct.max;
  }, [projectSidebarFolded, sidebarPct.rail, mainPanelPct.max]);

  const schedulePersistSidebarWidth = useCallback(
    (px: number) => {
      if (persistSidebarWidthTimeoutRef.current) {
        clearTimeout(persistSidebarWidthTimeoutRef.current);
      }
      persistSidebarWidthTimeoutRef.current = setTimeout(() => {
        persistSidebarWidthTimeoutRef.current = null;
        try {
          window.localStorage.setItem(
            sidebarWidthStorageKey,
            String(Math.round(px))
          );
        } catch {
          /* ignore */
        }
      }, 250);
    },
    [sidebarWidthStorageKey]
  );

  const setShellPanelLayout = useCallback(
    (layout: number[], animate: boolean) => {
      const group = shellPanelGroupImperativeRef.current;
      if (!group) return;

      const target = layout.map(clampPct);

      if (sidebarLayoutAnimationFrameRef.current != null) {
        cancelAnimationFrame(sidebarLayoutAnimationFrameRef.current);
        sidebarLayoutAnimationFrameRef.current = null;
      }

      const applyFinalLayout = () => {
        group.setLayout(target);
        requestAnimationFrame(() => {
          applyingSidebarLayoutRef.current = false;
        });
      };

      const current = group.getLayout();
      const shouldAnimate =
        animate &&
        current.length === target.length &&
        current.some((value, index) => Math.abs(value - target[index]) > 0.1);

      applyingSidebarLayoutRef.current = true;

      if (!shouldAnimate) {
        applyFinalLayout();
        return;
      }

      const from = [...current];
      const durationMs = 260;
      const start = performance.now();

      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        group.setLayout(
          from.map((value, index) => value + (target[index] - value) * eased)
        );

        if (progress < 1) {
          sidebarLayoutAnimationFrameRef.current = requestAnimationFrame(tick);
          return;
        }

        sidebarLayoutAnimationFrameRef.current = null;
        applyFinalLayout();
      };

      sidebarLayoutAnimationFrameRef.current = requestAnimationFrame(tick);
    },
    []
  );

  const applyExpandedSidebarLayout = useCallback(
    (animate: boolean = false) => {
      const shell = shellPanelGroupRef.current;
      if (!shell) return;
      if (usePageTabStore.getState().projectSidebarFolded) return;
      const w = shell.getBoundingClientRect().width;
      if (w <= 0) return;
      const minPct = clampPct((SIDEBAR_MIN_PX / w) * 100);
      const maxPct = clampPct((SIDEBAR_MAX_PX / w) * 100);
      const px = Math.min(
        SIDEBAR_MAX_PX,
        Math.max(SIDEBAR_MIN_PX, sidebarWidthPxRef.current)
      );
      let pct = (px / w) * 100;
      pct = Math.min(maxPct, Math.max(minPct, pct));
      setShellPanelLayout([pct, 100 - pct], animate);
    },
    [setShellPanelLayout]
  );

  const handleShellPanelLayout = useCallback(
    (sizes: number[]) => {
      if (applyingSidebarLayoutRef.current) return;
      const shell = shellPanelGroupRef.current;
      if (!shell) return;
      const shellW = shell.getBoundingClientRect().width;
      if (shellW <= 0) return;

      const sidebarPx = (sizes[0] / 100) * shellW;
      const folded = usePageTabStore.getState().projectSidebarFolded;

      if (!folded && sidebarPx < SIDEBAR_MIN_PX - 0.5) {
        applyingSidebarLayoutRef.current = true;
        setProjectSidebarFolded(true);
        const rail = clampPct((PROJECT_SIDEBAR_RAIL_WIDTH_PX / shellW) * 100);
        const main = Math.min(99, Math.max(0, 100 - rail));
        shellPanelGroupImperativeRef.current?.setLayout([rail, main]);
        requestAnimationFrame(() => {
          applyingSidebarLayoutRef.current = false;
        });
        return;
      }

      if (folded && sidebarPx > PROJECT_SIDEBAR_RAIL_WIDTH_PX + 1.5) {
        applyingSidebarLayoutRef.current = true;
        setProjectSidebarFolded(false);
        requestAnimationFrame(() => {
          applyingSidebarLayoutRef.current = false;
        });
        return;
      }

      if (!folded) {
        sidebarWidthPxRef.current = Math.min(
          SIDEBAR_MAX_PX,
          Math.max(SIDEBAR_MIN_PX, sidebarPx)
        );
        schedulePersistSidebarWidth(sidebarWidthPxRef.current);
      }
    },
    [schedulePersistSidebarWidth, setProjectSidebarFolded]
  );

  useLayoutEffect(() => {
    if (projectSidebarFolded) return;
    applyExpandedSidebarLayout(hasInitializedSidebarLayoutRef.current);
    hasInitializedSidebarLayoutRef.current = true;
  }, [projectSidebarFolded, applyExpandedSidebarLayout]);

  useLayoutEffect(() => {
    if (!projectSidebarFolded) return;
    const rail = sidebarPct.rail;
    const main = Math.min(99, Math.max(0, 100 - rail));
    setShellPanelLayout(
      [rail, main],
      hasInitializedSidebarLayoutRef.current && sidebarWidthPxRef.current > 0
    );
    hasInitializedSidebarLayoutRef.current = true;
  }, [projectSidebarFolded, sidebarPct.rail, setShellPanelLayout]);

  useEffect(() => {
    const el = shellPanelGroupRef.current;
    if (!el) return;

    const update = () => {
      const w = el.getBoundingClientRect().width;
      if (w <= 0) return;
      const prevW = shellWidthRef.current;
      shellWidthRef.current = w;
      const minPct = clampPct((SIDEBAR_MIN_PX / w) * 100);
      const maxPct = clampPct((SIDEBAR_MAX_PX / w) * 100);
      const railPct = clampPct((PROJECT_SIDEBAR_RAIL_WIDTH_PX / w) * 100);
      setSidebarPct({
        min: minPct,
        max: Math.max(minPct, maxPct),
        rail: railPct,
      });

      if (
        !usePageTabStore.getState().projectSidebarFolded &&
        prevW > 0 &&
        Math.abs(w - prevW) > 0.5
      ) {
        applyExpandedSidebarLayout();
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyExpandedSidebarLayout]);

  useEffect(() => {
    return () => {
      if (sidebarLayoutAnimationFrameRef.current != null) {
        cancelAnimationFrame(sidebarLayoutAnimationFrameRef.current);
      }
      if (persistSidebarWidthTimeoutRef.current) {
        clearTimeout(persistSidebarWidthTimeoutRef.current);
      }
    };
  }, []);

  return {
    shellPanelGroupRef,
    shellPanelGroupImperativeRef,
    projectSidebarPanelRef,
    sidebarPct,
    mainPanelPct,
    mainPanelMaxSize,
    handleShellPanelLayout,
  };
}
