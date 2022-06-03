# json-rpc-test extension

Simple RPC extension to test the Theia's JSON-RPC performance in the plugin context.
Used for testing in the context of https://github.com/eclipse-theia/theia/issues/10684.

Registers command for writing and reading file samples using the `vscode.workspace.fs` API.
Measures the execution duration and logs it to the console.
Available commands:

- Write File with 100KB
- Write File with 1MB
- Write File with 10MB
- Read File with 100KB
- Read File with 1MB
- Read File with 10MB

The `Write file` commands simply write the files into the root directory of the currently opened workspace.
Before you can use the `Read File` command you have to make sure that the file exists by invoking the corresponding `Write File` command.
