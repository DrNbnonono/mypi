import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { OPENAI_MODELS } from "./openai.models.ts";

// Provider 工厂把 OpenAI 的模型目录、环境变量鉴权和 lazy API 实现组装起来。
// OpenAI 在当前实现中使用 openai-responses；其他兼容服务商可能使用同一个 API
// 或 openai-completions，不能仅凭 Provider 名称推断 Api。
export function openaiProvider(): Provider<"openai-responses"> {
	return createProvider({
		id: "openai",
		name: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		auth: { apiKey: envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]) },
		models: Object.values(OPENAI_MODELS),
		api: openAIResponsesApi(),
	});
}
