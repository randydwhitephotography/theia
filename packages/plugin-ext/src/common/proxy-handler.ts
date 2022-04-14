/********************************************************************************
 * Copyright (C) 2021 Red Hat, Inc. and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Channel } from '@theia/core/';
import { RpcClient, RpcServer } from '@theia/core';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { PluginRpcMessageDecoder, PluginRpcMessageEncoder } from './plugin-rpc-protocol';

/**
 * A proxy handler that will send any method invocation on the proxied object
 * as a rcp protocol message over a channel.
 */
export class ClientProxyHandler<T extends object> implements ProxyHandler<T> {
    private channelDeferred: Deferred<RpcClient> = new Deferred();
    private encoder = new PluginRpcMessageEncoder();
    private decoder = new PluginRpcMessageDecoder();

    constructor(protected readonly id: string) {
        console.log(`[DEBUG] Create proxy '${id}`);
    }

    listen(channel: Channel): void {
        console.log(`[DEBUG] Invoke listen for proxy ${this.id}`);
        const client = new RpcClient(channel, { decoder: this.decoder, encoder: this.encoder });
        this.channelDeferred.resolve(client);
    }

    get(target: T, p: string | symbol, receiver: any): any {
        const isNotify = this.isNotification(p);
        return (...args: any[]) => {
            const method = p.toString();
            console.log([`[DEBUG] Invoke proxy ${this.id} for ${method} ${args}`]);
            return this.channelDeferred.promise.then((connection: RpcClient) =>
                new Promise((resolve, reject) => {
                    try {
                        if (isNotify) {
                            console.log(`[DEBUG] Send notification ${method} ${args}`);
                            connection.sendNotification(method, args);
                            resolve(undefined);
                        } else {
                            console.log(`[DEBUG] Send request ${method} ${args}`);
                            const resultPromise = connection.sendRequest(method, args) as Promise<any>;
                            resultPromise.then((result: any) => {
                                console.log(`[DEBUG] Resolve request ${method} ${args}`);
                                console.log(`[DEBUG] With ${result} `);

                                resolve(result);
                            }).catch(e => {
                                reject(e);
                            });
                        }
                    } catch (err) {
                        reject(err);
                    }
                })
            );
        };
    }

    /**
     * Return whether the given property represents a notification. If true,
     * the promise returned from the invocation will resolve immediatey to `undefined`
     *
     * A property leads to a notification rather than a method call if its name
     * begins with `notify` or `on`.
     *
     * @param p - The property being called on the proxy.
     * @return Whether `p` represents a notification.
     */
    protected isNotification(p: PropertyKey): boolean {
        return p.toString().startsWith('notify') || p.toString().startsWith('on');
    }
}

export class RpcInvocationHandler {
    private encoder = new PluginRpcMessageEncoder();
    private decoder = new PluginRpcMessageDecoder();

    constructor(readonly target: any) {
    }

    listen(channel: Channel): void {
        const server = new RpcServer(channel, (method: string, args: any[]) => this.handleRequest(method, args), { decoder: this.decoder, encoder: this.encoder });
        server.onNotification((e: { method: string, args: any }) => this.onNotification(e.method, e.args));
    }

    protected async handleRequest(method: string, args: any[]): Promise<any> {
        console.log(`[DEBUG] Handle requests ${method} ${args}`);
        return this.target[method](...args);
    }

    protected onNotification(method: string, args: any[]): void {
        console.log(`[DEBUG] Handle notification ${method} ${args}`);
        this.target[method](args);
    }
}
