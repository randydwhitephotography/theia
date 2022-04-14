// *****************************************************************************
// Copyright (C) STMicroelectronics and others.
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
// eslint-disable-next-line import/no-extraneous-dependencies
import 'reflect-metadata';
import { ForwardingChannel } from '@theia/core/lib/common/message-rpc/channel';
import { ArrayBufferReadBuffer, ArrayBufferWriteBuffer } from '@theia/core/lib/common/message-rpc/array-buffer-message-buffer';
import { performance } from 'perf_hooks';
import { QueuingChannelMultiplexer } from './plugin-rpc-protocol';

export class ChannelPipe {
    readonly left: ForwardingChannel = new ForwardingChannel('left', () => this.right.onCloseEmitter.fire({ reason: 'Left channel has been closed' }), () => {
        const leftWrite = new ArrayBufferWriteBuffer();
        leftWrite.onCommit(buffer => {
            this.right.onMessageEmitter.fire(() => new ArrayBufferReadBuffer(buffer));
        });
        return leftWrite;
    });
    readonly right: ForwardingChannel = new ForwardingChannel('right', () => this.left.onCloseEmitter.fire({ reason: 'Right channel has been closed' }), () => {
        const rightWrite = new ArrayBufferWriteBuffer();
        rightWrite.onCommit(buffer => {
            this.left.onMessageEmitter.fire(() => new ArrayBufferReadBuffer(buffer));
        });
        return rightWrite;
    });
}

async function foo(): Promise<void> {
    const channelPipe = new ChannelPipe();

    const leftMultiplexer = new QueuingChannelMultiplexer(channelPipe.left);
    const rightMultiplexer = new QueuingChannelMultiplexer(channelPipe.right);

    rightMultiplexer.onDidOpenChannel(e => {
        e.channel.onMessage(reader => console.log(`Message received : ${reader().readString()} [${performance.now()}]`));
        const channel = leftMultiplexer.getOpenChannel('test');
        if (channel) {
            channel.getWriteBuffer().writeString('Hello world').commit();
            channel.getWriteBuffer().writeString('Hello world 1').commit();
            channel.getWriteBuffer().writeString('Hello world 2').commit();
            channel.getWriteBuffer().writeString('Hello world 3').commit();

        }
    });

    await rightMultiplexer.open('test');
}

foo();
