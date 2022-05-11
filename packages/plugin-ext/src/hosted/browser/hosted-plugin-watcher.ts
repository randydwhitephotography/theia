// *****************************************************************************
// Copyright (C) 2018 Red Hat, Inc. and others.
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

import { injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { HostedPluginClient } from '../../common/plugin-protocol';
import { LogPart } from '../../common/types';

@injectable()
export class HostedPluginWatcher {
    private onPostMessage = new Emitter<{ pluginHostId: string, message: Uint8Array }>({
        onFirstListenerDidAdd: () => this.flushCachedMessages(),
    });
    private onLogMessage = new Emitter<LogPart>();
    private listenerAdded = false;
    private cache: Array<{ pluginHostId: string, message: Uint8Array }> = [];

    private readonly onDidDeployEmitter = new Emitter<void>();
    readonly onDidDeploy = this.onDidDeployEmitter.event;

    getHostedPluginClient(): HostedPluginClient {
        const emitMessage = (pluginHostId: string, message: Uint8Array) => this.postOrCacheMessage(pluginHostId, message);
        const logEmitter = this.onLogMessage;
        return {
            postMessage(pluginHostId, message: Uint8Array): Promise<void> {
                console.log('[Tobias] HostedPluginWatcher - postMessage', message.byteLength);
                emitMessage(pluginHostId, message);
                return Promise.resolve();
            },
            log(logPart: LogPart): Promise<void> {
                logEmitter.fire(logPart);
                return Promise.resolve();
            },
            onDidDeploy: () => this.onDidDeployEmitter.fire(undefined)
        };
    }

    private postOrCacheMessage(pluginHostId: string, message: Uint8Array): void {
        const event = { pluginHostId, message };
        if (this.listenerAdded) {
            this.onPostMessage.fire(event);
        } else {
            console.log('[Lucas] HostedPluginWatcher - cache message:', message.byteLength);
            this.cache.push(event);
        }
    }

    private flushCachedMessages(): void {
        console.log('[Lucas] HostedPluginWatcher - flushCachedMessages', this.cache.length);
        this.listenerAdded = true;
        this.cache.forEach(message => {
            this.onPostMessage.fire(message);
        });
        this.cache = [];
    }

    get onPostMessageEvent(): Event<{ pluginHostId: string, message: Uint8Array }> {
        console.log('[Tobias] HostedPluginWatcher - onPostMessageEvent');
        return this.onPostMessage.event;
    }

    get onLogMessageEvent(): Event<LogPart> {
        return this.onLogMessage.event;
    }
}
