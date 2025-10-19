"""
Lightweight helpers for exposing Scribe runtime features over HTTP.

Framework-specific adapters (FastAPI, Starlette, etc.) can import the
jobs facade defined here to wire endpoints without depending on the
legacy stack.
"""

from .jobs import AnthropicJobsAPI

__all__ = ["AnthropicJobsAPI"]
