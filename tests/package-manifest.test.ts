import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const packageRootUrl = new URL("../", import.meta.url);

describe("package manifest", () => {
	it("declares a single index extension for compact Pi startup display", () => {
		const packageJson = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as {
			pi?: { extensions?: string[] };
		};

		assert.deepEqual(packageJson.pi?.extensions, ["./extensions/index.ts"]);
		assert.equal(existsSync(new URL("extensions/index.ts", packageRootUrl)), true);
		assert.equal(existsSync(new URL("extensions/ask-user-question.ts", packageRootUrl)), false);
	});
});
