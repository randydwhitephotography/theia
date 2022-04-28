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
import { ArrayBufferReadBuffer, ArrayBufferWriteBuffer, toArrayBuffer } from '@theia/core/lib/common/message-rpc/array-buffer-message-buffer';
import { ObjectType, RpcMessageDecoder, RpcMessageEncoder, SerializedError, transformErrorForSerialization } from '@theia/core/lib/common/message-rpc/rpc-message-encoder';
import URI from '@theia/core/lib/common/uri';
import { URI as VSCodeURI } from '@theia/core/shared/vscode-uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { Position, Range } from '../plugin/types-impl';
import { ClientProxyHandler, RpcInvocationHandler } from './proxy-handler';
import { ConnectionClosedError, ProxyIdentifier, RPCProtocol } from './rpc-protocol';
import { ResponseError } from '@theia/core/shared/vscode-languageserver-protocol';

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
        this.registerEncoder(ObjectType.Json, {
            is: value => value != null, // == null is handled by undefined encoder
            write: (buf, value) => {
                const json = JSON.stringify(value, ObjectsTransferrer.replacer);
                buf.writeString(json);
            }
        });

        this.registerEncoder(ObjectType.Undefined, {
            // eslint-disable-next-line no-null/no-null
            is: value => value == null,
            write: () => { }
        });

        this.registerEncoder(ObjectType.Error, {
            is: value => value instanceof Error,
            write: (buf, value: Error) => buf.writeString(JSON.stringify(transformErrorForSerialization(value)))
        });

        this.registerEncoder(ObjectType.ResponseError, {
            is: value => value instanceof ResponseError,
            write: (buf, value) => buf.writeString(JSON.stringify(value))
        });

        this.registerEncoder(ObjectType.ByteArray, {
            is: value => value instanceof Uint8Array,
            write: (buf, value: Uint8Array) => {
                /* When running in a nodejs context the received Uint8Array might be
                a nodejs Buffer allocated from node's Buffer pool, which is not transferrable.
                Therefore we use the `toArrayBuffer` utility method to retrieve the correct ArrayBuffer */
                const arrayBuffer = toArrayBuffer(value);
                buf.writeBytes(arrayBuffer);
            }
        });

        this.registerEncoder(ObjectType.ArrayBuffer, {
            is: value => value instanceof ArrayBuffer,
            write: (buf, value: ArrayBuffer) => buf.writeBytes(value)
        });

        this.registerEncoder(ObjectType.ObjectArray, {
            is: value => Array.isArray(value),
            write: (buf, args: any[]) => {
                const encodeSeparately = this.requiresSeparateEncoding(args);
                buf.writeUint8(encodeSeparately ? 1 : 0);
                if (!encodeSeparately) {
                    this.writeTypedValue(buf, args, ObjectType.ObjectArray);
                } else {
                    buf.writeInteger(args.length);
                    for (let i = 0; i < args.length; i++) {
                        this.writeTypedValue(buf, args[i], ObjectType.ObjectArray);
                    }
                }
            }
        });

    }
}

export class PluginRpcMessageDecoder extends RpcMessageDecoder {
    protected override registerDecoders(): void {
        this.registerDecoder(ObjectType.Json, {
            read: buf => JSON.parse(buf.readString(), ObjectsTransferrer.reviver)
        });
        this.registerDecoder(ObjectType.Undefined, {
            read: () => undefined
        });

        this.registerDecoder(ObjectType.Error, {
            read: buf => {
                const serializedError: SerializedError = JSON.parse(buf.readString());
                const error = new Error(serializedError.message);
                Object.assign(error, serializedError);
                return error;
            }
        });

        this.registerDecoder(ObjectType.ResponseError, {
            read: buf => {
                const error = JSON.parse(buf.readString());
                return new ResponseError(error.code, error.message, error.data);
            }
        });

        this.registerDecoder(ObjectType.ByteArray, {
            read: buf => new Uint8Array(buf.readBytes())
        });

        this.registerDecoder(ObjectType.ArrayBuffer, {
            read: buf => buf.readBytes()
        });

        this.registerDecoder(ObjectType.ObjectArray, {
            read: buf => {
                const encodedSeparately = buf.readUint8() === 1;

                if (!encodedSeparately) {
                    return this.readTypedValue(buf);
                }
                const length = buf.readInteger();
                const result = new Array(length);
                for (let i = 0; i < length; i++) {
                    result[i] = this.readTypedValue(buf);
                }
                return result;
            }
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

