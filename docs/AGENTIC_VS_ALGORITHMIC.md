# Agentic vs Algorithmic Trading — Expectations

Purpose
- Clarify the distinction between Algorithmic trading (static algorithms) and Agentic trading (objective-driven, dynamic behavior). Help product, dev, and users understand responsibilities and UX expectations.

Algorithmic Trading (Deterministic)
- Source: `AIChatbot` / Algorithm generator or user-created strategies saved via the Algorithms UI.
- Behavior: Produces a `TradingAlgorithm` JSON with explicit rules and `riskManagement` that the trading bot executes deterministically.
- Use case: Backtesting, scheduled/repeatable automated strategies, A/B testing, and production strategy runs.
- Approval: Algorithms are saved, versioned, and intentionally activated by the user.

Agentic Trading (Dynamic / Objective-Driven)
- Source: User objectives submitted in the Agent Trading panel (free-text prompts) or chat-based instructions.
- Behavior: The Manager/Orchestrator consults the LLM to generate proposals (dynamic rules or algorithms) and then executes a plan using agents (Market, Risk, Execution). Algorithms may be used as a tool but are not required.
- Use case: Rapid, on-demand strategy generation, exploratory trades, or following a user-specified objective (e.g., "target 5% ROI in 24h").
- Approval: Proposals are persisted as `proposal` objects. The UI supports three approval modes:
  - Suggest: LLM proposes a plan; user must explicitly approve to execute.
  - Auto-approve: LLM proposal is accepted and executed immediately.
  - Manual: No LLM proposal; user submits a direct order via the agent workflow.

Design & Safety Guidelines
- User intent is the prime directive: LLM output should honor numeric values and only use supported condition formats.
- If a user request is out-of-scope or unsupported, the agent must return a concise alternative and request explicit approval.
- Risk controls: `riskAgent` must validate algorithm `riskManagement` and enforce account-level limits before execution.
- Persistence: Proposals are stored for audit and approval; approved proposals may be converted to saved algorithms if desired.

UX Mapping
- `AIChatbot`: remains the canonical Algorithmic strategy generator and repository (Algorithms page).
- `AgentTradingPanel`: primary entry point for Agentic workflows — objective input, approval mode selector, proposal status.
- `Proposals` panel (planned): list pending proposals with approve/reject actions linking to `/api/agent/proposals` endpoints.

Next Steps
- Add a small Proposals UI to review/approve LLM proposals (recommended next task).
- Integrate `riskManagement` checks in `riskAgent` to fully enforce approved algorithm constraints.
- Optionally persist proposals to DB for durability across restarts.

This document is intentionally brief — let me know if you want it expanded into the project README or `Appflow.md`.
