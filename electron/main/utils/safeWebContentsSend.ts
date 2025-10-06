import log from 'electron-log'
import { getMainWindow } from "../init";

/**
 * Safely send message to main window if it exists and is not destroyed
 * @param channel - The IPC channel to send message to
 * @param data - The data to send
 */
function safeMainWindowSend(channel: string, data?: any) {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
    return true;
  } else {
    log.warn(`[WEBCONTENTS SEND] Cannot send message to main window: ${channel}`, data);
    return false;
  }
}

export {safeMainWindowSend}