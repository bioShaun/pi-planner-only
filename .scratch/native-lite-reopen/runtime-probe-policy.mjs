export function isFinalModelsManagementResult(message) {
	if (!message || message.role !== "custom"
		|| !["subagent-slash-result", "subagent-slash-text-result"].includes(message.customType)
		|| message.details?.result?.details?.mode !== "management"
		|| typeof message.content !== "string") return false;
	return [
		"Subagent models",
		"tcuni/gpt-6.1-terra",
		"tcuni/gpt-6-luna",
		"worker",
		"oracle",
		"reviewer",
		"medium",
	].every(value => message.content.includes(value));
}
