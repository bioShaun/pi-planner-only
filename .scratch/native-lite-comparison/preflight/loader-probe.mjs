import { loadExtensions } from "/home/tcuni-claw/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

const [subagentsPath, pluginPath] = process.argv.slice(2);
const result = await loadExtensions([subagentsPath, pluginPath], process.cwd());
console.log(JSON.stringify({
	errors: result.errors,
	extensions: result.extensions.map((extension) => ({
		name: extension.path.split("/").at(-1),
		resolvedPath: extension.resolvedPath,
		path: extension.path,
		tools: [...extension.tools.keys()].sort(),
		commands: [...extension.commands.keys()].sort(),
		handlers: [...extension.handlers.keys()].sort(),
	})),
}));
