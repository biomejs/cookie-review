import { cloudflareBindingProvider } from "@flue/runtime/cloudflare/workers-ai";
import { describe, expect, it } from "vitest";
import { config } from "../src/config.ts";

const cloudflareProvider = cloudflareBindingProvider({
	binding: {
		async run() {
			throw new Error("The model catalog test must not call Workers AI");
		},
	},
	gateway: false,
});

describe("reviewer model configuration", () => {
	it("uses a catalogued reasoning model with the configured thinking level", () => {
		const repository = config.repositories["biomejs/biome"];
		const providerPrefix = "cloudflare/";

		expect(repository.model.startsWith(providerPrefix)).toBe(true);
		const modelId = repository.model.slice(providerPrefix.length);
		const model = cloudflareProvider
			.getModels()
			.find((candidate) => candidate.id === modelId);

		expect(model).toBeDefined();
		expect(model?.reasoning).toBe(true);
		expect(model?.contextWindow).toBeGreaterThan(0);
		expect(model?.thinkingLevelMap?.[repository.thinkingLevel]).toBe(
			repository.thinkingLevel,
		);
	});
});
