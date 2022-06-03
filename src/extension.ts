// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { posix } from 'path';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "json-rpc-test" is now active!');

    const read100kbDisposable = vscode.commands.registerCommand('json-rpc-test.readFile100kb', () => timedReadFile(100));
    const read1000kbDisposable = vscode.commands.registerCommand('json-rpc-test.readFile1000kb', () => timedReadFile(1000));
    const read10000kbDisposable = vscode.commands.registerCommand('json-rpc-test.readFile10000kb', () => timedReadFile(10000));
    const write100kbDisposable = vscode.commands.registerCommand('json-rpc-test.writeFile100kb', () => timedWriteFile(100));
    const write1000kbDisposable = vscode.commands.registerCommand('json-rpc-test.writeFile1000kb', () => timedWriteFile(1000));
    const write10000kbDisposable = vscode.commands.registerCommand('json-rpc-test.writeFile10000kb', () => timedWriteFile(10000));

    context.subscriptions.push(
        read100kbDisposable,
        read1000kbDisposable,
        read10000kbDisposable,
        write100kbDisposable,
        write1000kbDisposable,
        write10000kbDisposable
    );
}

/** @param size of the file to write in kb */
async function timedWriteFile(size: number) {
    const file = getFile(`${size}kb`);
    const content = generateData(size);
    try {
        console.time(`Write file with ${size}kb`);
        await vscode.workspace.fs.writeFile(file, content);
    } catch (err) {
        vscode.window.showErrorMessage(`Could not write file with ${size}kb`);
        console.error(err);
    } finally {
        console.timeEnd(`Write file with ${size}kb`);
    }
}

/** @param size of the file to write in kb */
async function timedReadFile(size: number) {
    const file = getFile(`${size}kb`);
    try {
        console.time(`Read file with ${size}kb`);
        await vscode.workspace.fs.readFile(file);
    } catch (err) {
        vscode.window.showErrorMessage(`Could not read file with ${size}kb`);
        console.error(err);
    } finally {
        console.timeEnd(`Read file with ${size}kb`);
    }
}

function getFile(name: string): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders![0];
    const filePath = posix.join(folder.uri.path, name);
    return folder.uri.with({ path: filePath });
}

// this method is called when your extension is deactivated
export function deactivate() { }

const text100b = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.";
const text1k = text100b.repeat(10);
function generateData(size: number) {
    const content = text1k.repeat(size);
    return Buffer.from(content, 'utf-8');
}
