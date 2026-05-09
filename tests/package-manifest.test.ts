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

	it("uses current @earendil-works pi package names", () => {
		const packageJsonText = readFileSync(packageJsonUrl, "utf8");
		const packageJson = JSON.parse(packageJsonText) as {
			peerDependencies?: Record<string, string>;
		};
		const extensionSource = readFileSync(new URL("extensions/index.ts", packageRootUrl), "utf8");

		assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-coding-agent"], "*");
		assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-tui"], "*");
		assert.equal(packageJson.peerDependencies?.["@mariozechner/pi-coding-agent"], undefined);
		assert.equal(packageJson.peerDependencies?.["@mariozechner/pi-tui"], undefined);
		assert.doesNotMatch(packageJsonText, /@mariozechner\//);
		assert.doesNotMatch(extensionSource, /@mariozechner\//);
		assert.match(extensionSource, /@earendil-works\/pi-coding-agent/);
		assert.match(extensionSource, /@earendil-works\/pi-tui/);
	});
});
