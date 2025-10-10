"""Agent-S Orchestrator for parallel multi-agent execution.

This module provides orchestration capabilities for running multiple Agent-S personas
in parallel, enabling complex workflows that leverage different specialized agents simultaneously.
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass

from ii_agent.llm.message_history import MessageHistory
from ii_agent.tools.base import LLMTool, ToolImplOutput
from ii_agent.core.storage.models.settings import Settings
from ii_agent.tools.agent_s_personas import (
    AgentSPersona,
    AgentSPlannerTool,
    AgentSCoderTool,
    AgentSTesterTool,
    AgentSDebuggerTool,
    AgentSDesignerTool,
    AgentSResearcherTool,
    AgentSAutomatorTool,
    AgentSAnalystTool,
)
from ii_agent.tools.agent_s_config import (
    DEFAULT_TIMEOUT_CONFIG,
    estimate_orchestrator_complexity,
    get_config_for_environment,
)

logger = logging.getLogger(__name__)


@dataclass
class AgentTask:
    """A task to be executed by a specific agent persona."""
    persona: str  # e.g., "planner", "coder", "tester"
    task: str
    context: str = ""
    enable_execution: bool = False
    priority: int = 0  # Higher priority runs first


class AgentSOrchestratorTool(LLMTool):
    """Orchestrator tool for running multiple Agent-S personas in parallel.

    This tool enables complex workflows by coordinating multiple specialized agents
    to work on different aspects of a problem simultaneously.
    """

    name = "agent_s_orchestrator"
    description = """Orchestrate multiple specialized Agent-S agents to work in parallel on complex tasks.

    This tool allows you to:
    - Run multiple agents simultaneously (planner, coder, tester, etc.)
    - Coordinate complex workflows across different specializations
    - Gather insights from multiple perspectives
    - Execute parallel tasks efficiently

    Available agent personas:
    - planner: Task breakdown and workflow analysis
    - coder: Code writing and editing
    - tester: QA and validation
    - debugger: Bug finding and fixing
    - designer: UI/UX tasks
    - researcher: Information gathering
    - automator: Repetitive task automation
    - analyst: Data exploration and insights

    Example use cases:
    - Have planner create a plan while coder sets up the project structure
    - Run tester and debugger in parallel to validate and fix issues
    - Use researcher to gather info while designer works on mockups
    """

    input_schema = {
        "type": "object",
        "properties": {
            "tasks": {
                "type": "array",
                "description": "List of tasks to execute in parallel",
                "items": {
                    "type": "object",
                    "properties": {
                        "persona": {
                            "type": "string",
                            "enum": ["planner", "coder", "tester", "debugger", "designer", "researcher", "automator", "analyst"],
                            "description": "The agent persona to use for this task"
                        },
                        "task": {
                            "type": "string",
                            "description": "The task description for this agent"
                        },
                        "context": {
                            "type": "string",
                            "description": "Additional context for the task (optional)",
                            "default": ""
                        },
                        "enable_execution": {
                            "type": "boolean",
                            "description": "Whether to execute generated actions (default: false)",
                            "default": False
                        },
                        "priority": {
                            "type": "integer",
                            "description": "Task priority (higher runs first, default: 0)",
                            "default": 0
                        }
                    },
                    "required": ["persona", "task"]
                },
                "minItems": 1
            },
            "execution_mode": {
                "type": "string",
                "enum": ["parallel", "sequential", "priority"],
                "description": "How to execute tasks: parallel (all at once), sequential (one by one), priority (by priority order)",
                "default": "parallel"
            },
            "timeout_seconds": {
                "type": "integer",
                "description": "Maximum time to wait for all tasks to complete (optional, auto-calculated based on tasks and mode if not provided)",
                "default": None
            },
            "auto_scale_timeout": {
                "type": "boolean",
                "description": "Automatically scale timeout based on task complexity (default: true)",
                "default": True
            }
        },
        "required": ["tasks"]
    }

    def __init__(self, settings: Optional[Settings] = None, **kwargs):
        """Initialize the orchestrator.

        Args:
            settings: II-Agent settings containing API keys and configuration
            **kwargs: Additional configuration options
        """
        self.settings = settings

        # Initialize all persona tools
        self.persona_tools = {
            "planner": AgentSPlannerTool(settings=settings),
            "coder": AgentSCoderTool(settings=settings),
            "tester": AgentSTesterTool(settings=settings),
            "debugger": AgentSDebuggerTool(settings=settings),
            "designer": AgentSDesignerTool(settings=settings),
            "researcher": AgentSResearcherTool(settings=settings),
            "automator": AgentSAutomatorTool(settings=settings),
            "analyst": AgentSAnalystTool(settings=settings),
        }

    async def _execute_task(
        self,
        agent_task: AgentTask,
        message_history: Optional[MessageHistory] = None
    ) -> Tuple[str, ToolImplOutput]:
        """Execute a single agent task.

        Args:
            agent_task: The task to execute
            message_history: Optional message history

        Returns:
            Tuple of (persona, result)
        """
        tool = self.persona_tools[agent_task.persona]

        tool_input = {
            "task": agent_task.task,
            "context": agent_task.context,
            "enable_execution": agent_task.enable_execution
        }

        try:
            result = await tool.run_impl(tool_input, message_history)
            return (agent_task.persona, result)
        except Exception as e:
            error_result = ToolImplOutput(
                tool_output=f"Error executing {agent_task.persona} task: {str(e)}",
                tool_result_message=f"Failed to execute {agent_task.persona} task",
                auxiliary_data={
                    "success": False,
                    "persona": agent_task.persona,
                    "error": str(e)
                }
            )
            return (agent_task.persona, error_result)

    async def _execute_parallel(
        self,
        tasks: List[AgentTask],
        timeout_seconds: int,
        message_history: Optional[MessageHistory] = None
    ) -> List[Tuple[str, ToolImplOutput]]:
        """Execute tasks in parallel.

        Args:
            tasks: List of tasks to execute
            timeout_seconds: Maximum time to wait
            message_history: Optional message history

        Returns:
            List of (persona, result) tuples
        """
        try:
            results = await asyncio.wait_for(
                asyncio.gather(
                    *[self._execute_task(task, message_history) for task in tasks],
                    return_exceptions=True
                ),
                timeout=timeout_seconds
            )

            # Handle any exceptions that were raised
            processed_results = []
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    persona = tasks[i].persona
                    error_result = ToolImplOutput(
                        tool_output=f"Error in {persona}: {str(result)}",
                        tool_result_message=f"Failed to execute {persona} task",
                        auxiliary_data={"success": False, "persona": persona, "error": str(result)}
                    )
                    processed_results.append((persona, error_result))
                else:
                    processed_results.append(result)

            return processed_results
        except asyncio.TimeoutError:
            logger.error(f"Parallel execution timed out after {timeout_seconds} seconds")
            return [
                (task.persona, ToolImplOutput(
                    tool_output=f"Task timed out after {timeout_seconds} seconds",
                    tool_result_message="Task execution timed out",
                    auxiliary_data={"success": False, "persona": task.persona, "timeout": True}
                ))
                for task in tasks
            ]

    async def _execute_sequential(
        self,
        tasks: List[AgentTask],
        timeout_seconds: int,
        message_history: Optional[MessageHistory] = None
    ) -> List[Tuple[str, ToolImplOutput]]:
        """Execute tasks sequentially.

        Args:
            tasks: List of tasks to execute
            timeout_seconds: Maximum time to wait
            message_history: Optional message history

        Returns:
            List of (persona, result) tuples
        """
        results = []
        start_time = asyncio.get_event_loop().time()

        for task in tasks:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed >= timeout_seconds:
                logger.warning(f"Sequential execution timed out after {elapsed:.1f}s")
                # Add timeout results for remaining tasks
                for remaining_task in tasks[len(results):]:
                    results.append((
                        remaining_task.persona,
                        ToolImplOutput(
                            tool_output="Task skipped due to timeout",
                            tool_result_message="Task execution timed out",
                            auxiliary_data={"success": False, "persona": remaining_task.persona, "timeout": True}
                        )
                    ))
                break

            result = await self._execute_task(task, message_history)
            results.append(result)

        return results

    async def _execute_priority(
        self,
        tasks: List[AgentTask],
        timeout_seconds: int,
        message_history: Optional[MessageHistory] = None
    ) -> List[Tuple[str, ToolImplOutput]]:
        """Execute tasks in priority order (highest priority first).

        Args:
            tasks: List of tasks to execute
            timeout_seconds: Maximum time to wait
            message_history: Optional message history

        Returns:
            List of (persona, result) tuples
        """
        # Sort tasks by priority (descending)
        sorted_tasks = sorted(tasks, key=lambda t: t.priority, reverse=True)
        return await self._execute_sequential(sorted_tasks, timeout_seconds, message_history)

    async def run_impl(
        self,
        tool_input: dict[str, Any],
        message_history: Optional[MessageHistory] = None,
    ) -> ToolImplOutput:
        """Execute the orchestrated multi-agent workflow.

        Args:
            tool_input: Dictionary containing tasks and execution configuration
            message_history: Optional message history

        Returns:
            ToolImplOutput with aggregated results from all agents
        """
        tasks_data = tool_input["tasks"]
        execution_mode = tool_input.get("execution_mode", "parallel")
        user_timeout = tool_input.get("timeout_seconds")
        auto_scale = tool_input.get("auto_scale_timeout", True)

        # Parse tasks
        tasks = [
            AgentTask(
                persona=task["persona"],
                task=task["task"],
                context=task.get("context", ""),
                enable_execution=task.get("enable_execution", False),
                priority=task.get("priority", 0)
            )
            for task in tasks_data
        ]

        # Calculate intelligent timeout if not provided
        if user_timeout is None and auto_scale:
            # Estimate overall complexity
            complexity = estimate_orchestrator_complexity(tasks_data)

            # Calculate timeout based on number of tasks and execution mode
            timeout_seconds = DEFAULT_TIMEOUT_CONFIG.get_orchestrator_timeout(
                num_tasks=len(tasks),
                complexity=complexity,
                execution_mode=execution_mode
            )
            logger.info(
                f"Auto-calculated orchestrator timeout: {timeout_seconds}s "
                f"({complexity.value} complexity, {execution_mode} mode, {len(tasks)} tasks)"
            )
        elif user_timeout is not None:
            timeout_seconds = user_timeout
            logger.info(f"Using user-provided timeout: {timeout_seconds}s")
        else:
            # Fallback to moderate default if auto_scale is disabled
            timeout_seconds = 600
            logger.info(f"Using default timeout: {timeout_seconds}s (auto_scale disabled)")

        logger.info(f"Orchestrating {len(tasks)} tasks in {execution_mode} mode (timeout: {timeout_seconds}s)")

        # Execute based on mode
        if execution_mode == "parallel":
            results = await self._execute_parallel(tasks, timeout_seconds, message_history)
        elif execution_mode == "sequential":
            results = await self._execute_sequential(tasks, timeout_seconds, message_history)
        elif execution_mode == "priority":
            results = await self._execute_priority(tasks, timeout_seconds, message_history)
        else:
            raise ValueError(f"Invalid execution_mode: {execution_mode}")

        # Aggregate results
        success_count = sum(1 for _, result in results if result.auxiliary_data.get("success", False))
        total_count = len(results)

        output_parts = [
            f"# 🎭 Agent-S Orchestrator Results",
            f"\n**Execution Mode:** {execution_mode}",
            f"**Tasks Completed:** {success_count}/{total_count}",
            f"\n---\n"
        ]

        for persona, result in results:
            output_parts.append(f"\n## {persona.upper()} Agent\n")
            output_parts.append(result.tool_output)
            output_parts.append("\n---\n")

        final_output = "\n".join(output_parts)

        result_message = f"Orchestrator completed {success_count}/{total_count} tasks successfully in {execution_mode} mode"

        return ToolImplOutput(
            tool_output=final_output,
            tool_result_message=result_message,
            auxiliary_data={
                "success": success_count == total_count,
                "total_tasks": total_count,
                "successful_tasks": success_count,
                "failed_tasks": total_count - success_count,
                "execution_mode": execution_mode,
                "results": [
                    {
                        "persona": persona,
                        "success": result.auxiliary_data.get("success", False),
                        "message": result.tool_result_message
                    }
                    for persona, result in results
                ]
            }
        )
