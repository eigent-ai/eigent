import { IncomingMessage, ServerResponse } from 'http';

declare class ServerResponseWithBodyChunks extends ServerResponse {
    bodyChunks: Uint8Array[];
    _send(data: string, encoding: BufferEncoding, callback?: (() => void) | null, byteLength?: number): void;
}
declare function createNodeHttpServerDuplex(options: {
    method: string;
    originalUrl?: URL;
    url: URL;
    headers: Headers;
    body: Uint8Array;
}): Promise<[IncomingMessage, ServerResponseWithBodyChunks]>;

export { createNodeHttpServerDuplex };
