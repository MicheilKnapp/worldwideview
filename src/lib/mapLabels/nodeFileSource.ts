import { open, type FileHandle } from "fs/promises";

import type { RangeResponse, Source } from "pmtiles";

/**
 * Reads a PMTiles archive from the local filesystem.
 *
 * The library's own FileSource takes a browser `File`, which its documentation
 * flags as "different from the NodeJS file API" — passing a path to it compiles
 * but fails at runtime. PMTiles only needs byte ranges, so this implements the
 * same Source contract with a persistent file handle.
 *
 * One handle is kept open for the archive's life rather than reopening per
 * tile: a single view resolves several tiles, and each tile costs at least two
 * reads (directory, then data).
 */
export class NodeFileSource implements Source {
    private handle: FileHandle | null = null;

    private opening: Promise<FileHandle> | null = null;

    constructor(private readonly path: string) {}

    getKey(): string {
        return this.path;
    }

    /** Opens once even under concurrent callers, which tile fetching creates. */
    private async getHandle(): Promise<FileHandle> {
        if (this.handle) return this.handle;
        if (!this.opening) {
            this.opening = open(this.path, "r").then((handle) => {
                this.handle = handle;
                return handle;
            });
        }
        return this.opening;
    }

    async getBytes(offset: number, length: number): Promise<RangeResponse> {
        const handle = await this.getHandle();
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);

        // Slice to bytesRead: a read at the end of the file returns fewer bytes
        // than asked for, and handing back the zero-padded tail would corrupt
        // the decoded tile.
        const slice = buffer.subarray(0, bytesRead);
        return {
            data: slice.buffer.slice(
                slice.byteOffset,
                slice.byteOffset + slice.byteLength,
            ) as ArrayBuffer,
        };
    }

    async close(): Promise<void> {
        const handle = this.handle;
        this.handle = null;
        this.opening = null;
        await handle?.close();
    }
}
