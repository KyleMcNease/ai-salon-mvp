"""OpenAI Codex CLI tool for executing code generation and analysis tasks.

This tool provides access to OpenAI's Codex API through a CLI interface,
allowing the agent to leverage OpenAI's code generation capabilities
for specialized coding tasks.
"""

from typing import Any, Optional
import subprocess
import json
import logging

from ii_agent.core.storage.models.settings import Settings
from ii_agent.tools.base import (
    ToolImplOutput,
    LLMTool,
)
from ii_agent.llm.message_history import MessageHistory

logger = logging.getLogger(__name__)


class OpenAICodexTool(LLMTool):
    """Tool for calling OpenAI Codex CLI from within the ii-agent interface.

    This tool allows users to interact with OpenAI's Codex API for code generation,
    code completion, code explanation, and other code-related tasks through a
    command-line interface.
    """

    name = "openai_codex_cli"
    description = (
        "Execute OpenAI Codex CLI commands for code generation, completion, and analysis. "
        "This tool provides access to OpenAI's powerful code models for specialized coding tasks. "
        "Use this when you need advanced code generation, refactoring suggestions, or code analysis "
        "that benefits from OpenAI's Codex capabilities."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": "The prompt or instruction for Codex to process. This can be a code generation request, completion request, or code analysis task.",
            },
            "language": {
                "type": "string",
                "description": "The programming language for the code (e.g., 'python', 'javascript', 'typescript', 'java', 'go'). Optional.",
            },
            "max_tokens": {
                "type": "integer",
                "description": "Maximum number of tokens to generate. Default is 256.",
                "default": 256,
            },
            "temperature": {
                "type": "number",
                "description": "Controls randomness. Lower values (0.0-0.3) are more focused, higher values (0.7-1.0) are more creative. Default is 0.0.",
                "default": 0.0,
            },
        },
        "required": ["prompt"],
    }

    def __init__(self, settings: Settings):
        super().__init__()
        self.settings = settings

    def _get_api_key(self) -> Optional[str]:
        """Get the OpenAI API key from settings."""
        return (
            self.settings.third_party_integration_config.openai_api_key.get_secret_value()
            if self.settings.third_party_integration_config.openai_api_key
            else None
        )

    def is_available(self) -> bool:
        """Check if the tool is available (has API key configured)."""
        return self._get_api_key() is not None

    async def run_impl(
        self,
        tool_input: dict[str, Any],
        message_history: Optional[MessageHistory] = None,
    ) -> ToolImplOutput:
        """Execute OpenAI Codex CLI command.

        Args:
            tool_input: Dictionary containing the prompt and optional parameters
            message_history: Optional message history for context

        Returns:
            ToolImplOutput containing the Codex response
        """
        api_key = self._get_api_key()

        if not api_key:
            return ToolImplOutput(
                tool_output="",
                tool_result_message="OpenAI API key not configured. Please add your OpenAI API key in settings.",
                auxiliary_data={"success": False, "error": "API key not configured"},
            )

        prompt = tool_input.get("prompt", "")
        language = tool_input.get("language", "")
        max_tokens = tool_input.get("max_tokens", 256)
        temperature = tool_input.get("temperature", 0.0)

        if not prompt:
            return ToolImplOutput(
                tool_output="",
                tool_result_message="Error: prompt is required",
                auxiliary_data={"success": False, "error": "Missing prompt"},
            )

        try:
            # Use OpenAI Python SDK to call Codex (code-davinci-002 or gpt-4 for code)
            # For now, we'll use a direct API call approach via curl for CLI simulation
            # In production, you might want to use the openai Python package

            import openai
            openai.api_key = api_key

            # Construct the full prompt with language context if provided
            full_prompt = prompt
            if language:
                full_prompt = f"# Language: {language}\n\n{prompt}"

            # Call OpenAI API (using chat completion for more modern approach)
            response = openai.ChatCompletion.create(
                model="gpt-4",  # Using GPT-4 for code tasks (more reliable than old Codex)
                messages=[
                    {"role": "system", "content": "You are an expert programmer and code assistant. Provide clear, correct, and well-commented code."},
                    {"role": "user", "content": full_prompt}
                ],
                max_tokens=max_tokens,
                temperature=temperature,
            )

            result = response.choices[0].message.content

            logger.info(f"OpenAI Codex CLI executed successfully for prompt: {prompt[:100]}...")

            return ToolImplOutput(
                tool_output=result,
                tool_result_message=f"OpenAI Codex executed successfully. Generated {len(result)} characters of code/response.",
                auxiliary_data={
                    "success": True,
                    "model": response.model,
                    "tokens_used": response.usage.total_tokens,
                    "language": language or "unspecified",
                },
            )

        except ImportError:
            error_msg = "OpenAI Python package not installed. Install it with: pip install openai"
            logger.error(error_msg)
            return ToolImplOutput(
                tool_output="",
                tool_result_message=error_msg,
                auxiliary_data={"success": False, "error": "Missing openai package"},
            )

        except Exception as e:
            error_msg = f"Error calling OpenAI Codex: {str(e)}"
            logger.error(error_msg)
            return ToolImplOutput(
                tool_output="",
                tool_result_message=error_msg,
                auxiliary_data={"success": False, "error": str(e)},
            )
