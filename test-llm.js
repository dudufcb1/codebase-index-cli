// Quick test script to verify LLM connection
// Usage: node test-llm.js

const endpoint = process.env.TRACK_GIT_LLM_ENDPOINT || "http://localhost:4141/v1";
const model = process.env.TRACK_GIT_LLM_MODEL || "gpt-4.1";
const apiKey = process.env.TRACK_GIT_LLM_API_KEY || "SK-12999182828283";

console.log("🔍 Testing LLM connection...");
console.log(`   Endpoint: ${endpoint}`);
console.log(`   Model: ${model}`);
console.log(`   API Key: ${apiKey.slice(0, 10)}...`);
console.log("");

const requestBody = {
	model: model,
	messages: [
		{
			role: "system",
			content: "You are a helpful assistant."
		},
		{
			role: "user",
			content: "Say 'Hello! LLM connection successful.' in one sentence."
		}
	],
	temperature: 0.3,
	max_tokens: 100
};

console.log("📤 Sending test request...");
console.log("");

fetch(`${endpoint}/chat/completions`, {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		"Authorization": `Bearer ${apiKey}`
	},
	body: JSON.stringify(requestBody)
})
	.then(async (response) => {
		console.log(`📥 Response status: ${response.status} ${response.statusText}`);
		console.log("");

		if (!response.ok) {
			const errorText = await response.text();
			console.error("❌ Request failed!");
			console.error("Response body:", errorText);
			process.exit(1);
		}

		return response.json();
	})
	.then((data) => {
		console.log("✅ Request successful!");
		console.log("");
		console.log("📋 Full response:");
		console.log(JSON.stringify(data, null, 2));
		console.log("");

		if (data.choices && data.choices.length > 0) {
			console.log("💬 LLM Response:");
			console.log(data.choices[0].message.content);
			console.log("");
			console.log("✅ LLM is working correctly!");
		} else {
			console.log("⚠️  No choices in response");
		}
	})
	.catch((error) => {
		console.error("❌ Connection error!");
		console.error(error.message);
		console.error("");
		console.error("Common issues:");
		console.error("  - LLM server not running");
		console.error("  - Wrong endpoint URL");
		console.error("  - Network connectivity issues");
		process.exit(1);
	});
