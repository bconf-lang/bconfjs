import { readFile } from "node:fs/promises";
import { parse } from "../../src/parse.js";

const input = await readFile(new URL("./test.bconf", import.meta.url), {
	encoding: "utf-8",
});
console.log(
	await parse(input, {
		rootDir: "./examples/node",
	}),
);
