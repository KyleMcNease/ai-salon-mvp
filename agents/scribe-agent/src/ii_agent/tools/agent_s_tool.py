"""Agent-S Tool for computer control and GUI automation.

This tool integrates Agent-S (gui-agents) framework to enable autonomous computer
interaction through GUI control. Agent-S uses vision-language models to understand
screenshots and generate actions to control the computer.
"""

import asyncio
import logging
from typing import Any, Optional
import platform

from ii_agent.llm.message_history import MessageHistory
from ii_agent.tools.base import LLMTool, ToolImplOutput
from ii_agent.core.storage.models.settings import Settings

logger = logging.getLogger(__name__)


class AgentSTool(LLMTool):
    """Tool for executing computer control tasks using Agent-S framework.

    Agent-S is an agentic framework that uses computers like a human through
    visual understanding and action generation. It can perform tasks like:
    - Opening and closing applications
    - Navigating through GUIs
    - Clicking buttons, filling forms
    - Managing windows and tabs
    """

    name = "agent_s"
    description = """Execute computer control tasks using Agent-S visual GUI agent.
    This tool can understand your screen and perform actions like opening applications,
    clicking buttons, typing text, and navigating interfaces. Provide a natural language
    instruction describing what you want to do on the computer."""

    input_schema = {
        "type": "object",
        "properties": {
            "instruction": {
                "type": "string",
                "description": "Natural language instruction for what to do (e.g., 'Open VS Code', 'Click the submit button')"
            },
            "enable_local_env": {
                "type": "boolean",
                "description": "Whether to enable local code execution environment (default: false)",
                "default": False
            }
        },
        "required": ["instruction"],
    }

    def __init__(self, settings: Optional[Settings] = None, **kwargs):
        """Initialize Agent-S tool.

        Args:
            settings: II-Agent settings containing API keys and configuration
            **kwargs: Additional configuration options
        """
        self.settings = settings
        self.agent = None
        self.current_platform = platform.system().lower()

        # Lazy initialization - only load Agent-S when first used
        self._initialized = False

    def _initialize_agent(self):
        """Lazy initialization of Agent-S components."""
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
            # In production, you might want to use a specialized grounding model
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
            logger.info(f"Agent-S initialized with provider: {provider}, model: {model}")

        except ImportError as e:
            logger.error(f"Failed to import Agent-S components: {e}")
            raise RuntimeError(
                "Agent-S (gui-agents) is not installed. "
                "Install it with: pip install gui-agents"
            )
        except Exception as e:
            logger.error(f"Failed to initialize Agent-S: {e}")
            raise RuntimeError(f"Agent-S initialization failed: {str(e)}")

    async def run_impl(
        self,
        tool_input: dict[str, Any],
        message_history: Optional[MessageHistory] = None,
    ) -> ToolImplOutput:
        """Execute an Agent-S task.

        Args:
            tool_input: Dictionary containing 'instruction' and optional 'enable_local_env'
            message_history: Optional message history (not used)

        Returns:
            ToolImplOutput with the result of the Agent-S execution
        """
        instruction = tool_input["instruction"]
        enable_local_env = tool_input.get("enable_local_env", False)

        try:
            # Initialize agent if needed
            self._initialize_agent()

            # Capture current screenshot
            screenshot = self.pyautogui.screenshot()
            observation = {"screenshot": screenshot}

            # Get prediction from Agent-S
            logger.info(f"Agent-S executing: {instruction}")

            # Run prediction in thread pool since it's CPU-bound
            loop = asyncio.get_event_loop()
            info, action = await loop.run_in_executor(
                None,
                self.agent.predict,
                instruction,
                observation
            )

            # Execute the action
            if action and len(action) > 0:
                action_code = action[0]

                # Security check - only execute if explicitly enabled
                if enable_local_env:
                    logger.warning(f"Executing Agent-S generated code: {action_code}")
                    try:
                        exec(action_code)
                        result_message = f"Successfully executed instruction: {instruction}"
                        tool_output = f"Agent-S completed task: {instruction}\nAction taken: {action_code}\nInfo: {info}"
                        success = True
                    except Exception as exec_error:
                        result_message = f"Failed to execute action: {str(exec_error)}"
                        tool_output = f"Agent-S generated action but execution failed: {str(exec_error)}\nAction: {action_code}"
                        success = False
                else:
                    # Return action for manual review
                    result_message = f"Agent-S generated action (not executed - requires enable_local_env=true)"
                    tool_output = f"""Agent-S analyzed instruction: {instruction}

Generated action (not executed for safety):
```python
{action_code}
```

To execute this action, call the tool again with enable_local_env=true.

Info: {info}"""
                    success = True
            else:
                result_message = f"Agent-S could not determine action for: {instruction}"
                tool_output = f"No action generated for instruction: {instruction}\nInfo: {info}"
                success = False

            return ToolImplOutput(
                tool_output=tool_output,
                tool_result_message=result_message,
                auxiliary_data={
                    "success": success,
                    "instruction": instruction,
                    "action": action,
                    "info": info,
                    "executed": enable_local_env
                }
            )

        except Exception as e:
            error_msg = f"Agent-S execution failed: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return ToolImplOutput(
                tool_output=f"Error: {error_msg}",
                tool_result_message=f"Failed to execute Agent-S task: {instruction}",
                auxiliary_data={
                    "success": False,
                    "error": str(e),
                    "instruction": instruction
                }
            )
