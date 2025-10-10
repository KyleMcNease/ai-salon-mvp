# Agent-S Persona System

The Agent-S Persona System provides specialized AI agents for different types of computer control tasks, enabling parallel execution and expert-level performance across various domains.

## Overview

Agent-S personas are specialized versions of the Agent-S computer control framework, each with unique expertise and system prompts optimized for specific task types. This allows you to:

- **Run multiple specialized agents in parallel** for complex workflows
- **Leverage domain expertise** for better task execution
- **Coordinate different aspects** of a project simultaneously
- **Maintain context** across different specializations

## Available Personas

### 🎯 Planner (`agent_s_planner`)
**Expert in:** Task breakdown, workflow analysis, project planning

**Best for:**
- Creating detailed project plans
- Breaking down complex tasks into steps
- Analyzing UI/UX flows
- Designing automation sequences

**Example:**
```json
{
  "task": "Analyze this application and create a testing plan for the checkout flow",
  "context": "E-commerce application with multi-step checkout"
}
```

### 💻 Coder (`agent_s_coder`)
**Expert in:** Writing code, IDE navigation, code refactoring

**Best for:**
- Writing and editing code in IDEs
- Navigating through codebases
- Setting up development environments
- Implementing features

**Example:**
```json
{
  "task": "Open VS Code and create a new React component called UserProfile",
  "context": "Located in src/components/ directory"
}
```

### 🧪 Tester (`agent_s_tester`)
**Expert in:** Quality assurance, validation, test execution

**Best for:**
- Executing test cases
- Exploratory testing
- Validating UI/UX elements
- Checking for bugs and edge cases

**Example:**
```json
{
  "task": "Test the login form with invalid credentials and verify error messages",
  "context": "Testing authentication flow"
}
```

### 🐛 Debugger (`agent_s_debugger`)
**Expert in:** Finding bugs, investigating errors, root cause analysis

**Best for:**
- Investigating errors and exceptions
- Setting breakpoints
- Tracing execution flows
- Identifying root causes

**Example:**
```json
{
  "task": "Find why the API call is failing and check the network inspector",
  "context": "User reports 500 error on profile update"
}
```

### 🎨 Designer (`agent_s_designer`)
**Expert in:** UI/UX, visual design, accessibility

**Best for:**
- Arranging and styling UI elements
- Testing responsive design
- Navigating design tools
- Validating accessibility

**Example:**
```json
{
  "task": "Adjust the spacing and alignment of the navigation bar",
  "context": "Following design system guidelines"
}
```

### 🔍 Researcher (`agent_s_researcher`)
**Expert in:** Information gathering, documentation navigation

**Best for:**
- Navigating documentation
- Gathering information from multiple sources
- Comparing options
- Extracting and organizing data

**Example:**
```json
{
  "task": "Research the React useEffect hook in the documentation and find examples",
  "context": "Learning React hooks for data fetching"
}
```

### ⚙️ Automator (`agent_s_automator`)
**Expert in:** Workflow automation, repetitive tasks

**Best for:**
- Automating repetitive workflows
- Batch processing
- Setting up automation scripts
- Optimizing processes

**Example:**
```json
{
  "task": "Rename all .js files to .jsx in the components directory",
  "context": "Migrating to TypeScript"
}
```

### 📊 Analyst (`agent_s_analyst`)
**Expert in:** Data analysis, metrics, insights

**Best for:**
- Analyzing data and metrics
- Creating visualizations
- Extracting insights from dashboards
- Comparing and validating data

**Example:**
```json
{
  "task": "Analyze the performance metrics dashboard and identify bottlenecks",
  "context": "Application monitoring"
}
```

## Using Individual Personas

### Single Agent Execution

```python
# Use a specific persona tool
from ii_agent.tools.agent_s_personas import AgentSCoderTool

coder = AgentSCoderTool(settings=settings)

result = await coder.run_impl({
    "task": "Create a new function called calculateTotal in utils.js",
    "context": "Working in the shopping cart module",
    "enable_execution": False  # Preview mode (safe)
})
```

### Enabling in II-Agent

To enable Agent-S personas in your II-Agent workflows:

```python
tool_args = {
    "agent_s": True,  # Enable Agent-S
    "agent_s_personas": True,  # Enable all persona tools (default: True)
}
```

## Parallel Multi-Agent Execution

The orchestrator allows you to run multiple personas simultaneously:

### Using the Orchestrator

```python
from ii_agent.tools.agent_s_orchestrator import AgentSOrchestratorTool

orchestrator = AgentSOrchestratorTool(settings=settings)

result = await orchestrator.run_impl({
    "tasks": [
        {
            "persona": "planner",
            "task": "Create a testing plan for the new feature",
            "priority": 10
        },
        {
            "persona": "coder",
            "task": "Set up the basic file structure",
            "priority": 9
        },
        {
            "persona": "researcher",
            "task": "Find similar implementations in the codebase",
            "priority": 8
        }
    ],
    "execution_mode": "parallel",  # or "sequential", "priority"
    "timeout_seconds": 300
})
```

### Execution Modes

1. **Parallel** (default)
   - All tasks run simultaneously
   - Fastest for independent tasks
   - Best for: Gathering multiple perspectives, parallel workflows

2. **Sequential**
   - Tasks run one after another
   - Results from earlier tasks available to later ones
   - Best for: Dependent workflows, step-by-step processes

3. **Priority**
   - Tasks run in priority order (highest first)
   - Higher priority number = runs first
   - Best for: Critical tasks first, resource management

## Example Workflows

### 1. Full-Stack Development Workflow

```json
{
  "tasks": [
    {
      "persona": "planner",
      "task": "Analyze requirements and create implementation plan",
      "priority": 10
    },
    {
      "persona": "coder",
      "task": "Set up backend API endpoints",
      "priority": 5
    },
    {
      "persona": "coder",
      "task": "Create frontend components",
      "priority": 5
    },
    {
      "persona": "tester",
      "task": "Write and run unit tests",
      "priority": 3
    }
  ],
  "execution_mode": "priority"
}
```

### 2. Bug Investigation Workflow

```json
{
  "tasks": [
    {
      "persona": "debugger",
      "task": "Investigate error logs and stack traces"
    },
    {
      "persona": "researcher",
      "task": "Search for similar issues in documentation"
    },
    {
      "persona": "tester",
      "task": "Reproduce the bug with test cases"
    }
  ],
  "execution_mode": "parallel"
}
```

### 3. Design Review Workflow

```json
{
  "tasks": [
    {
      "persona": "designer",
      "task": "Review visual consistency with design system"
    },
    {
      "persona": "tester",
      "task": "Test responsive behavior across screen sizes"
    },
    {
      "persona": "analyst",
      "task": "Analyze user interaction patterns"
    }
  ],
  "execution_mode": "parallel"
}
```

## Safety Features

### Preview Mode (Default)
By default, all persona tools run in **preview mode**:
- Actions are generated but not executed
- You receive Python code showing what would be done
- Safe for exploration and planning

```json
{
  "task": "Delete all temporary files",
  "enable_execution": false  // Default - just shows what would happen
}
```

### Execution Mode
To actually execute actions:

```json
{
  "task": "Create a new file called test.txt",
  "enable_execution": true  // Executes the action
}
```

⚠️ **Warning:** Only enable execution for trusted, well-understood tasks.

## Configuration

### Enable/Disable Personas

```python
# Enable Agent-S with all personas
tool_args = {
    "agent_s": True,
    "agent_s_personas": True,
    "agent_s_orchestrator": True
}

# Enable only specific personas (manual registration)
# Register only the tools you need in your workflow
```

### Model Configuration

Personas use your II-Agent settings for model selection:

1. **Anthropic Claude** (preferred)
   - Best performance with Claude Sonnet 4
   - Excellent reasoning and planning

2. **OpenAI GPT** (fallback)
   - Good alternative
   - Fast execution

Configure API keys in II-Agent settings UI.

## Best Practices

### 1. Choose the Right Persona
Match the persona to the task type for best results:
- Code tasks → **Coder**
- Planning → **Planner**
- Testing → **Tester**
- Debugging → **Debugger**

### 2. Provide Context
Always include relevant context in the `context` field:
```json
{
  "task": "Fix the validation error",
  "context": "User registration form, email validation failing for .co domains"
}
```

### 3. Use Parallel Execution Wisely
- **Parallel**: Independent tasks that don't depend on each other
- **Sequential**: Tasks that build on previous results
- **Priority**: Mixed dependencies with critical path

### 4. Start with Preview Mode
Test tasks in preview mode first:
1. Run with `enable_execution: false`
2. Review the generated actions
3. If safe, run again with `enable_execution: true`

### 5. Set Appropriate Timeouts
Adjust timeout based on task complexity:
- Simple tasks: 60-120 seconds
- Complex workflows: 300-600 seconds
- Heavy automation: 600+ seconds

## Troubleshooting

### Agent Not Responding
- Check API key configuration
- Verify screen accessibility
- Ensure sufficient timeout

### Actions Not Executing
- Confirm `enable_execution: true`
- Check permissions and access
- Verify the target application is accessible

### Poor Performance
- Provide more specific tasks
- Include better context
- Use appropriate persona for the task
- Try sequential mode for complex workflows

## API Reference

See the source code for detailed API documentation:
- `agent_s_personas.py` - Individual persona implementations
- `agent_s_orchestrator.py` - Parallel execution orchestrator
- `tool_manager.py` - Tool registration and configuration

## Future Enhancements

Planned features:
- [ ] Custom persona creation
- [ ] Memory and learning across sessions
- [ ] Tool result sharing between agents
- [ ] Visual feedback and progress tracking
- [ ] Advanced coordination patterns
