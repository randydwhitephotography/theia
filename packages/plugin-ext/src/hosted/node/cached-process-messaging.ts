// *****************************************************************************
// Copyright (C) 2022 STMicroelectronics and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
// *****************************************************************************
import { Readable } from 'stream';
import { Uint8ArrayReadBuffer, Uint8ArrayWriteBuffer } from '@theia/core/lib/common/message-rpc/uint8-array-message-buffer';

export function configureCachedReceive(readable: Readable, onReceived: (buffer: Uint8Array) => void): void {
    let missingBytes = 0;
    let cachedChunks: Array<Uint8Array> = [];

    // TODO improve implementation
    const handleDataReceived = (data: Uint8Array) => {
        if (missingBytes === 0) {
            // Got a new message
            const readBuffer = new Uint8ArrayReadBuffer(data);
            const messageBytes = readBuffer.readUint32();
            // TODO possible without slice for better performance?
            const dataOnly = data.slice(4); // Remove the first 4 bytes as they contained the message bytes
            if (messageBytes === dataOnly.length) {
                // the data chunk contains exactly this message
                onReceived(dataOnly);
            } else {
                cachedChunks.push(dataOnly);
                missingBytes = messageBytes - dataOnly.length;
            }
        } else if (data.length < missingBytes) {
            // Got additional data but we still need more
            cachedChunks.push(data);
            missingBytes -= data.length;
        } else if (data.length === missingBytes) {
            // Got exactly the missing data
            cachedChunks.push(data);
            const messageData = Buffer.concat(cachedChunks);
            onReceived(messageData);
            missingBytes = 0;
            cachedChunks = [];
        } else {
            // Got the missing data + data from the next message
            // handle current message
            // TODO possible without slice for better performance?
            const missingData = data.slice(0, missingBytes);
            cachedChunks.push(missingData);
            const messageData = Buffer.concat(cachedChunks);
            onReceived(messageData);
            missingBytes = 0;
            cachedChunks = [];

            const nextMessageData = data.slice(missingBytes);
            handleDataReceived(nextMessageData);
        }
    };

    readable.on('data', (data: Uint8Array) => {
        handleDataReceived(data);
    });
}

export function encodeMessageStart(buffer: Uint8Array): Uint8Array {
    const writeBuffer = new Uint8ArrayWriteBuffer(new Uint8Array(4));
    writeBuffer.writeUint32(buffer.byteLength);
    const result = new Uint8Array(writeBuffer.getCurrentContents());
    writeBuffer.dispose();
    return result;
}
