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
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Channel, ChannelMultiplexer, Disposable, DisposableCollection, ReadBuffer, RpcConnection, WriteBuffer } from '@theia/core';
import { ArrayBufferReadBuffer, ArrayBufferWriteBuffer } from '@theia/core/lib/common/message-rpc/array-buffer-message-buffer';
import { ObjectType, RpcMessageDecoder, RpcMessageEncoder } from '@theia/core/lib/common/message-rpc/rpc-message-encoder';
import URI from '@theia/core/lib/common/uri';
import { URI as VSCodeURI } from '@theia/core/shared/vscode-uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { Position, Range } from '../plugin/types-impl';
import { ClientProxyHandler, RpcInvocationHandler } from './proxy-handler';
import { ConnectionClosedError, ProxyIdentifier, RPCProtocol } from './rpc-protocol';

export class RPCProtocolImpl implements RPCProtocol {
    private readonly locals = new Map<string, RpcInvocationHandler>();
    private readonly proxies = new Map<string, any>();
    private readonly multiplexer: ChannelMultiplexer;

    private readonly toDispose = new DisposableCollection(
        Disposable.create(() => { /* mark as no disposed */ })
    );

    constructor(channel: Channel) {
        this.multiplexer = new QueuingChannelMultiplexer(channel);
        this.toDispose.push(Disposable.create(() => this.multiplexer.closeUnderlyingChannel()));
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    protected get isDisposed(): boolean {
        return this.toDispose.disposed;
    }

    getProxy<T>(proxyId: ProxyIdentifier<T>): T {
        if (this.isDisposed) {
            throw ConnectionClosedError.create();
        }
        let proxy = this.proxies.get(proxyId.id);
        if (!proxy) {
            proxy = this.createProxy(proxyId.id);
            this.proxies.set(proxyId.id, proxy);
        }
        return proxy;
    }

    protected createProxy<T>(proxyId: string): T {
        const handler = new ClientProxyHandler(proxyId);

        this.multiplexer.open(proxyId).then(_channel => {
            handler.listen(_channel);
        });
        return new Proxy(Object.create(null), handler);
    }

    set<T, R extends T>(identifier: ProxyIdentifier<T>, instance: R): R {
        if (this.isDisposed) {
            throw ConnectionClosedError.create();
        }
        const invocationHandler = this.locals.get(identifier.id);
        if (!invocationHandler) {
            const handler = new RpcInvocationHandler(identifier.id, instance);

            const channel = this.multiplexer.getOpenChannel(identifier.id);
            if (channel) {
                handler.listen(channel);
            } else {
                const channelOpenListener = this.multiplexer.onDidOpenChannel(event => {
                    if (event.id === identifier.id) {
                        handler.listen(event.channel);
                        channelOpenListener.dispose();
                    }
                });
            }

            this.locals.set(identifier.id, handler);
            if (Disposable.is(instance)) {
                this.toDispose.push(instance);
            }
            this.toDispose.push(Disposable.create(() => this.locals.delete(identifier.id)));

        }
        return instance;
    }
}

export class PluginRpcMessageEncoder extends RpcMessageEncoder {
    protected override registerEncoders(): void {
        super.registerEncoders();

        this.registerEncoder(ObjectType.JSON, {
            is: value => true,
            write: (buf, value) => {
                buf.writeString(JSON.stringify(value, ObjectsTransferrer.replacer));
            }
        }, true);

        this.registerEncoder(ObjectType.URI, {
            is: value => value instanceof URI,
            write: (buf, value) => buf.writeString(value.toString())
        }, true);

        this.registerEncoder(ObjectType.RANGE, {
            is: value => value instanceof Range,
            write: (buf, value: Range) => {
                const range = value as Range;
                const serializedValue = {
                    start: {
                        line: range.start.line,
                        character: range.start.character
                    },
                    end: {
                        line: range.end.line,
                        character: range.end.character
                    }
                };
                buf.writeString(JSON.stringify(serializedValue));
            }
        }, true);

        this.registerEncoder(ObjectType.VSCODE_URI, {
            is: value => VSCodeURI.isUri(value),
            write: (buf, value: VSCodeURI) => buf.writeString(JSON.stringify(value))
        });

    }
}

export class PluginRpcMessageDecoder extends RpcMessageDecoder {
    protected override registerDecoders(): void {
        super.registerDecoders();
        this.registerDecoder(ObjectType.JSON, {
            read: buf => JSON.parse(buf.readString(), ObjectsTransferrer.reviver)
        }, true);
        this.registerDecoder(ObjectType.URI, {
            read: buf => new URI(buf.readString())
        }, true);

        this.registerDecoder(ObjectType.RANGE, {
            read: buf => {
                const obj = JSON.parse(buf.readString());
                const start = new Position(obj.start.line, obj.start.character);
                const end = new Position(obj.end.line, obj.end.character);
                return new Range(start, end);
            }
        }, true);

        this.registerDecoder(ObjectType.VSCODE_URI, {
            read: buf => VSCodeURI.parse(buf.readString())
        });

    }

}
export class PluginRpcConnection extends RpcConnection {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(override readonly channel: Channel, public override readonly requestHandler: (method: string, args: any[]) => Promise<any>) {
        super(channel, requestHandler, { decoder: new PluginRpcMessageDecoder(), encoder: new PluginRpcMessageEncoder() });
    }
}

export class QueuingChannelMultiplexer extends ChannelMultiplexer {
    protected messagesToSend: ArrayBuffer[] = [];
    protected readonly toDispose = new DisposableCollection();

    constructor(underlyingChannel: Channel) {
        super(underlyingChannel);
        this.toDispose.push(Disposable.create(() => this.messagesToSend = []));
    }

    protected override getUnderlyingWriteBuffer(): WriteBuffer {
        const writer = new ArrayBufferWriteBuffer();
        writer.onCommit(buffer => this.commitSingleMessage(buffer));
        return writer;
    }

    protected commitSingleMessage(msg: ArrayBuffer): void {
        if (this.toDispose.disposed) {
            throw ConnectionClosedError.create();
        }
        if (this.messagesToSend.length === 0) {
            if (typeof setImmediate !== 'undefined') {
                setImmediate(() => this.sendAccumulated());
            } else {
                setTimeout(() => this.sendAccumulated(), 0);
            }
        }
        this.messagesToSend.push(msg);
    }

    protected sendAccumulated(): void {
        const cachedMessages = this.messagesToSend;
        this.messagesToSend = [];
        const writer = this.underlyingChannel.getWriteBuffer();

        if (cachedMessages.length > 0) {
            writer.writeInteger(cachedMessages.length);
            cachedMessages.forEach(msg => {
                writer.writeBytes(msg);
            });

        }
        writer.commit();
    }

    protected override handleMessage(buffer: ReadBuffer): void {
        // Read in the list of messages and handle each message individually
        const length = buffer.readInteger();
        if (length > 0) {
            for (let index = 0; index < length; index++) {
                const message = buffer.readBytes();
                this.handleSingleMessage(new ArrayBufferReadBuffer(message));

            }
        }
    }

    protected handleSingleMessage(buffer: ReadBuffer): void {
        return super.handleMessage(buffer);
    }
}

interface SerializedObject {
    $type: SerializedObjectType;
    data: string;
}

enum SerializedObjectType {
    THEIA_URI,
    VSCODE_URI,
    THEIA_RANGE,
    TEXT_BUFFER
}

function isSerializedObject(obj: any): obj is SerializedObject {
    return obj && obj.$type !== undefined && obj.data !== undefined;
}
/**
 * These functions are responsible for correct transferring objects via rpc channel.
 *
 * To reach that some specific kind of objects is converted to json in some custom way
 * and then, after receiving, revived to objects again,
 * so there is feeling that object was transferred via rpc channel.
 *
 * To distinguish between regular and altered objects, field $type is added to altered ones.
 * Also value of that field specifies kind of the object.
 */
export namespace ObjectsTransferrer {

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export function replacer(key: string | undefined, value: any): any {
        if (value instanceof URI) {
            return {
                $type: SerializedObjectType.THEIA_URI,
                data: value.toString()
            } as SerializedObject;
        } else if (value instanceof Range) {
            const range = value as Range;
            const serializedValue = {
                start: {
                    line: range.start.line,
                    character: range.start.character
                },
                end: {
                    line: range.end.line,
                    character: range.end.character
                }
            };
            return {
                $type: SerializedObjectType.THEIA_RANGE,
                data: JSON.stringify(serializedValue)
            } as SerializedObject;
        } else if (value && value['$mid'] === 1) {
            // Given value is VSCode URI
            // We cannot use instanceof here because VSCode URI has toJSON method which is invoked before this replacer.
            const uri = VSCodeURI.revive(value);
            return {
                $type: SerializedObjectType.VSCODE_URI,
                data: uri.toString()
            } as SerializedObject;
        } else if (value instanceof BinaryBuffer) {
            const bytes = [...value.buffer.values()];
            return {
                $type: SerializedObjectType.TEXT_BUFFER,
                data: JSON.stringify({ bytes })
            };
        }

        return value;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export function reviver(key: string | undefined, value: any): any {
        if (isSerializedObject(value)) {
            switch (value.$type) {
                case SerializedObjectType.THEIA_URI:
                    return new URI(value.data);
                case SerializedObjectType.VSCODE_URI:
                    return VSCodeURI.parse(value.data);
                case SerializedObjectType.THEIA_RANGE:
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const obj: any = JSON.parse(value.data);
                    const start = new Position(obj.start.line, obj.start.character);
                    const end = new Position(obj.end.line, obj.end.character);
                    return new Range(start, end);
                case SerializedObjectType.TEXT_BUFFER:
                    const data: { bytes: number[] } = JSON.parse(value.data);
                    return BinaryBuffer.wrap(Uint8Array.from(data.bytes));
            }
        }

        return value;
    }

}

