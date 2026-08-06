# Browser Reload Gate

The browser persistence adapter must preserve a complete ChronicleSaveV2 across a page lifecycle boundary.

Gate assertions:

- location survives reload;
- WorldTimestamp survives reload;
- Event Ledger survives reload;
- KnowledgeState survives reload;
- scheduledConsequences survive reload;
- missing Chronicle resolves to null;
- incompatible schema is rejected before hydration.

This file is test-support documentation only. Product-facing copy and UI remain owned by the game shell.

Tehkné Solutions
