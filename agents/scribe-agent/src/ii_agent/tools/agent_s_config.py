"""Configuration for Agent-S tools including timeouts, retries, and resource limits.

This module provides centralized configuration for Agent-S persona tools and orchestrator,
enabling appropriate timeouts for different workflow complexities.
"""

from enum import Enum
from dataclasses import dataclass
from typing import Optional


class TaskComplexity(Enum):
    """Task complexity levels for timeout determination."""
    SIMPLE = "simple"          # Quick UI interactions, simple navigation
    MODERATE = "moderate"      # Standard coding tasks, basic testing
    COMPLEX = "complex"        # Multi-step workflows, comprehensive testing
    ADVANCED = "advanced"      # Full feature implementation, deep analysis
    ENTERPRISE = "enterprise"  # Large-scale migrations, complex integrations


class PersonaType(Enum):
    """Persona types with different typical execution times."""
    FAST = "fast"          # Quick operations (e.g., simple navigation)
    MODERATE = "moderate"  # Standard operations (e.g., code editing)
    SLOW = "slow"         # Longer operations (e.g., comprehensive analysis)


@dataclass
class TimeoutConfig:
    """Timeout configuration for different scenarios."""

    # Base timeouts by complexity (in seconds)
    simple: int = 120        # 2 minutes - Quick tasks
    moderate: int = 300      # 5 minutes - Standard tasks
    complex: int = 600       # 10 minutes - Multi-step workflows
    advanced: int = 1200     # 20 minutes - Full features
    enterprise: int = 2400   # 40 minutes - Large-scale operations

    # Maximum timeout limits
    max_single_task: int = 1800      # 30 minutes max for any single task
    max_orchestrator: int = 3600     # 60 minutes max for orchestrator

    # Retry configuration
    max_retries: int = 2
    retry_delay: int = 5  # seconds

    # Agent-specific multipliers
    persona_multipliers = {
        "planner": 1.0,      # Standard time
        "coder": 1.2,        # Code writing can take longer
        "tester": 1.5,       # Testing comprehensive
        "debugger": 1.8,     # Debugging can be time-consuming
        "designer": 1.0,     # Design tasks usually quick
        "researcher": 1.3,   # Research takes time
        "automator": 2.0,    # Automation can be lengthy
        "analyst": 1.4,      # Analysis takes time
    }

    def get_timeout(
        self,
        complexity: TaskComplexity = TaskComplexity.MODERATE,
        persona: Optional[str] = None
    ) -> int:
        """Calculate appropriate timeout for a task.

        Args:
            complexity: The complexity level of the task
            persona: Optional persona name for persona-specific adjustments

        Returns:
            Timeout in seconds
        """
        # Get base timeout for complexity
        base_timeout = {
            TaskComplexity.SIMPLE: self.simple,
            TaskComplexity.MODERATE: self.moderate,
            TaskComplexity.COMPLEX: self.complex,
            TaskComplexity.ADVANCED: self.advanced,
            TaskComplexity.ENTERPRISE: self.enterprise,
        }[complexity]

        # Apply persona multiplier if specified
        if persona and persona in self.persona_multipliers:
            base_timeout = int(base_timeout * self.persona_multipliers[persona])

        # Ensure within max limits
        return min(base_timeout, self.max_single_task)

    def get_orchestrator_timeout(
        self,
        num_tasks: int,
        complexity: TaskComplexity = TaskComplexity.MODERATE,
        execution_mode: str = "parallel"
    ) -> int:
        """Calculate timeout for orchestrator based on tasks.

        Args:
            num_tasks: Number of tasks to execute
            complexity: Overall workflow complexity
            execution_mode: "parallel", "sequential", or "priority"

        Returns:
            Timeout in seconds
        """
        base_timeout = self.get_timeout(complexity)

        if execution_mode == "parallel":
            # Parallel: use max task time + buffer
            timeout = int(base_timeout * 1.2)  # 20% buffer for coordination
        elif execution_mode == "sequential":
            # Sequential: sum of all task times
            timeout = int(base_timeout * num_tasks * 1.1)  # 10% buffer
        else:  # priority
            # Priority: similar to sequential
            timeout = int(base_timeout * num_tasks * 1.1)

        # Ensure within max limits
        return min(timeout, self.max_orchestrator)


@dataclass
class ResourceConfig:
    """Resource limits for Agent-S operations."""

    # Screenshot and image limits
    max_screenshot_size_mb: int = 10
    screenshot_quality: int = 85  # JPEG quality 0-100

    # Action limits
    max_actions_per_task: int = 50
    max_parallel_tasks: int = 10

    # Memory limits
    max_context_length: int = 100000  # tokens
    max_history_items: int = 100


@dataclass
class RetryConfig:
    """Retry configuration for failed operations."""

    # Retry settings
    max_retries: int = 3
    initial_delay: int = 2  # seconds
    max_delay: int = 30     # seconds
    backoff_factor: float = 2.0  # Exponential backoff multiplier

    # Retryable errors
    retryable_errors: tuple = (
        "TimeoutError",
        "ConnectionError",
        "NetworkError",
        "RateLimitError",
    )

    def get_retry_delay(self, attempt: int) -> int:
        """Calculate delay for retry attempt.

        Args:
            attempt: Current retry attempt (0-indexed)

        Returns:
            Delay in seconds
        """
        delay = self.initial_delay * (self.backoff_factor ** attempt)
        return min(int(delay), self.max_delay)


# Default configuration instances
DEFAULT_TIMEOUT_CONFIG = TimeoutConfig()
DEFAULT_RESOURCE_CONFIG = ResourceConfig()
DEFAULT_RETRY_CONFIG = RetryConfig()


# Preset configurations for different deployment scenarios
class PresetConfigs:
    """Preset configurations for different scenarios."""

    # Development: Shorter timeouts for quick iteration
    DEVELOPMENT = TimeoutConfig(
        simple=60,
        moderate=180,
        complex=300,
        advanced=600,
        enterprise=1200,
        max_single_task=900,
        max_orchestrator=1800,
    )

    # Production: Standard timeouts for reliability
    PRODUCTION = TimeoutConfig(
        simple=120,
        moderate=300,
        complex=600,
        advanced=1200,
        enterprise=2400,
        max_single_task=1800,
        max_orchestrator=3600,
    )

    # CI/CD: Longer timeouts for automation pipelines
    CI_CD = TimeoutConfig(
        simple=180,
        moderate=450,
        complex=900,
        advanced=1800,
        enterprise=3600,
        max_single_task=2400,
        max_orchestrator=7200,  # 2 hours for large pipelines
    )

    # Testing: Very short timeouts for quick feedback
    TESTING = TimeoutConfig(
        simple=30,
        moderate=60,
        complex=120,
        advanced=240,
        enterprise=480,
        max_single_task=300,
        max_orchestrator=600,
    )


def get_timeout_for_task_description(task: str) -> TaskComplexity:
    """Infer task complexity from task description.

    Args:
        task: Task description text

    Returns:
        Estimated TaskComplexity
    """
    task_lower = task.lower()

    # Enterprise indicators
    if any(word in task_lower for word in [
        "migration", "refactor entire", "large-scale",
        "across all", "comprehensive audit", "full integration"
    ]):
        return TaskComplexity.ENTERPRISE

    # Advanced indicators
    if any(word in task_lower for word in [
        "implement feature", "full workflow", "end-to-end",
        "complete system", "deep analysis", "comprehensive"
    ]):
        return TaskComplexity.ADVANCED

    # Complex indicators
    if any(word in task_lower for word in [
        "multi-step", "investigate", "debug", "analyze",
        "complex", "multiple", "coordinate"
    ]):
        return TaskComplexity.COMPLEX

    # Simple indicators
    if any(word in task_lower for word in [
        "click", "open", "close", "navigate to",
        "simple", "quick", "basic", "view"
    ]):
        return TaskComplexity.SIMPLE

    # Default to moderate
    return TaskComplexity.MODERATE


def estimate_orchestrator_complexity(tasks: list) -> TaskComplexity:
    """Estimate overall complexity for an orchestrator workflow.

    Args:
        tasks: List of task dictionaries

    Returns:
        Overall TaskComplexity for the workflow
    """
    if not tasks:
        return TaskComplexity.SIMPLE

    # Get complexity for each task
    complexities = [
        get_timeout_for_task_description(task.get("task", ""))
        for task in tasks
    ]

    # Use highest complexity level
    complexity_order = [
        TaskComplexity.SIMPLE,
        TaskComplexity.MODERATE,
        TaskComplexity.COMPLEX,
        TaskComplexity.ADVANCED,
        TaskComplexity.ENTERPRISE,
    ]

    max_complexity_idx = max(
        complexity_order.index(c) for c in complexities
    )

    return complexity_order[max_complexity_idx]


# Environment-based configuration selection
def get_config_for_environment(env: str = "production") -> TimeoutConfig:
    """Get timeout configuration for deployment environment.

    Args:
        env: Environment name ("development", "production", "ci_cd", "testing")

    Returns:
        TimeoutConfig instance
    """
    env_lower = env.lower()

    if env_lower in ("dev", "development", "local"):
        return PresetConfigs.DEVELOPMENT
    elif env_lower in ("ci", "ci_cd", "cicd", "pipeline"):
        return PresetConfigs.CI_CD
    elif env_lower in ("test", "testing", "qa"):
        return PresetConfigs.TESTING
    else:  # production or unknown
        return PresetConfigs.PRODUCTION
