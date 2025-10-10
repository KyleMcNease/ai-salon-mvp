# Agent-S Timeout Configuration Guide

Comprehensive guide to timeout management for Agent-S persona tools and orchestrator.

## Overview

The Agent-S timeout system provides intelligent, automatic timeout calculation based on task complexity, persona type, and execution mode. This ensures that:

- **Simple tasks** don't wait unnecessarily long
- **Complex workflows** get adequate time to complete
- **Resource usage** is optimized
- **Failures are caught** early with helpful feedback

---

## Automatic Timeout Calculation

### How It Works

1. **Task Analysis**: The system analyzes your task description to infer complexity
2. **Persona Adjustment**: Different personas get different time multipliers
3. **Mode Consideration**: Parallel vs sequential execution affects total time
4. **Smart Defaults**: Sensible defaults that work for 90% of cases

### Complexity Levels

Tasks are automatically classified into 5 complexity tiers:

| Level | Base Timeout | Description | Example Tasks |
|-------|-------------|-------------|---------------|
| **SIMPLE** | 2 min | Quick UI interactions | "Click the submit button", "Open settings" |
| **MODERATE** | 5 min | Standard operations | "Write a function", "Run tests" |
| **COMPLEX** | 10 min | Multi-step workflows | "Debug this error", "Analyze the codebase" |
| **ADVANCED** | 20 min | Full features | "Implement authentication", "Refactor module" |
| **ENTERPRISE** | 40 min | Large-scale operations | "Migrate entire system", "Comprehensive audit" |

---

## Persona-Specific Timeouts

Different personas have different time requirements:

### Timeout Multipliers by Persona

| Persona | Multiplier | Rationale |
|---------|-----------|-----------|
| **Planner** | 1.0x | Planning is usually quick |
| **Designer** | 1.0x | Design tasks are typically fast |
| **Coder** | 1.2x | Writing code takes more time |
| **Researcher** | 1.3x | Research requires exploration |
| **Analyst** | 1.4x | Analysis needs thorough review |
| **Tester** | 1.5x | Testing is comprehensive |
| **Debugger** | 1.8x | Debugging can be lengthy |
| **Automator** | 2.0x | Automation involves repetition |

### Example Calculations

**Simple coder task:**
```
Base: 120s (SIMPLE)
Multiplier: 1.2x (coder)
Final: 144s (2.4 minutes)
```

**Complex debugger task:**
```
Base: 600s (COMPLEX)
Multiplier: 1.8x (debugger)
Final: 1080s (18 minutes)
```

---

## Orchestrator Timeouts

The orchestrator calculates timeouts based on:

1. **Number of tasks**
2. **Estimated complexity**
3. **Execution mode**

### Execution Mode Impact

#### Parallel Mode
```
Timeout = (Base × 1.2)
Reasoning: All tasks run simultaneously, so just need max task time + coordination buffer
```

**Example:**
- 5 moderate tasks in parallel
- Base: 300s per task
- Timeout: 360s (6 minutes)

#### Sequential Mode
```
Timeout = (Base × NumTasks × 1.1)
Reasoning: Tasks run one after another, with small buffer
```

**Example:**
- 5 moderate tasks sequentially
- Base: 300s per task
- Timeout: 1650s (27.5 minutes)

#### Priority Mode
```
Timeout = (Base × NumTasks × 1.1)
Reasoning: Same as sequential (ordered execution)
```

---

## Configuration Presets

Different environments have different timeout needs:

### Development
**Fast iteration, shorter timeouts:**
```python
DEVELOPMENT = TimeoutConfig(
    simple=60,        # 1 min
    moderate=180,     # 3 min
    complex=300,      # 5 min
    advanced=600,     # 10 min
    enterprise=1200,  # 20 min
    max_single_task=900,        # 15 min max
    max_orchestrator=1800,      # 30 min max
)
```

### Production (Default)
**Reliable, standard timeouts:**
```python
PRODUCTION = TimeoutConfig(
    simple=120,       # 2 min
    moderate=300,     # 5 min
    complex=600,      # 10 min
    advanced=1200,    # 20 min
    enterprise=2400,  # 40 min
    max_single_task=1800,       # 30 min max
    max_orchestrator=3600,      # 60 min max
)
```

### CI/CD
**Generous timeouts for automation:**
```python
CI_CD = TimeoutConfig(
    simple=180,       # 3 min
    moderate=450,     # 7.5 min
    complex=900,      # 15 min
    advanced=1800,    # 30 min
    enterprise=3600,  # 60 min
    max_single_task=2400,       # 40 min max
    max_orchestrator=7200,      # 120 min max (2 hours)
)
```

### Testing
**Quick feedback:**
```python
TESTING = TimeoutConfig(
    simple=30,        # 30 sec
    moderate=60,      # 1 min
    complex=120,      # 2 min
    advanced=240,     # 4 min
    enterprise=480,   # 8 min
    max_single_task=300,        # 5 min max
    max_orchestrator=600,       # 10 min max
)
```

---

## Usage Examples

### 1. Auto Timeout (Recommended)

Let the system calculate the appropriate timeout:

```python
# Single persona tool
result = await coder.run_impl({
    "task": "Implement a new API endpoint with validation",
    # No timeout specified - auto-calculated based on complexity
})
# System analyzes task → classifies as ADVANCED
# Coder multiplier: 1.2x
# Final timeout: 1440s (24 minutes)
```

### 2. Custom Timeout

Override with your own timeout:

```python
result = await debugger.run_impl({
    "task": "Debug a complex memory leak",
    "timeout": 3600  # 60 minutes - extra time for thorough debugging
})
```

### 3. Orchestrator Auto Timeout

```python
result = await orchestrator.run_impl({
    "tasks": [
        {"persona": "planner", "task": "Create implementation plan"},
        {"persona": "coder", "task": "Write the code"},
        {"persona": "tester", "task": "Test the implementation"},
    ],
    "execution_mode": "sequential",
    # No timeout - auto-calculated
    # System: 3 moderate tasks × 300s × 1.1 = 990s (16.5 min)
})
```

### 4. Orchestrator Custom Timeout

```python
result = await orchestrator.run_impl({
    "tasks": [...],  # Many complex tasks
    "execution_mode": "parallel",
    "timeout_seconds": 7200,  # 2 hours for large workflow
    "auto_scale_timeout": False  # Disable auto-calculation
})
```

---

## Keyword-Based Complexity Detection

The system looks for keywords in your task description to infer complexity:

### ENTERPRISE Level Keywords
- `migration`
- `refactor entire`
- `large-scale`
- `across all`
- `comprehensive audit`
- `full integration`

### ADVANCED Level Keywords
- `implement feature`
- `full workflow`
- `end-to-end`
- `complete system`
- `deep analysis`
- `comprehensive`

### COMPLEX Level Keywords
- `multi-step`
- `investigate`
- `debug`
- `analyze`
- `complex`
- `multiple`
- `coordinate`

### SIMPLE Level Keywords
- `click`
- `open`
- `close`
- `navigate to`
- `simple`
- `quick`
- `basic`
- `view`

**Default:** If no keywords match, defaults to MODERATE.

---

## Timeout Error Handling

When a timeout occurs, you get helpful feedback:

```
**CODER Agent Timeout:**

Task: Implement a complete e-commerce checkout system

⏱️ Operation timed out after 1200 seconds

**Suggestions:**
1. Break the task into smaller steps
2. Provide a longer timeout: "timeout": 2400
3. Simplify the task requirements

The task may be too complex for a single operation.
```

### Best Practices for Timeout Errors

1. **Break Down Tasks**
   ```python
   # Instead of:
   {"task": "Implement complete authentication system"}

   # Do:
   [
       {"persona": "coder", "task": "Create user model and database schema"},
       {"persona": "coder", "task": "Implement login endpoint"},
       {"persona": "coder", "task": "Add JWT token generation"},
       {"persona": "coder", "task": "Create password reset flow"},
   ]
   ```

2. **Use Orchestrator**
   ```python
   # Parallel execution with appropriate timeouts
   orchestrator.run_impl({
       "tasks": [...],  # Multiple smaller tasks
       "execution_mode": "parallel"
   })
   ```

3. **Increase Timeout Gradually**
   ```python
   # Start conservative
   "timeout": 600  # 10 min

   # If it times out, double it
   "timeout": 1200  # 20 min
   ```

---

## Environment-Based Configuration

Set timeouts based on your deployment environment:

```python
import os
from ii_agent.tools.agent_s_config import get_config_for_environment

# Auto-detect environment
env = os.getenv("ENVIRONMENT", "production")
config = get_config_for_environment(env)

# Use in persona tools
coder = AgentSCoderTool(settings=settings, timeout_config=config)
```

Supported environments:
- `development`, `dev`, `local` → Development config
- `ci`, `ci_cd`, `cicd`, `pipeline` → CI/CD config
- `test`, `testing`, `qa` → Testing config
- `production`, `prod` (default) → Production config

---

## Advanced Configuration

### Custom Timeout Config

Create your own timeout configuration:

```python
from ii_agent.tools.agent_s_config import TimeoutConfig

custom_config = TimeoutConfig(
    simple=90,        # Custom simple timeout
    moderate=400,     # Custom moderate timeout
    complex=800,      # etc...
    advanced=1500,
    enterprise=3000,
    max_single_task=2000,
    max_orchestrator=5000,

    # Custom persona multipliers
    persona_multipliers={
        "planner": 0.8,      # Faster planning
        "coder": 1.5,        # More time for coding
        "tester": 2.0,       # Much more time for testing
        # ... etc
    }
)
```

### Dynamic Timeout Adjustment

```python
from ii_agent.tools.agent_s_config import TaskComplexity, DEFAULT_TIMEOUT_CONFIG

# Calculate timeout programmatically
complexity = TaskComplexity.ADVANCED
persona = "debugger"

timeout = DEFAULT_TIMEOUT_CONFIG.get_timeout(
    complexity=complexity,
    persona=persona
)
# Result: 2160s (36 minutes) for advanced debugger task
```

---

## Monitoring and Logging

The system logs timeout calculations for debugging:

```
INFO: Auto-calculated timeout: 1440s for advanced coder task
INFO: Agent-S coder executing: Implement authentication (timeout: 1440s)
```

```
INFO: Auto-calculated orchestrator timeout: 1980s (advanced complexity, sequential mode, 5 tasks)
INFO: Orchestrating 5 tasks in sequential mode (timeout: 1980s)
```

Enable debug logging for more details:

```python
import logging
logging.getLogger("ii_agent.tools.agent_s_personas").setLevel(logging.DEBUG)
logging.getLogger("ii_agent.tools.agent_s_orchestrator").setLevel(logging.DEBUG)
```

---

## FAQ

### Q: What if my task always times out?
**A:** The task is likely too complex for a single operation. Break it into smaller sub-tasks or increase the timeout explicitly.

### Q: Can I disable auto-timeout?
**A:** Yes, provide an explicit `timeout` value or set `auto_scale_timeout: false` in the orchestrator.

### Q: Which timeout config should I use?
**A:** Use `PRODUCTION` (default) for most cases. Use `DEVELOPMENT` for rapid iteration, `CI_CD` for automation pipelines.

### Q: How do I know what timeout was used?
**A:** Check the logs - they always show the calculated timeout value.

### Q: Can personas share timeouts in orchestrator?
**A:** In parallel mode, yes (they share the total time). In sequential mode, each gets its own time slice.

### Q: What's the maximum timeout?
**A:** Single task: 30 minutes. Orchestrator: 60 minutes (production). Can be customized in config.

---

## Summary

| Feature | Description |
|---------|-------------|
| **Auto-calculation** | Intelligent timeout based on task analysis |
| **Persona multipliers** | Different personas get appropriate time |
| **Mode awareness** | Parallel vs sequential affects timing |
| **Environment presets** | Dev, prod, CI/CD, testing configs |
| **Custom overrides** | Always can specify exact timeout |
| **Helpful errors** | Timeout errors include actionable suggestions |
| **Logging** | Full visibility into timeout decisions |

**Recommendation:** Use auto-timeouts for 95% of cases. They're smart, adaptive, and work well out of the box.
