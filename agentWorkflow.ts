import { fileSearchTool, Agent, AgentInputItem, Runner } from "@openai/agents";

// 🛠️ Tool Definitions
const fileSearch = fileSearchTool(["vs_68efb8e2db688191bfde5e6e7f858989"]);
const fileSearch1 = fileSearchTool(["vs_68efb956e69c8191b9bf8535bb944b7e"]);
const fileSearch2 = fileSearchTool(["vs_68efb9dcb5c88191afea3e7b68b49e83"]);

// 🧠 Agent Definitions
const assignment2NarrativeAgent = new Agent({
  name: "Assignment 2 narrative agent.",
  instructions: `Welcome all 124 colleagues warmly. Explain your purpose: to evaluate Assignment 2 and provide written feedback. Use rubric logic. After scoring, write a short paragraph highlighting strengths, areas for improvement, and one actionable suggestion.`,
  model: "gpt-5",
  tools: [fileSearch],
  modelSettings: { reasoning: { effort: "low", summary: "auto" }, store: true }
});

const assignment2RubicAssessor = new Agent({
  name: "Assignment 2 rubric assessor",
  instructions: `Ensure the previous agent provides both numeric and written feedback. If missing, generate it. Use this logic:
- Add node: “Generate written feedback based on rubric scores.”
- Prompt: “Write 2–3 sentences of feedback per rubric category.”
- Merge rubric + feedback in output.
- Enable memory/context chaining.
Then: “Write a short paragraph of feedback. Mention strengths, areas for improvement, and suggest one actionable next step.”`,
  model: "gpt-5",
  tools: [fileSearch1],
  modelSettings: { reasoning: { effort: "low", summary: "auto" }, store: true }
});

const assignment3Marker = new Agent({
  name: "Assignment 3 marker",
  instructions: `Mark Assignment 3 using methods from Assignment 2 narrative and numeric rubrics. Use the attached rubric.`,
  model: "gpt-5",
  tools: [fileSearch2],
  modelSettings: { reasoning: { effort: "low", summary: "auto" }, store: true }
});

const agentChecker = new Agent({
  name: "Agent checker",
  instructions: `Check if all agents performed correctly. If feedback is missing or logic flawed, correct the response.`,
  model: "gpt-5",
  modelSettings: { reasoning: { effort: "low", summary: "auto" }, store: true }
});

// 🚀 Workflow Entrypoint
type WorkflowInput = { input_as_text: string };

export const runWorkflow = async (workflow: WorkflowInput) => {
  const state = {};
  const conversationHistory: AgentInputItem[] = [
    { role: "user", content: [{ type: "input_text", text: workflow.input_as_text }] }
  ];

  const runner = new Runner({
    traceMetadata: {
      __trace_source__: "agent-builder",
      workflow_id: "wf_68ee956cf6108190b7ba29e4f2a801d309305e67e804a439"
    }
  });

  const runAgent = async (agent: Agent) => {
    const resultTemp = await runner.run(agent, [...conversationHistory]);
    conversationHistory.push(...resultTemp.newItems.map(item => item.rawItem));
    if (!resultTemp.finalOutput) throw new Error("Agent result is undefined");
    return { output_text: resultTemp.finalOutput };
  };

  const assignment2NarrativeAgentResult = await runAgent(assignment2NarrativeAgent);
  const assignment2RubicAssessorResult = await runAgent(assignment2RubicAssessor);
  const assignment3MarkerResult = await runAgent(assignment3Marker);
  const agentCheckerResult = await runAgent(agentChecker);

  // Optional: Combine final output
  return {
    assignment2NarrativeAgentResult,
    assignment2RubicAssessorResult,
    assignment3MarkerResult,
    agentCheckerResult
  };
};
