import { BrowserWindow } from 'electron';
import koffi from 'koffi';
import os from 'os';

// NSVisualEffectView material constants (enum values)
export const NSVisualEffectMaterial = {
    Titlebar: 3,
    Selection: 4,
    Menu: 5,
    Popover: 6,
    Sidebar: 7,
    HeaderView: 10,
    Sheet: 11,
    WindowBackground: 12,
    HUDWindow: 13,
    FullScreenUI: 15,
    ToolTip: 17,
    ContentBackground: 18,
    UnderWindowBackground: 21,
    UnderPageBackground: 22
} as const;

export type MaterialType = keyof typeof NSVisualEffectMaterial;

// Interface for our module functions
interface MacWindowUtils {
    setVibrancy: (window: BrowserWindow, material?: MaterialType) => void;
    setRoundedCorners: (window: BrowserWindow, radius?: number) => void;
    setTransparentTitlebar: (window: BrowserWindow) => void;
}

let utils: MacWindowUtils;

if (os.platform() === 'darwin') {
    try {
        const objc = koffi.load('libobjc.A.dylib');

        // Types
        const Ptr = 'size_t';

        const objc_getClass = objc.func('objc_getClass', Ptr, ['string']);
        const sel_registerName = objc.func('sel_registerName', Ptr, ['string']);
        const objc_msgSend = objc.func('objc_msgSend', Ptr, [Ptr, Ptr]);
        const objc_msgSend_long = objc.func('objc_msgSend', Ptr, [Ptr, Ptr, 'long']);
        const objc_msgSend_double = objc.func('objc_msgSend', Ptr, [Ptr, Ptr, 'double']);
        const objc_msgSend_bool = objc.func('objc_msgSend', Ptr, [Ptr, Ptr, 'bool']);

        const NSRect = koffi.struct('NSRect', {
            x: 'double',
            y: 'double',
            width: 'double',
            height: 'double'
        });

        const NSVisualEffectBlendingMode = {
            BehindWindow: 0,
            WithinWindow: 1
        };

        utils = {
            setVibrancy: (window: BrowserWindow, material: MaterialType = 'HUDWindow') => {
                try {
                    const windowHandle = window.getNativeWindowHandle();
                    if (windowHandle.length === 0) return;

                    // Electron calls valid native handle returns the NSView (BridgedContentView) on macOS
                    const nsViewPtr = windowHandle.readBigUInt64LE();
                    if (!nsViewPtr) return;

                    // Selectors
                    const selAlloc = sel_registerName('alloc');
                    const selInit = sel_registerName('init');
                    const selSetMaterial = sel_registerName('setMaterial:');
                    const selSetBlendingMode = sel_registerName('setBlendingMode:');
                    const selSetState = sel_registerName('setState:');
                    const selSetAutoresizingMask = sel_registerName('setAutoresizingMask:');
                    const selSetFrame = sel_registerName('setFrame:');
                    const selAddSubview = sel_registerName('addSubview:positioned:relativeTo:');

                    const NSVisualEffectViewClass = objc_getClass('NSVisualEffectView');
                    if (!NSVisualEffectViewClass) return;

                    // Allocation
                    const visualEffectView = objc_msgSend(NSVisualEffectViewClass, selAlloc);
                    objc_msgSend(visualEffectView, selInit);

                    const materialValue = NSVisualEffectMaterial[material] || NSVisualEffectMaterial.HUDWindow;

                    // Configuration
                    objc_msgSend_long(visualEffectView, selSetMaterial, materialValue);
                    objc_msgSend_long(visualEffectView, selSetBlendingMode, NSVisualEffectBlendingMode.BehindWindow);
                    objc_msgSend_long(visualEffectView, selSetState, 1);
                    objc_msgSend_long(visualEffectView, selSetAutoresizingMask, 18);

                    // Frame
                    const bounds = window.getBounds();
                    const viewFrame = { x: 0, y: 0, width: bounds.width, height: bounds.height };

                    const objc_msgSend_frame = objc.func('objc_msgSend', 'void', [Ptr, Ptr, NSRect]);
                    objc_msgSend_frame(visualEffectView, selSetFrame, viewFrame);

                    // Add Subview to the CONTENT VIEW (which we already have as nsViewPtr)
                    const objc_msgSend_positioned = objc.func('objc_msgSend', 'void', [Ptr, Ptr, Ptr, 'long', Ptr]);
                    objc_msgSend_positioned(nsViewPtr, selAddSubview, visualEffectView, -1, 0); // -1 = NSWindowBelow

                    console.log(`[MacOS] Vibrancy applied successfully`);
                } catch (error) {
                    console.error('[MacOS] Error applying vibrancy:', error);
                }
            },

            setRoundedCorners: (window: BrowserWindow, radius = 20) => {
                try {
                    const windowHandle = window.getNativeWindowHandle();
                    const nsViewPtr = windowHandle.readBigUInt64LE();

                    const selLayer = sel_registerName('layer');
                    const selSetWantsLayer = sel_registerName('setWantsLayer:');
                    const selSetCornerRadius = sel_registerName('setCornerRadius:');
                    const selSetMasksToBounds = sel_registerName('setMasksToBounds:');

                    // Ensure layer-backing
                    objc_msgSend_bool(nsViewPtr, selSetWantsLayer, true);

                    // Get layer
                    const nsLayer = objc_msgSend(nsViewPtr, selLayer);
                    if (!nsLayer) return console.error('[MacOS] Failed to get layer');

                    // Apply Corner Radius
                    objc_msgSend_double(nsLayer, selSetCornerRadius, radius);
                    objc_msgSend_bool(nsLayer, selSetMasksToBounds, true);

                    console.log(`[MacOS] Rounded corners applied: ${radius}`);
                } catch (error) {
                    console.error('[MacOS] Error applying rounded corners:', error);
                }
            },

            setTransparentTitlebar: (window: BrowserWindow) => {
                try {
                    const windowHandle = window.getNativeWindowHandle();
                    const nsViewPtr = windowHandle.readBigUInt64LE();

                    // We have the View, we need the Window
                    const selWindow = sel_registerName('window');
                    const nsWindowPtr = objc_msgSend(nsViewPtr, selWindow);

                    if (!nsWindowPtr) return console.error('[MacOS] Failed to get NSWindow from NSView');

                    const selSetTitlebarAppearsTransparent = sel_registerName('setTitlebarAppearsTransparent:');
                    objc_msgSend_bool(nsWindowPtr, selSetTitlebarAppearsTransparent, true);

                    console.log('[MacOS] Transparent titlebar applied');
                } catch (error) {
                    console.error('[MacOS] Error setting transparent titlebar:', error);
                }
            }
        };
    } catch (e) {
        console.error('[MacOS] Failed to load native libraries:', e);
        utils = { setVibrancy: () => { }, setRoundedCorners: () => { }, setTransparentTitlebar: () => { } };
    }
} else {
    utils = {
        setVibrancy: () => { },
        setRoundedCorners: () => { },
        setTransparentTitlebar: () => { }
    };
}

export const { setVibrancy, setRoundedCorners, setTransparentTitlebar } = utils;
