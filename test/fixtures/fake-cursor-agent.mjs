import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const scenario = process.argv[2] ?? "normal";
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let pending;
let current = { mode: "agent", model: "default", effort: "medium" };
const configOptions = () => [
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: current.mode, options: ["agent","plan","ask"].map(value => ({ value, name: value })) },
  { id: "model", name: "Model", category: "model", type: "select", currentValue: current.model, options: [{ value: "default", name: "Auto" }, { value: "test-model", name: "Test Model" }, { value: "claude-fable-5-1", name: "Claude Fable 5.1" }] },
  { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: current.effort, options: ["low","medium","high"].map(value => ({ value, name: value })) },
];
for await (const line of rl) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  if (!("id" in message)) {
    if (message.method === "session/cancel" && pending?.promptId !== undefined) {
      send({ jsonrpc: "2.0", id: pending.promptId, result: { stopReason: "cancelled" } }); pending = undefined;
    }
    continue;
  }
  const { id, method, params } = message;
  if (!method && pending && String(id) === pending.requestId) {
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fake-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(message.result) } } } });
    send({ jsonrpc: "2.0", id: pending.promptId, result: { stopReason: "end_turn" } }); pending = undefined; continue;
  }
  if (method === "initialize") {
    if (scenario === "malformed") { process.stdout.write("not-json\n"); continue; }
    send({ jsonrpc: "2.0", id, result: { protocolVersion: 1, agentInfo: { name: "fake-cursor", version: "1" }, authMethods: [{ id: "cursor_login", name: "Cursor Login" }], agentCapabilities: { loadSession: true, promptCapabilities: { image: true, embeddedContext: false }, mcpCapabilities: { http: true }, sessionCapabilities: { list: {} } } } });
  } else if (method === "authenticate") send({ jsonrpc: "2.0", id, result: {} });
  else if (method === "session/new") send({ jsonrpc: "2.0", id, result: { sessionId: "fake-session", configOptions: configOptions(), modes: { currentModeId: current.mode, availableModes: ["agent","plan","ask"].map(value => ({ id: value, name: value })) }, models: { currentModelId: current.model, availableModels: [{ modelId: "default", name: "Auto" }, { modelId: "test-model", name: "Test Model" }, { modelId: "claude-fable-5-1", name: "Claude Fable 5.1" }] } } });
  else if (method === "session/load") {
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "REPLAY_MUST_NOT_APPEAR" } } } });
    send({ jsonrpc: "2.0", id, result: { configOptions: configOptions() } });
  } else if (method === "session/set_config_option") {
    current[params.configId] = params.value; send({ jsonrpc: "2.0", id, result: { configOptions: configOptions() } });
  } else if (method === "session/set_mode") { current.mode = params.modeId; send({ jsonrpc: "2.0", id, result: {} }); }
  else if (method === "session/set_model") { current.model = params.modelId; send({ jsonrpc: "2.0", id, result: {} }); }
  else if (method === "cursor/list_available_models") send({ jsonrpc: "2.0", id, result: { models: [{ value: "default", name: "Auto", configOptions: [] }, { value: "test-model", name: "Test Model", configOptions: configOptions().filter(x => x.id === "effort") }, { value: "claude-fable-5-1", name: "Claude Fable 5.1", configOptions: configOptions().filter(x => x.id === "effort") }] } });
  else if (method === "session/prompt") {
    const text = params.prompt.filter(x => x.type === "text").map(x => x.text).join("\n");
    if (current.model === "claude-fable-5-1") {
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "\n\nCheck your settings to continue" } } } });
      send({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } }); continue;
    }
    if (text.includes("hang")) { pending = { promptId: id, requestId: "none" }; continue; }
    if (text.includes("permission")) {
      pending = { promptId: id, requestId: "permission-1" };
      send({ jsonrpc: "2.0", id: pending.requestId, method: "session/request_permission", params: { sessionId: params.sessionId, toolCall: { toolCallId: "tool-1", title: "Run command", kind: "execute" }, options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }] } }); continue;
    }
    if (text.includes("question")) {
      pending = { promptId: id, requestId: "question-1" };
      send({ jsonrpc: "2.0", id: pending.requestId, method: "cursor/ask_question", params: { toolCallId: "tool-q", title: "Choose", questions: [{ id: "q1", prompt: "Which?", options: [{ id: "a1", label: "One" }, { id: "a2", label: "Two" }] }] } }); continue;
    }
    if (text.includes("plan")) {
      pending = { promptId: id, requestId: "plan-1" };
      send({ jsonrpc: "2.0", id: pending.requestId, method: "cursor/create_plan", params: { toolCallId: "tool-p", name: "Plan", plan: "# Do it", todos: [] } }); continue;
    }
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: params.sessionId, update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking" } } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } } } });
    send({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
  } else send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown ${method}` } });
}
