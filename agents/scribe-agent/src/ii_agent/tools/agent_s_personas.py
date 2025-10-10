"""Agent-S Persona-based tools for specialized computer control tasks.

This module provides multiple Agent-S instances with different personas and specializations,
allowing parallel execution of different types of computer control tasks.
"""

import asyncio
import logging
from typing import Any, Optional
import platform
from enum import Enum

from ii_agent.llm.message_history import MessageHistory
from ii_agent.tools.base import LLMTool, ToolImplOutput
from ii_agent.core.storage.models.settings import Settings
from ii_agent.tools.agent_s_config import (
    DEFAULT_TIMEOUT_CONFIG,
    get_timeout_for_task_description,
    get_config_for_environment,
)

logger = logging.getLogger(__name__)


class AgentSPersona(Enum):
    """Available Agent-S personas for different task types."""
    PLANNER = "planner"
    CODER = "coder"
    TESTER = "tester"
    DEBUGGER = "debugger"
    DESIGNER = "designer"
    RESEARCHER = "researcher"
    AUTOMATOR = "automator"
    ANALYST = "analyst"


PERSONA_CONFIGS = {
    AgentSPersona.PLANNER: {
        "name": "agent_s_planner",
        "description": """Expert planning agent that analyzes complex workflows and breaks them down into actionable steps.
        Use this agent to:
        - Create detailed project plans and task breakdowns
        - Analyze UI/UX flows and identify navigation paths
        - Map out testing strategies
        - Design automation sequences
        The planner will analyze the screen and provide step-by-step execution plans.""",
        "system_context": "You are an expert project planner and workflow architect. Analyze tasks systematically and create detailed, executable plans.",
    },
    AgentSPersona.CODER: {
        "name": "agent_s_coder",
        "description": """Expert coding agent specialized in writing, editing, and organizing code.
        Use this agent to:
        - Write code in editors (VS Code, IDEs)
        - Navigate through codebases
        - Refactor and improve existing code
        - Set up development environments
        The coder understands programming paradigms and best practices.""",
        "system_context": "You are an expert software engineer. Write clean, efficient code following best practices. Understand IDE shortcuts and development workflows.",
    },
    AgentSPersona.TESTER: {
        "name": "agent_s_tester",
        "description": """Expert testing agent specialized in QA and validation tasks.
        Use this agent to:
        - Execute test cases and verify functionality
        - Perform exploratory testing
        - Validate UI/UX elements
        - Check for bugs and edge cases
        The tester is thorough and detail-oriented.""",
        "system_context": "You are an expert QA engineer. Test thoroughly, check edge cases, and validate that features work as expected.",
    },
    AgentSPersona.DEBUGGER: {
        "name": "agent_s_debugger",
        "description": """Expert debugging agent specialized in finding and fixing issues.
        Use this agent to:
        - Investigate errors and exceptions
        - Set breakpoints and inspect variables
        - Trace execution flows
        - Identify root causes of bugs
        The debugger is analytical and persistent.""",
        "system_context": "You are an expert debugger. Systematically investigate issues, use debugging tools effectively, and identify root causes.",
    },
    AgentSPersona.DESIGNER: {
        "name": "agent_s_designer",
        "description": """Expert design agent specialized in UI/UX tasks.
        Use this agent to:
        - Arrange and style UI elements
        - Test visual layouts and responsive design
        - Navigate design tools (Figma, Sketch, etc.)
        - Validate accessibility and usability
        The designer has an eye for aesthetics and user experience.""",
        "system_context": "You are an expert UI/UX designer. Focus on visual hierarchy, accessibility, and user experience. Understand design principles and tools.",
    },
    AgentSPersona.RESEARCHER: {
        "name": "agent_s_researcher",
        "description": """Expert research agent specialized in information gathering.
        Use this agent to:
        - Navigate documentation and references
        - Gather information from multiple sources
        - Compare and analyze options
        - Extract and organize data
        The researcher is thorough and organized.""",
        "system_context": "You are an expert researcher. Gather comprehensive information, cross-reference sources, and organize findings systematically.",
    },
    AgentSPersona.AUTOMATOR: {
        "name": "agent_s_automator",
        "description": """Expert automation agent specialized in repetitive tasks.
        Use this agent to:
        - Automate repetitive workflows
        - Batch process multiple items
        - Set up automation scripts and tools
        - Optimize and streamline processes
        The automator is efficient and precise.""",
        "system_context": "You are an expert automation engineer. Identify patterns, eliminate manual steps, and create efficient automated workflows.",
    },
    AgentSPersona.ANALYST: {
        "name": "agent_s_analyst",
        "description": """Expert data analyst specialized in data exploration and insights.
        Use this agent to:
        - Analyze data and metrics
        - Create visualizations and reports
        - Extract insights from dashboards
        - Compare and validate data
        The analyst is data-driven and insightful.""",
        "system_context": "You are an expert data analyst. Extract meaningful insights, understand metrics, and communicate findings clearly.",
    },
}


class AgentSPersonaTool(LLMTool):
    """Base class for persona-based Agent-S tools."""

    def __init__(
        self,
        persona: AgentSPersona,
        settings: Optional[Settings] = None,
        **kwargs
    ):
        """Initialize Agent-S persona tool.

        Args:
            persona: The persona type for this agent
            settings: II-Agent settings containing API keys and configuration
            **kwargs: Additional configuration options
        """
        self.persona = persona
        self.settings = settings
        self.agent = None
        self.current_platform = platform.system().lower()
        self._initialized = False

        # Set name and description from persona config
        config = PERSONA_CONFIGS[persona]
        self.name = config["name"]
        self.description = config["description"]
        self.system_context = config["system_context"]

        # Define input schema
        self.input_schema = {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": f"Task description for the {persona.value} agent to execute"
                },
                "context": {
                    "type": "string",
                    "description": "Additional context about the current state or goals (optional)",
                    "default": ""
                },
                "enable_execution": {
                    "type": "boolean",
                    "description": "Whether to execute the generated actions (default: false for safety)",
                    "default": False
                },
                "timeout": {
                    "type": "integer",
                    "description": "Maximum time in seconds to wait for task completion (optional, auto-calculated if not provided)",
                    "default": None
                }
            },
            "required": ["task"],
        }

    def _initialize_agent(self):
        """Lazy initialization of Agent-S components with persona context."""
        if self._initialized:
            return

        try:
            # Import Agent-S components
            from gui_agents.s3.agents.agent_s import AgentS3
            from gui_agents.s3.agents.grounding import OSWorldACI
            import pyautogui

            self.pyautogui = pyautogui

            # Determine which LLM provider to use based on settings
            provider = "anthropic"  # Default to Anthropic
            model = "claude-sonnet-4-20250514"
            api_key = None

            if self.settings:
                # Try to use Anthropic if available
                if self.settings.anthropic_api_key:
                    provider = "anthropic"
                    api_key = self.settings.anthropic_api_key
                    model = self.settings.model or "claude-sonnet-4-20250514"
                # Fallback to OpenAI
                elif hasattr(self.settings, 'third_party_integration_config') and \
                     self.settings.third_party_integration_config.openai_api_key:
                    provider = "openai"
                    api_key = self.settings.third_party_integration_config.openai_api_key
                    model = "gpt-4o"

            # Configure engine parameters
            engine_params = {
                "engine_type": provider,
                "model": model,
            }
            if api_key:
                engine_params["api_key"] = api_key

            # For now, use the same model for grounding
            engine_params_for_grounding = engine_params.copy()

            # Initialize grounding agent
            grounding_agent = OSWorldACI(
                platform=self.current_platform,
                engine_params_for_generation=engine_params,
                engine_params_for_grounding=engine_params_for_grounding
            )

            # Initialize Agent-S
            self.agent = AgentS3(
                engine_params,
                grounding_agent,
                platform=self.current_platform
            )

            self._initialized = True
            logger.info(f"Agent-S {self.persona.value} initialized with provider: {provider}, model: {model}")

        except ImportError as e:
            logger.error(f"Failed to import Agent-S components: {e}")
            raise RuntimeError(
                "Agent-S (gui-agents) is not installed. "
                "Install it with: pip install gui-agents"
            )
        except Exception as e:
            logger.error(f"Failed to initialize Agent-S {self.persona.value}: {e}")
            raise RuntimeError(f"Agent-S {self.persona.value} initialization failed: {str(e)}")

    async def run_impl(
        self,
        tool_input: dict[str, Any],
        message_history: Optional[MessageHistory] = None,
    ) -> ToolImplOutput:
        """Execute a persona-specific Agent-S task.

        Args:
            tool_input: Dictionary containing 'task', optional 'context', and 'enable_execution'
            message_history: Optional message history (not used)

        Returns:
            ToolImplOutput with the result of the Agent-S execution
        """
        task = tool_input["task"]
        context = tool_input.get("context", "")
        enable_execution = tool_input.get("enable_execution", False)
        user_timeout = tool_input.get("timeout")

        # Calculate intelligent timeout if not provided
        if user_timeout is None:
            # Infer complexity from task description
            task_complexity = get_timeout_for_task_description(task)
            # Get timeout for this persona and complexity
            timeout = DEFAULT_TIMEOUT_CONFIG.get_timeout(
                complexity=task_complexity,
                persona=self.persona.value
            )
            logger.info(
                f"Auto-calculated timeout: {timeout}s for {task_complexity.value} "
                f"{self.persona.value} task"
            )
        else:
            timeout = user_timeout
            logger.info(f"Using user-provided timeout: {timeout}s")

        # Build instruction with persona context
        instruction = f"{self.system_context}\n\nTask: {task}"
        if context:
            instruction += f"\n\nContext: {context}"

        try:
            # Initialize agent if needed
            self._initialize_agent()

            # Capture current screenshot
            screenshot = self.pyautogui.screenshot()
            observation = {"screenshot": screenshot}

            # Get prediction from Agent-S
            logger.info(f"Agent-S {self.persona.value} executing: {task} (timeout: {timeout}s)")

            # Run prediction in thread pool with timeout
            loop = asyncio.get_event_loop()
            info, action = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    self.agent.predict,
                    instruction,
                    observation
                ),
                timeout=timeout
            )

            # Execute the action
            if action and len(action) > 0:
                action_code = action[0]

                # Security check - only execute if explicitly enabled
                if enable_execution:
                    logger.warning(f"Executing Agent-S {self.persona.value} generated code: {action_code}")
                    try:
                        exec(action_code)
                        result_message = f"{self.persona.value.capitalize()} successfully executed task: {task}"
                        tool_output = f"""**{self.persona.value.upper()} Agent Result:**

Task: {task}

✅ Action completed successfully

Action taken:
```python
{action_code}
```

Info: {info}"""
                        success = True
                    except Exception as exec_error:
                        result_message = f"{self.persona.value.capitalize()} failed to execute action: {str(exec_error)}"
                        tool_output = f"""**{self.persona.value.upper()} Agent Result:**

Task: {task}

❌ Execution failed: {str(exec_error)}

Generated action:
```python
{action_code}
```"""
                        success = False
                else:
                    # Return action for manual review
                    result_message = f"{self.persona.value.capitalize()} generated action plan (not executed - set enable_execution=true to execute)"
                    tool_output = f"""**{self.persona.value.upper()} Agent Plan:**

Task: {task}

📋 Generated action plan (not executed for safety):

```python
{action_code}
```

**To execute this action:** Call this tool again with `enable_execution=true`

Info: {info}"""
                    success = True
            else:
                result_message = f"{self.persona.value.capitalize()} could not determine action for: {task}"
                tool_output = f"""**{self.persona.value.upper()} Agent Result:**

Task: {task}

⚠️ No action generated

Info: {info}"""
                success = False

            return ToolImplOutput(
                tool_output=tool_output,
                tool_result_message=result_message,
                auxiliary_data={
                    "success": success,
                    "persona": self.persona.value,
                    "task": task,
                    "action": action,
                    "info": info,
                    "executed": enable_execution
                }
            )

        except asyncio.TimeoutError:
            timeout_msg = (
                f"Agent-S {self.persona.value} task timed out after {timeout}s. "
                f"Consider breaking down complex tasks or increasing timeout."
            )
            logger.warning(timeout_msg)
            return ToolImplOutput(
                tool_output=f"""**{self.persona.value.upper()} Agent Timeout:**

Task: {task}

⏱️ Operation timed out after {timeout} seconds

**Suggestions:**
1. Break the task into smaller steps
2. Provide a longer timeout: `"timeout": {timeout * 2}`
3. Simplify the task requirements

The task may be too complex for a single operation.""",
                tool_result_message=f"{self.persona.value.capitalize()} task timed out: {task}",
                auxiliary_data={
                    "success": False,
                    "persona": self.persona.value,
                    "timeout": timeout,
                    "task": task,
                    "error_type": "timeout"
                }
            )
        except Exception as e:
            error_msg = f"Agent-S {self.persona.value} execution failed: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return ToolImplOutput(
                tool_output=f"**{self.persona.value.upper()} Agent Error:**\n\n{error_msg}",
                tool_result_message=f"Failed to execute {self.persona.value} task: {task}",
                auxiliary_data={
                    "success": False,
                    "persona": self.persona.value,
                    "error": str(e),
                    "task": task,
                    "error_type": "exception"
                }
            )


# Create concrete tool classes for each persona
class AgentSPlannerTool(AgentSPersonaTool):
    """Expert planning agent for task breakdown and workflow analysis."""
    def __init__(self, settings: Optional[Settings] = None, **kwargs):
        super().__init__(AgentSPersona.PLANNER, settings, **kwargs)


class AgentSCoderTool(AgentSPersonaTool):
    """Expert coding agent for writing and editing code."""
    def __init__(self, settings: Optional[Settings] = None, **kwargs):
        super().__init__(AgentSPersona.CODER, settings, **kwargs)


class AgentSTesterTool(AgentSPersonaTool):
    """Expert testing agent for QA and validation."""
    def __init__(self, settings: Optional[Settings] = None, **kwargs):
        super().__init__(AgentSPersona.TESTER, settings, **kwargs)


class AgentSDebuggerTool(AgentSPersonaTool):
    """Expert debugging agent for finding and fixing issues."""
    def __init__(self, settings: Optional[Settings] = None, **kwargs):
        super().__init__(AgentSPersona.DEBUGGER, settings, **kwargs)


class AgentSDesignerTool(AgentSPersonaTool):
    """Expert design agent for UI/UX tasks."""
    def __init__(self, settings: Optional[Settings] = None, **kwargs):
        super().__init__(AgentSPersona.DESIGNER, settings, **kwargs)


class AgentSResearcherTool(AgentSPersonaTool):
    """Expert research agent for information gathering."""
    def __init__(self, settings: Optional[Settings] = None, **kwargs):
        super().__init__(AgentSPersona.RESEARCHER, settings, **kwargs)


class AgentSAutomatorTool(AgentSPersonaTool):
    """Expert automation agent for repetitive tasks."""
    def __init__(self, settings: Optional[Settings] = None, **kwargs):
        super().__init__(AgentSPersona.AUTOMATOR, settings, **kwargs)


class AgentSAnalystTool(AgentSPersonaTool):
    """Expert data analyst agent for data exploration."""
    def __init__(self, settings: Optional[Settings] = None, **kwargs):
        super().__init__(AgentSPersona.ANALYST, settings, **kwargs)
