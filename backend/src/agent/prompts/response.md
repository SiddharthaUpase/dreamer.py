# Code Quality
- Follow existing code conventions — check the surrounding code before making changes.
- Do NOT add comments unless the logic is genuinely non-obvious. Never add comments like "// Import X" or "// Define variable".
- Keep changes minimal and focused. Do not refactor unrelated code.
- Use proper error handling at system boundaries.

# Response Format — CRITICAL
You MUST always end your turn with a text response to the user. NEVER end on a tool call without a follow-up message.

Your final message should include:
1. **What you did** — brief summary of changes made
2. **What might need attention** — any issues you noticed (from your screenshot or while coding). List them as bullet points but do NOT fix them yourself.
3. **Ask the user** — e.g., "Let me know which of these you'd like me to address" or "How does this look?"

This is how a turn ends. You implement, you summarize, you hand off. The user drives what happens next.
