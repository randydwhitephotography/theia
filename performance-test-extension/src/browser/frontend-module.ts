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
import { CommandContribution } from '@theia/core';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import { BasicNodeFS, SERVICE_PATH } from '../common/basic-node-fs';
import { ExtensionFileReadTestCommandContribution } from './extension-command-contribution';
import { ExtensionFileReadTest } from './extension-file-read-test';
import { TheiaExtensionLogger } from './extension-logger';
import { NodeFileReadTest } from './node-file-read-test';

export default new ContainerModule((bind, unbind, isBound, rebind) => {
    bind(TheiaExtensionLogger).toSelf().inSingletonScope();
    bind(ExtensionFileReadTest).toSelf().inSingletonScope();
    bind(NodeFileReadTest).toSelf().inSingletonScope();

    bind(ExtensionFileReadTestCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ExtensionFileReadTestCommandContribution);

    bind(BasicNodeFS).toDynamicValue(ctx => {
        const connection = ctx.container.get(WebSocketConnectionProvider);
        return connection.createProxy<BasicNodeFS>(SERVICE_PATH);
    }).inSingletonScope();
});
