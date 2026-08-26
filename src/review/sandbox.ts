import {
	createGlobTool,
	createGrepTool,
	createReadTool,
	type Sandbox,
	type SandboxFactory,
} from "@flue/runtime";

export function readOnlySandbox(factory: SandboxFactory): SandboxFactory {
	return {
		createSandbox: (options) => factory.createSandbox(options),
		tools(sandbox) {
			return [
				createReadTool(sandbox),
				createGrepTool(sandbox),
				createGlobTool(sandbox),
			];
		},
	};
}

export function guardSandbox(
	sandbox: Sandbox,
	beforeOperation: () => Promise<void>,
): Sandbox {
	return {
		cwd: sandbox.cwd,
		exec: async (...args) => {
			await beforeOperation();
			return sandbox.exec(...args);
		},
		exists: async (...args) => {
			await beforeOperation();
			return sandbox.exists(...args);
		},
		mkdir: async (...args) => {
			await beforeOperation();
			return sandbox.mkdir(...args);
		},
		readFile: async (...args) => {
			await beforeOperation();
			return sandbox.readFile(...args);
		},
		readFileBuffer: async (...args) => {
			await beforeOperation();
			return sandbox.readFileBuffer(...args);
		},
		readdir: async (...args) => {
			await beforeOperation();
			return sandbox.readdir(...args);
		},
		resolvePath: (path) => sandbox.resolvePath(path),
		rm: async (...args) => {
			await beforeOperation();
			return sandbox.rm(...args);
		},
		stat: async (...args) => {
			await beforeOperation();
			return sandbox.stat(...args);
		},
		writeFile: async (...args) => {
			await beforeOperation();
			return sandbox.writeFile(...args);
		},
	};
}
