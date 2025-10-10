"""
Examples of using Agent-S Persona System for parallel multi-agent workflows.

These examples demonstrate how to leverage different specialized Agent-S personas
for various tasks, both individually and in parallel orchestration.
"""

import asyncio
from ii_agent.tools.agent_s_personas import (
    AgentSPlannerTool,
    AgentSCoderTool,
    AgentSTesterTool,
)
from ii_agent.tools.agent_s_orchestrator import AgentSOrchestratorTool


async def example_single_persona():
    """Example 1: Using a single persona tool."""
    print("\n=== Example 1: Single Persona ===\n")

    # Use the planner persona to analyze a task
    planner = AgentSPlannerTool(settings=None)

    result = await planner.run_impl({
        "task": "Analyze the file structure and create a plan to add a new feature",
        "context": "Working on a React application in VS Code",
        "enable_execution": False  # Preview mode - just show the plan
    })

    print(result.tool_output)


async def example_parallel_development():
    """Example 2: Parallel development workflow with planner and coder."""
    print("\n=== Example 2: Parallel Development ===\n")

    orchestrator = AgentSOrchestratorTool(settings=None)

    result = await orchestrator.run_impl({
        "tasks": [
            {
                "persona": "planner",
                "task": "Create a detailed implementation plan for user authentication",
                "context": "Building a new auth module",
                "priority": 10
            },
            {
                "persona": "coder",
                "task": "Set up the basic file structure for auth components",
                "context": "React + TypeScript project",
                "priority": 9
            },
            {
                "persona": "researcher",
                "task": "Find examples of secure authentication patterns in the docs",
                "context": "Looking for JWT and OAuth2 examples",
                "priority": 8
            }
        ],
        "execution_mode": "parallel",  # Run all at once
        "timeout_seconds": 300
    })

    print(result.tool_output)


async def example_testing_workflow():
    """Example 3: Testing workflow with tester, debugger, and analyst."""
    print("\n=== Example 3: Testing Workflow ===\n")

    orchestrator = AgentSOrchestratorTool(settings=None)

    result = await orchestrator.run_impl({
        "tasks": [
            {
                "persona": "tester",
                "task": "Run all unit tests and check for failures",
                "context": "Testing the new payment module"
            },
            {
                "persona": "debugger",
                "task": "Investigate any test failures and check console logs",
                "context": "Payment validation tests"
            },
            {
                "persona": "analyst",
                "task": "Analyze test coverage metrics and identify gaps",
                "context": "Code coverage dashboard"
            }
        ],
        "execution_mode": "sequential",  # Run in order to handle failures
        "timeout_seconds": 600
    })

    print(result.tool_output)


async def example_design_review():
    """Example 4: Design review with designer, tester, and analyst."""
    print("\n=== Example 4: Design Review ===\n")

    orchestrator = AgentSOrchestratorTool(settings=None)

    result = await orchestrator.run_impl({
        "tasks": [
            {
                "persona": "designer",
                "task": "Review the new dashboard layout for visual consistency",
                "context": "Following Material Design guidelines"
            },
            {
                "persona": "tester",
                "task": "Test responsive behavior on mobile and tablet views",
                "context": "Dashboard responsiveness"
            },
            {
                "persona": "analyst",
                "task": "Check user engagement metrics on the current dashboard",
                "context": "Analytics dashboard showing user interactions"
            }
        ],
        "execution_mode": "parallel",
        "timeout_seconds": 300
    })

    print(result.tool_output)


async def example_bug_investigation():
    """Example 5: Priority-based bug investigation."""
    print("\n=== Example 5: Bug Investigation (Priority) ===\n")

    orchestrator = AgentSOrchestratorTool(settings=None)

    result = await orchestrator.run_impl({
        "tasks": [
            {
                "persona": "debugger",
                "task": "Investigate the 500 error in the API logs",
                "context": "User reports payment failures",
                "priority": 100  # Highest priority - do this first
            },
            {
                "persona": "tester",
                "task": "Try to reproduce the bug with test data",
                "context": "Testing payment flow",
                "priority": 90
            },
            {
                "persona": "researcher",
                "task": "Search for similar issues in GitHub and Stack Overflow",
                "context": "Payment processing errors",
                "priority": 70
            },
            {
                "persona": "analyst",
                "task": "Check error rate metrics and user impact",
                "context": "Error monitoring dashboard",
                "priority": 50
            }
        ],
        "execution_mode": "priority",  # Run by priority order
        "timeout_seconds": 600
    })

    print(result.tool_output)


async def example_automation_workflow():
    """Example 6: Automation workflow with automator persona."""
    print("\n=== Example 6: Automation Workflow ===\n")

    orchestrator = AgentSOrchestratorTool(settings=None)

    result = await orchestrator.run_impl({
        "tasks": [
            {
                "persona": "automator",
                "task": "Batch rename all component files from .js to .tsx",
                "context": "TypeScript migration in src/components",
                "enable_execution": False  # Preview first!
            },
            {
                "persona": "automator",
                "task": "Add TypeScript type annotations to all exported functions",
                "context": "Type safety improvement",
                "enable_execution": False
            },
            {
                "persona": "tester",
                "task": "Run TypeScript compiler to check for type errors",
                "context": "Migration validation"
            }
        ],
        "execution_mode": "sequential",  # Do one at a time
        "timeout_seconds": 900
    })

    print(result.tool_output)


async def example_full_stack_feature():
    """Example 7: Complete full-stack feature development."""
    print("\n=== Example 7: Full-Stack Feature Development ===\n")

    orchestrator = AgentSOrchestratorTool(settings=None)

    result = await orchestrator.run_impl({
        "tasks": [
            {
                "persona": "planner",
                "task": "Create implementation plan for new dashboard widget",
                "context": "Adding real-time notifications widget",
                "priority": 100
            },
            {
                "persona": "researcher",
                "task": "Find best practices for WebSocket integration",
                "context": "Real-time data updates",
                "priority": 90
            },
            {
                "persona": "coder",
                "task": "Implement backend WebSocket server",
                "context": "Node.js + Socket.io",
                "priority": 80,
                "enable_execution": False
            },
            {
                "persona": "coder",
                "task": "Create React component for notifications widget",
                "context": "React + hooks",
                "priority": 70,
                "enable_execution": False
            },
            {
                "persona": "designer",
                "task": "Style the notifications widget following design system",
                "context": "Material-UI components",
                "priority": 60
            },
            {
                "persona": "tester",
                "task": "Write unit tests for notification logic",
                "context": "Jest + React Testing Library",
                "priority": 50
            },
            {
                "persona": "tester",
                "task": "Test WebSocket connection and reconnection logic",
                "context": "Connection reliability",
                "priority": 40
            }
        ],
        "execution_mode": "priority",  # Follow the development sequence
        "timeout_seconds": 1800  # 30 minutes for complex feature
    })

    print(result.tool_output)


# Main execution
if __name__ == "__main__":
    print("=" * 80)
    print("Agent-S Persona System Examples")
    print("=" * 80)
    print("\nThese examples demonstrate various Agent-S persona workflows.")
    print("Note: Running in preview mode by default (no actual execution)")
    print("\nAvailable examples:")
    print("1. Single persona usage")
    print("2. Parallel development workflow")
    print("3. Testing workflow")
    print("4. Design review")
    print("5. Bug investigation (priority-based)")
    print("6. Automation workflow")
    print("7. Full-stack feature development")
    print("\n" + "=" * 80 + "\n")

    # Run examples
    # Uncomment the examples you want to run:

    # asyncio.run(example_single_persona())
    # asyncio.run(example_parallel_development())
    # asyncio.run(example_testing_workflow())
    # asyncio.run(example_design_review())
    # asyncio.run(example_bug_investigation())
    # asyncio.run(example_automation_workflow())
    # asyncio.run(example_full_stack_feature())

    print("\nTo run these examples:")
    print("1. Ensure Agent-S is installed: pip install gui-agents")
    print("2. Configure API keys in II-Agent settings")
    print("3. Enable agent_s in tool_args")
    print("4. Uncomment the example you want to run above")
    print("\nFor safety, all examples run in preview mode by default.")
    print("Set enable_execution=True to actually execute actions.\n")
