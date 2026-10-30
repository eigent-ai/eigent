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

import crypto from 'node:crypto';
import {
  APP_COMMAND,
  type AppCommandHandled,
  type AppCommandId,
  type AppCommandRequest,
} from '../../src/shared/appCommands';

const NAVIGATION_COMMANDS = new Set<AppCommandId>([
  APP_COMMAND.navigateHome,
  APP_COMMAND.navigateWorkspace,
  APP_COMMAND.navigateFiles,
  APP_COMMAND.navigateScheduled,
  APP_COMMAND.navigateDispatch,
  APP_COMMAND.navigateConfiguration,
]);

interface QueuedCommand {
  commandId: AppCommandId;
  requestId: string;
}

export interface RendererAppCommandCoordinatorOptions {
  send: (request: AppCommandRequest) => void;
  createRequestId?: () => string;
  maxQueuedCommands?: number;
  diagnostic?: (message: string) => void;
}

/**
 * Owns the main-to-renderer command lane for one app shell. Commands issued
 * before the current renderer explicitly announces readiness are bounded and
 * flushed in order. Renderer reloads invalidate the epoch, so receipts from an
 * old document can never acknowledge a command sent to the new one.
 */
export class RendererAppCommandCoordinator {
  private readonly send: (request: AppCommandRequest) => void;
  private readonly createRequestId: () => string;
  private readonly maxQueuedCommands: number;
  private readonly diagnostic: (message: string) => void;
  private epoch: string | null = null;
  private queued: QueuedCommand[] = [];
  private inFlight = new Map<string, AppCommandRequest>();

  constructor({
    send,
    createRequestId = () => crypto.randomUUID(),
    maxQueuedCommands = 100,
    diagnostic = () => undefined,
  }: RendererAppCommandCoordinatorOptions) {
    this.send = send;
    this.createRequestId = createRequestId;
    this.maxQueuedCommands = Math.max(1, maxQueuedCommands);
    this.diagnostic = diagnostic;
  }

  private enqueue(command: QueuedCommand): void {
    if (NAVIGATION_COMMANDS.has(command.commandId)) {
      this.queued = this.queued.filter(
        (queued) => !NAVIGATION_COMMANDS.has(queued.commandId)
      );
    }
    this.queued.push(command);
    if (this.queued.length > this.maxQueuedCommands) {
      const dropped = this.queued.shift();
      this.diagnostic(
        `[APP COMMAND] Dropped oldest queued command ${dropped?.commandId ?? 'unknown'} after reaching ${this.maxQueuedCommands}`
      );
    }
  }

  private sendCommand(command: QueuedCommand): void {
    const epoch = this.epoch;
    if (!epoch) {
      this.enqueue(command);
      return;
    }
    const request: AppCommandRequest = { ...command, epoch };
    try {
      this.send(request);
      this.inFlight.set(request.requestId, request);
    } catch (error) {
      this.diagnostic(
        `[APP COMMAND] Send failed for ${command.commandId}: ${String(error)}`
      );
      this.markNotReady('send-failed');
      this.enqueue(command);
    }
  }

  dispatch(commandId: AppCommandId): string {
    const command = { commandId, requestId: this.createRequestId() };
    this.sendCommand(command);
    return command.requestId;
  }

  markReady(epoch: string): void {
    if (!epoch) return;
    if (this.epoch && this.epoch !== epoch && this.inFlight.size > 0) {
      this.diagnostic(
        `[APP COMMAND] Renderer epoch changed with ${this.inFlight.size} unacknowledged command(s)`
      );
      this.inFlight.clear();
    }
    this.epoch = epoch;
    const queued = this.queued;
    this.queued = [];
    for (const command of queued) this.sendCommand(command);
  }

  markNotReady(reason: string, expectedEpoch?: string): boolean {
    if (expectedEpoch && expectedEpoch !== this.epoch) return false;
    if (this.inFlight.size > 0) {
      this.diagnostic(
        `[APP COMMAND] Renderer became unavailable (${reason}) with ${this.inFlight.size} unacknowledged command(s)`
      );
    }
    this.epoch = null;
    this.inFlight.clear();
    return true;
  }

  handleReceipt(receipt: AppCommandHandled): boolean {
    if (!this.epoch || receipt.epoch !== this.epoch) return false;
    const request = this.inFlight.get(receipt.requestId);
    if (!request || request.commandId !== receipt.commandId) return false;
    this.inFlight.delete(receipt.requestId);
    return true;
  }

  isReady(): boolean {
    return this.epoch !== null;
  }

  getEpoch(): string | null {
    return this.epoch;
  }

  getQueuedCount(): number {
    return this.queued.length;
  }
}
